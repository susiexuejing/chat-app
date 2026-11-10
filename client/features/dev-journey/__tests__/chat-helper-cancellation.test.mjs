import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deferred, loadTsModule } from './moduleHarness.mjs';

const source = new URL('../../../screens/chat/api/cozeApi.ts', import.meta.url);
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
async function setup({ auth = async () => ({ credentials: 'include', headers: { 'X-Test-Auth': 'mock-only' } }),
  fetch = async () => ({ ok: true, status: 200, json: async () => ({ sessionId: 's' }) }),
  env = 'DEV', platform = 'web', dynamicImport, NativeSSE = class {} } = {}) {
  const calls = { auth: [], fetch: [] };
  const api = await loadTsModule(source, {
    'expo-constants': { default: { expoConfig: { extra: { EXPO_PUBLIC_BACKEND_BASE_URL: 'https://mock.invalid' } } } },
    'react-native': { Platform: { OS: platform } },
    zod: { z: { iso: { datetime: () => ({ safeParse: () => ({ success: true }) }) } } },
    '../utils/ef77Diagnostics': { emitEf77Trace() { return undefined; }, getEf77ErrorType: () => 'mock-error', isEf77DiagnosticEnabled: () => false },
    '../stores/anonymousSession': { getAnonymousRequestOptions: (...args) => { calls.auth.push(args); return auth(...args); } },
    'react-native-sse': { default: NativeSSE },
  }, { process: { env: { EXPO_PUBLIC_APP_ENV: env } }, fetch: (...args) => { calls.fetch.push(args); return fetch(...args); } }, dynamicImport);
  return { api, calls };
}

test('pre-aborted chatStart touches neither auth nor fetch', async () => {
  const { api, calls } = await setup(); const abort = new AbortController(); abort.abort();
  await assert.rejects(api.chatStart('clever-fox', 'one', undefined, 'id', undefined, undefined, abort.signal), { name: 'AbortError' });
  assert.deepEqual(calls, { auth: [], fetch: [] });
});

test('stop while anonymous auth is pending prevents chatStart fetch', async () => {
  const pending = deferred(); const { api, calls } = await setup({ auth: () => pending.promise });
  const abort = new AbortController();
  const result = api.chatStart('clever-fox', 'one', undefined, 'id', undefined, undefined, abort.signal);
  abort.abort(); pending.resolve({ headers: {} });
  await assert.rejects(result, { name: 'AbortError' }); assert.equal(calls.fetch.length, 0);
});

test('chatStart forwards signal and discards late fetch response', async () => {
  const pending = deferred(); let parsed = 0;
  const { api, calls } = await setup({ fetch: () => pending.promise }); const abort = new AbortController();
  const result = api.chatStart('clever-fox', 'one', undefined, 'id', undefined, undefined, abort.signal);
  await flush(); assert.equal(calls.fetch[0][1].signal, abort.signal); abort.abort();
  pending.resolve({ ok: true, status: 200, json: async () => { parsed++; return { sessionId: 's' }; } });
  await assert.rejects(result, { name: 'AbortError' }); assert.equal(parsed, 0);
});

test('chatStart discards late JSON resolution after stop', async () => {
  const pending = deferred();
  const { api } = await setup({ fetch: async () => ({ ok: true, status: 200, json: () => pending.promise }) });
  const abort = new AbortController();
  const result = api.chatStart('clever-fox', 'one', undefined, 'id', undefined, undefined, abort.signal);
  await flush(); abort.abort(); pending.resolve({ sessionId: 'late' });
  await assert.rejects(result, { name: 'AbortError' });
});

test('existing live chatStart caller without optional signal keeps request contract and completes', async () => {
  const { api, calls } = await setup();
  assert.equal((await api.chatStart('live-role', 'live input', 'live-conversation', 'live-request', undefined, 'diagnostic')).sessionId, 's');
  const options = calls.fetch[0][1];
  assert.deepEqual(JSON.parse(options.body), { roleId: 'live-role', message: 'live input', conversationId: 'live-conversation', requestId: 'live-request' });
  assert.equal(options.headers['X-EF45-One-Shot-Marker'], 'diagnostic');
  assert.equal(options.signal, undefined); assert.equal(options.credentials, 'include');
});

