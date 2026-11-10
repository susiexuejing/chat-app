import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTsModule } from './moduleHarness.mjs';

const source = new URL('../../../screens/chat/api/cozeApi.ts', import.meta.url);
const HEADER = 'X-EF235-Chat-Start-Boundary';
const CANARY = 'SYNTHETIC_PRIVATE_HEADER_CANARY_EF348';
const BOUNDARIES = ['anonymous_auth', 'request_validation', 'conversation_ownership',
  'runtime_profile', 'flow_preparation', 'session_create'];
const MODES = ['ordinary', 'dev-legacy', 'dev-manual-retry'];
const INVALID = [
  ['missing', null], ['undefined', undefined], ['empty', ''], ['unknown', 'unknown'],
  ['unrecognized', 'future_category'], ['prototype', '__proto__'], ['constructor', 'constructor'],
  ['canary', CANARY], ['leading space', ' anonymous_auth'], ['trailing space', 'anonymous_auth '],
  ['mixed case', 'Anonymous_Auth'], ['uppercase', 'ANONYMOUS_AUTH'],
  ['tabs', '\tanonymous_auth\t'], ['CRLF', `anonymous_auth\r\n${CANARY}`],
  ['NUL', `anonymous_auth\0${CANARY}`], ['DEL', `session_create\x7f${CANARY}`],
  ['other controls', `\x01\x1b${CANARY}`], ['unicode whitespace', '\u00a0anonymous_auth\u00a0'],
  ['zero width', 'anonymous_\u200bauth'], ['unicode lookalike', 'anonymous_аuth'],
  ['comma joined', 'anonymous_auth,session_create'], ['overlong known prefix', `anonymous_auth${'x'.repeat(65536)}`],
  ['megabyte canary', CANARY.repeat(32768)], ['number', 503], ['boolean', true],
  ['array', ['anonymous_auth']], ['boxed string', new String('anonymous_auth')],
  ['object with unsafe coercion', { toString() { throw Error(CANARY); } }],
];

async function setup({ boundary = null, status = 503, pending = false, platform = 'web',
  env = 'DEV', authenticationError, headersMissing = false } = {}) {
  const calls = { auth: [], fetch: [], headers: [], logs: [], traces: [], bodyReads: 0 };
  const api = await loadTsModule(source, {
    'expo-constants': { default: { expoConfig: { extra: { EXPO_PUBLIC_BACKEND_BASE_URL: 'https://offline.invalid' } } } },
    'react-native': { Platform: { OS: platform } },
    zod: { z: { iso: { datetime: () => ({ safeParse: () => ({ success: true }) }) } } },
    '../utils/ef77Diagnostics': {
      emitEf77Trace: (...args) => calls.traces.push(args),
      getEf77ErrorType: error => error?.name ?? typeof error,
      isEf77DiagnosticEnabled: () => false,
    },
    '../stores/anonymousSession': { getAnonymousRequestOptions: async (...args) => {
      calls.auth.push(args);
      if (authenticationError) throw authenticationError;
      return { credentials: 'include', headers: { 'X-EF-CSRF': 'synthetic-csrf' } };
    } },
    'react-native-sse': { default: class {} },
  }, {
    process: { env: { EXPO_PUBLIC_APP_ENV: env } },
    require: specifier => {
      assert.equal(specifier, 'react-native-sse');
      return { default: class {} };
    },
    console: Object.fromEntries(['log', 'info', 'warn', 'error'].map(level => [level, (...args) => calls.logs.push({ level, args })])),
    fetch: async (...args) => {
      calls.fetch.push(args);
      return {
        ok: status >= 200 && status < 300, status,
        headers: headersMissing ? undefined : { get: name => {
          calls.headers.push(name);
          return name === HEADER ? boundary : name === 'X-Dev-Retry-State' && pending ? 'pending' : null;
        } },
        json: async () => { calls.bodyReads++; return { sessionId: 'synthetic-session' }; },
        text: async () => { calls.bodyReads++; return CANARY; },
        get body() { calls.bodyReads++; throw Error('HTTP failure body must not be touched'); },
      };
    },
  });
  return { api, calls };
}

function invoke(api, mode, retryOfRequestId, signal) {
  return api.chatStart('clever-fox', 'Fictional offline input.', undefined, '100000_synthetic',
    undefined, undefined, signal, mode === 'ordinary' ? undefined : 'dev-ephemeral-v1', undefined,
    mode === 'dev-manual-retry' ? 'dev-reply-practice-v1' : undefined,
    mode === 'dev-manual-retry' ? { contract: 'dev-manual-retry-v1', ...(retryOfRequestId ? { retryOfRequestId } : {}) } : undefined);
}

async function rejected(api, mode, retryOfRequestId) {
  let error;
  try { await invoke(api, mode, retryOfRequestId); } catch (caught) { error = caught; }
  assert.ok(error, 'must reject instead of fabricating success');
  return error;
}