test('DEV local-only start payload omits conversation and any history/account data', async () => {
  const { api, calls } = await setup();
  await api.chatStart('clever-fox', 'current', undefined, 'request', undefined, undefined, new AbortController().signal);
  assert.deepEqual(JSON.parse(calls.fetch[0][1].body), { roleId: 'clever-fox', message: 'current', requestId: 'request' });
});

for (const platform of ['web', 'ios']) {
  test(`pre-aborted ${platform} stream touches neither auth nor network`, async () => {
    const { api, calls } = await setup({ platform }); const abort = new AbortController(); abort.abort();
    await assert.rejects(api.chatStream('s', {}, undefined, abort.signal), { name: 'AbortError' });
    assert.deepEqual(calls, { auth: [], fetch: [] });
  });
  test(`stop during ${platform} stream auth prevents follow-on stream/import`, async () => {
    const pending = deferred(); let imports = 0;
    const { api, calls } = await setup({ platform, auth: () => pending.promise, dynamicImport: () => { imports++; } });
    const abort = new AbortController(); const result = api.chatStream('s', {}, undefined, abort.signal);
    abort.abort(); pending.resolve({ headers: {} });
    await assert.rejects(result, { name: 'AbortError' }); assert.equal(calls.fetch.length, 0); assert.equal(imports, 0);
  });
}

test('stop during native SSE module import prevents construction', async () => {
  const importing = deferred(); let constructions = 0, beganImport = false;
  const { api } = await setup({ platform: 'ios',
    dynamicImport: () => { beganImport = true; return importing.promise; },
    NativeSSE: class { constructor() { constructions++; } },
  });
  const abort = new AbortController(); const result = api.chatStream('s', {}, undefined, abort.signal);
  await flush(); assert.equal(beganImport, true); abort.abort(); importing.resolve();
  await assert.rejects(result, { name: 'AbortError' }); assert.equal(constructions, 0);
});

test('live native stream without signal still constructs and completes', async () => {
  const instances = [];
  class NativeSSE {
    listeners = new Map();
    constructor() { instances.push(this); }
    addEventListener(event, callback) { this.listeners.set(event, callback); }
    close() { this.listeners.get('close')?.(); }
  }
  const { api } = await setup({ platform: 'ios', NativeSSE }); let done = 0;
  const result = api.chatStream('live-s', { onDone: () => done++ });
  for (let i = 0; i < 10 && instances.length === 0; i++) await flush();
  assert.equal(instances.length, 1); instances[0].listeners.get('message')({ data: '[DONE]' }); await result;
  assert.equal(done, 1);
});

test('ephemeral DEV uses dedicated route and mode with same authenticated owner, never normal start', async () => {
  const { api, calls } = await setup();
  await api.chatStart('clever-fox', 'fictional', undefined, 'id', undefined, undefined, new AbortController().signal, 'dev-ephemeral-v1');
  assert.equal(calls.fetch[0][0], 'https://mock.invalid/api/v1/chat/dev-journey/start');
  assert.deepEqual(JSON.parse(calls.fetch[0][1].body), { roleId: 'clever-fox', message: 'fictional', requestId: 'id', requestMode: 'dev-ephemeral-v1' });
  assert.equal(calls.fetch[0][1].credentials, 'include');
});
test('old backend 404 is a closed failure with no ordinary endpoint retry', async () => {
  const { api, calls } = await setup({ fetch: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(api.chatStart('clever-fox', 'fictional', undefined, 'id', undefined, undefined, undefined, 'dev-ephemeral-v1'));
  assert.equal(calls.fetch.length, 1);
  assert.equal(calls.fetch[0][0], 'https://mock.invalid/api/v1/chat/dev-journey/start');
});
test('ephemeral helper refuses nonDEV and conversation identifiers before authentication', async () => {
  for (const env of ['production', 'test', '']) {
    const { api, calls } = await setup({ env });
    await assert.rejects(api.chatStart('clever-fox', 'fictional', undefined, 'id', undefined, undefined, undefined, 'dev-ephemeral-v1'));
    assert.deepEqual(calls, { auth: [], fetch: [] });
  }
  const { api, calls } = await setup();
  await assert.rejects(api.chatStart('clever-fox', 'fictional', 'existing', 'id', undefined, undefined, undefined, 'dev-ephemeral-v1'));
  assert.deepEqual(calls, { auth: [], fetch: [] });
});

test('DEV continuation sends only opaque allowlisted anchor fields', async () => {
  const { api, calls } = await setup();
  await api.chatStart('clever-fox', 'current', undefined, '100000_id', undefined, undefined, undefined,
    'dev-ephemeral-v1', { devConversationId: 'server-owned', afterRequestId: '100000_prior', history: ['never sent'] });
  assert.deepEqual(JSON.parse(calls.fetch[0][1].body), { roleId: 'clever-fox', message: 'current', requestId: '100000_id',
    requestMode: 'dev-ephemeral-v1', devConversationId: 'server-owned', afterRequestId: '100000_prior' });
});

test('DEV end preserves existing authenticated CSRF options and never falls back to an unauthenticated beacon', async () => {
  const { api, calls } = await setup({ auth: async () => ({ credentials: 'include', headers: { 'X-EF-CSRF': 'mock-only' } }) });
  await api.endDevConversation('100000_id');
  assert.equal(calls.auth.length, 1); assert.equal(calls.fetch.length, 1);
  const [url, options] = calls.fetch[0];
  assert.equal(url, 'https://mock.invalid/api/v1/chat/dev-journey/end');
  assert.equal(options.headers['X-EF-CSRF'], 'mock-only'); assert.equal(options.credentials, 'include');
  assert.equal(options.keepalive, true);
  assert.deepEqual(JSON.parse(options.body), { requestMode: 'dev-ephemeral-v1', requestId: '100000_id' });
});

test('DEV practice negotiation uses only standard Accept, never expands closed body or retries old server', async () => {
  const { api, calls } = await setup();
  const result = await api.chatStart('clever-fox', 'current', undefined, 'request', undefined, undefined,
    new AbortController().signal, 'dev-ephemeral-v1', undefined, 'dev-reply-practice-v1');
  assert.equal(result.devReplyContract, undefined); assert.equal(calls.fetch.length, 1);
  assert.equal(calls.fetch[0][1].headers.Accept, 'application/json; dev-reply-contract=dev-reply-practice-v1');
  assert.deepEqual(JSON.parse(calls.fetch[0][1].body), { roleId: 'clever-fox', message: 'current', requestId: 'request', requestMode: 'dev-ephemeral-v1' });
});
test('negotiation cannot be attached to ordinary mode', async () => {
  const { api, calls } = await setup();
  await assert.rejects(api.chatStart('clever-fox', 'current', undefined, 'request', undefined, undefined,
    new AbortController().signal, undefined, undefined, 'dev-reply-practice-v1'));
  assert.equal(calls.fetch.length, 0);
});
function practiceTerminal() {
  return { schemaVersion: 1, eventType: 'turn.completed', sequence: 3, timestamp: new Date().toISOString(), payload: { status: 'completed', practiceReply: {
    contract: 'dev-reply-practice-v1', reply: 'reply', practiceCandidate: { ifCue: 'cue', thenAction: 'action' },
    source: { sessionId: 's', devConversationId: 'c', requestId: 'r' },
  } } };
}
test('actual EF stream parser preserves strict structured terminal and accepts old terminal', async () => {
  const { api } = await setup();
  const r = api.parseVersionedStreamEvent(JSON.stringify(practiceTerminal())); assert.equal(r.kind, 'known'); assert.equal(r.terminal, true);
  assert.equal(JSON.parse(r.serialized).payload.practiceReply.practiceCandidate.thenAction, 'action');
  const old = practiceTerminal(); delete old.payload.practiceReply; assert.equal(api.parseVersionedStreamEvent(JSON.stringify(old)).kind, 'known');
});
for (const alter of [t => { t.payload.practiceReply.contract = 'other'; }, t => { t.payload.practiceReply.extra = 'x'; },
  t => { t.payload.practiceReply.source.requestId = ''; }, t => { t.payload.practiceReply.practiceCandidate.ifCue = ''; },
  t => { t.payload.practiceReply.practiceCandidate.thenAction = String.fromCodePoint(0x1f600).repeat(101); }, t => { t.payload.extra = true; }]) {
  test('actual EF stream parser rejects malformed practice terminal', async () => {
    const { api } = await setup(); const t = practiceTerminal(); alter(t);
    assert.equal(api.parseVersionedStreamEvent(JSON.stringify(t)).kind, 'rejected');
  });
}