function assertRequest(calls, mode, status, boundary, error, retryOfRequestId) {
  assert.equal(calls.bodyReads, 0);
  assert.equal(calls.auth.length, 1);
  assert.deepEqual(calls.auth[0], ['https://offline.invalid', 'POST']);
  assert.equal(calls.fetch.length, 1, 'no retry, fallback or diagnostic request');
  const [url, options] = calls.fetch[0];
  assert.equal(new URL(url).pathname, mode === 'ordinary' ? '/api/v1/chat/start' : '/api/v1/chat/dev-journey/start');
  assert.equal(options.credentials, 'include');
  assert.equal(options.headers['X-EF-CSRF'], 'synthetic-csrf');
  assert.deepEqual(JSON.parse(options.body), {
    roleId: 'clever-fox', message: 'Fictional offline input.', requestId: '100000_synthetic',
    ...(mode === 'ordinary' ? {} : { requestMode: 'dev-ephemeral-v1' }),
    ...(retryOfRequestId ? { retryOfRequestId } : {}),
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls.logs)), [{ level: 'warn',
    args: ['[EF-235] Chat start HTTP failure', { httpStatus: status, boundary }] }]);
  assert.equal(error.name, 'Error');
  assert.equal(error.message, boundary === 'unknown' ? 'chat_start_request_failed' : `chat_start_${boundary}_${status}`);
  assert.equal(error.code, undefined, 'normal HTTP errors must not become pending or unconfirmed');
  assert.deepEqual(calls.traces.map(([event]) => event), ['chat_start_started', 'chat_start_failed']);
  assert.equal(calls.traces[1][1].httpStatus, status);
  const output = JSON.stringify({ logs: calls.logs, traces: calls.traces, error: { message: error.message, stack: error.stack, code: error.code } });
  assert.ok(!output.includes(CANARY), 'header canary must not reach console, trace or Error');
}

for (const mode of MODES) {
  for (const boundary of BOUNDARIES) test(`${mode}: exact ${boundary} preserves all HTTP categories`, async () => {
    for (const status of [400, 401, 403, 409, 429, 500, 503]) {
      const { api, calls } = await setup({ boundary, status });
      assertRequest(calls, mode, status, boundary, await rejected(api, mode));
    }
  });
  for (const [label, boundary] of INVALID) test(`${mode}: ${label} is opaque in console and Error`, async () => {
    const { api, calls } = await setup({ boundary });
    assertRequest(calls, mode, 503, 'unknown', await rejected(api, mode));
  });
}

for (const status of [401, 403]) test(`unknown-header HTTP ${status} stays terminal even on explicit retry`, async () => {
  const { api, calls } = await setup({ boundary: CANARY, status });
  assertRequest(calls, 'dev-manual-retry', status, 'unknown', await rejected(api, 'dev-manual-retry', '100000_prior'), '100000_prior');
});

for (const mode of MODES) test(`${mode}: absent Headers still uses unknown`, async () => {
  const { api, calls } = await setup({ headersMissing: true });
  assertRequest(calls, mode, 503, 'unknown', await rejected(api, mode));
});

for (const platform of ['ios', 'android']) test(`${platform}: shared start helper rejects hostile header unchanged`, async () => {
  const { api, calls } = await setup({ boundary: CANARY, platform });
  assertRequest(calls, 'ordinary', 503, 'unknown', await rejected(api, 'ordinary'));
});

test('manual retry pending409 precedes boundary lookup and body access', async () => {
  const { api, calls } = await setup({ boundary: CANARY, status: 409, pending: true });
  const error = await rejected(api, 'dev-manual-retry', '100000_prior');
  assert.equal(error.message, 'dev_retry_pending');
  assert.equal(error.code, 'dev_retry_pending');
  assert.deepEqual(calls.headers, ['X-Dev-Retry-State']);
  assert.equal(calls.logs.length, 0); assert.equal(calls.bodyReads, 0); assert.equal(calls.fetch.length, 1);
});

for (const mode of MODES) test(`${mode}: pending header without explicit retry does not grant pending status`, async () => {
  const { api, calls } = await setup({ boundary: CANARY, status: 409, pending: true });
  assertRequest(calls, mode, 409, 'unknown', await rejected(api, mode));
});

for (const mode of ['dev-legacy', 'dev-manual-retry']) test(`${mode}: 410 precedes boundary lookup and body access`, async () => {
  const { api, calls } = await setup({ boundary: CANARY, status: 410 });
  const error = await rejected(api, mode);
  assert.equal(error.message, 'dev_request_expired_or_clock_skew'); assert.equal(error.code, undefined);
  assert.deepEqual(calls.headers, []); assert.deepEqual(calls.logs, []);
  assert.equal(calls.bodyReads, 0); assert.equal(calls.fetch.length, 1);
});

test('ordinary 410 retains generic opaque HTTP failure, not DEV expiry', async () => {
  const { api, calls } = await setup({ boundary: CANARY, status: 410 });
  assertRequest(calls, 'ordinary', 410, 'unknown', await rejected(api, 'ordinary'));
});

for (const mode of MODES) test(`${mode}: successful receipt does not inspect or log boundary`, async () => {
  const { api, calls } = await setup({ boundary: CANARY, status: 200 });
  assert.equal((await invoke(api, mode)).sessionId, 'synthetic-session');
  assert.deepEqual(calls.headers, []); assert.deepEqual(calls.logs, []);
  assert.equal(calls.fetch.length, 1); assert.equal(calls.bodyReads, 1);
});

test('authentication failure remains the original failure before HTTP', async () => {
  const authenticationError = Error('anonymous_session_unavailable');
  const { api, calls } = await setup({ authenticationError });
  assert.equal(await rejected(api, 'dev-manual-retry'), authenticationError);
  assert.equal(calls.fetch.length, 0); assert.deepEqual(calls.logs, []);
});

test('disabled DEV and pre-aborted requests still fail before auth or HTTP', async () => {
  const disabled = await setup({ env: 'production' });
  assert.equal((await rejected(disabled.api, 'dev-manual-retry')).message, 'dev_request_disabled');
  assert.equal(disabled.calls.auth.length, 0); assert.equal(disabled.calls.fetch.length, 0);
  const stopped = await setup(); const abort = new AbortController(); abort.abort();
  await assert.rejects(invoke(stopped.api, 'dev-manual-retry', undefined, abort.signal), { name: 'AbortError' });
  assert.equal(stopped.calls.auth.length, 0); assert.equal(stopped.calls.fetch.length, 0);
});
