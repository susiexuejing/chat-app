// Actual provider handler/cleaner/validator/serializer -> actual client pipeline.
// Offline only: transport, auth, clocks and durable I/O remain synthetic.
import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, body, START, ORDINARY_START, STREAM, settle, deferred, providerResponse } from './devEphemeralHarness.mjs';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';

const root = new URL('../../../', import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));

// Local partial checkouts lack dependencies. This strict subset only replaces
// Zod, never the production envelope construction/serialization or client parser.
// Installed-repository CI uses real Zod and asserts that selection below.
function schemaFixture() {
  function schema(check, shape) {
    const result = {
      shape,
      parse(value) { if (!check(value)) throw new Error('synthetic schema rejection'); return value; },
      safeParse(value) { try { return { success: true, data: result.parse(value) }; } catch { return { success: false }; } },
      strict() { return result; },
      min(n) { return schema(value => check(value) && value.length >= n); },
      int() { return schema(value => check(value) && Number.isInteger(value)); },
      positive() { return schema(value => check(value) && value > 0); },
      nonnegative() { return schema(value => check(value) && value >= 0); },
      nullable() { return schema(value => value === null || check(value)); },
    };
    return result;
  }
  return {
    string: () => schema(value => typeof value === 'string'),
    number: () => schema(value => typeof value === 'number' && Number.isFinite(value)),
    boolean: () => schema(value => typeof value === 'boolean'),
    literal: expected => schema(value => value === expected),
    enum: values => schema(value => values.includes(value)),
    object: shape => schema(value => value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === Object.keys(shape).length
      && Object.keys(shape).every(key => Object.hasOwn(value, key) && shape[key].safeParse(value[key]).success), shape),
    discriminatedUnion: (_key, choices) => schema(value => choices.some(choice => choice.safeParse(value).success)),
    iso: { datetime: () => schema(value => typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value))) },
  };
}
let z, schemaDependency;
try {
  ({ z } = await import('zod'));
  schemaDependency = 'installed-zod';
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes("Cannot find package 'zod'")) throw error;
  z = schemaFixture();
  schemaDependency = 'explicit-local-schema-fixture';
}
test(`short Deep schema dependency: ${schemaDependency}`, () => {
  if (process.env.CI) assert.equal(schemaDependency, 'installed-zod', 'CI must exercise the installed schema dependency');
});

const recognizer = await loadTsModule(new URL('server/src/flows/firstTwoRoundsReaction.ts', root), {});
const composition = await loadTsModule(new URL('server/src/flows/ef41DeepCompositionValidator.ts', root), {
  './firstTwoRoundsReaction': recognizer,
});
const streamContract = await loadTsModule(new URL('server/src/contracts/streamEvents.ts', root), { zod: { z } });
const SHORT = composition.FIRST_TWO_ROUNDS_DEEP_FALLBACK;
const LONG = '眼前这件事情可以暂时放在这里，不必马上把每一部分都说清楚。';
const INPUT = '虚构测试：今天准备一个演示。';
const CONFUSED = '今天发生了很多事，我脑子很乱，不知道该从哪里说起。';
const UNSAFE = '我正坐在窗边喝咖啡，翻着笔记本整理今天的全部思路。';
const LAST_RESORT = "Here's a thinking process\n1. 我正坐在窗边喝咖啡，翻着笔记本整理今天的全部思路。";
const completionWrites = ['ltu.updateProfile', 'evolution.adjustWeights', 'evolution.logWeightChange', 'neural.updateAfterSession', 'neural.saveProfiles'];

function streamFailure(terminal) {
  const pending = deferred();
  let reads = 0;
  return { pending, response: { status: 200, ok: true, body: { getReader: () => ({
    read: async () => {
      if (!reads++) return { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: SHORT } }] })}\n\n`) };
      if (terminal === 'reject') throw new Error('PRIVATE-SYNTHETIC-READER');
      return pending.promise;
    }, cancel: async () => {},
  }) } } };
}

async function runCase(config, ordinary = false, turn = 1) {
  const ready = deferred();
  const failure = config.failure ? streamFailure(config.failure) : null;
  const h = await harness({
    provider: async () => ready.promise, userTurn: turn,
    validateDeepOutput: composition.validateEf41DeepOutput, streamContract,
  });
  let wire = '', events = [], startResult;
  async function startBackend(input) {
    const message = config.message ?? input.message;
    startResult = await h.request('POST', ordinary ? ORDINARY_START : START, { input: ordinary
      ? { roleId: 'clever-fox', message, ...(turn > 1 ? { conversationId: 'synthetic-existing', requestId: input.requestId } : {}) }
      : body({ message, requestId: input.requestId }) });
    await settle();
    const session = h.sessions[0];
    if (config.prefixLength !== undefined) {
      session.reactionLayer = '前'.repeat(config.prefixLength);
      session.companionLayer = '';
    }
    if (config.priorChunks) session.deepChunks.push(...config.priorChunks);
    ready.resolve(failure?.response ?? providerResponse({ text: config.text, reasoning: !!config.reasoning }));
    await settle();
    return startResult.res;
  }
  const api = await loadTsModule(new URL('client/screens/chat/api/cozeApi.ts', root), {
    'expo-constants': { default: { expoConfig: { extra: { EXPO_PUBLIC_BACKEND_BASE_URL: 'https://mock.invalid' } } } },
    'react-native': { Platform: { OS: 'web' } }, zod: { z },
    '../utils/ef77Diagnostics': { emitEf77Trace() {}, getEf77ErrorType: () => '', isEf77DiagnosticEnabled: () => false },
    '../stores/anonymousSession': { getAnonymousRequestOptions: async () => ({ credentials: 'include', headers: {} }) },
  }, { process: { env: { EXPO_PUBLIC_APP_ENV: 'DEV' } }, fetch: async (url, options) => {
    if (options.method === 'POST') {
      assert.equal(ordinary, false, 'ordinary start uses the explicit test transport below');
      const res = await startBackend(JSON.parse(options.body));
      return { ok: res.statusCode === 200, status: res.statusCode, json: async () => res.body };
    }
    const sessionId = new URL(url).searchParams.get('sessionId');
    const stream = await h.request('GET', STREAM, { query: { sessionId } });
    h.tick(config.failure === 'timeout' ? 60000 : 3100); await settle();
    if (config.failure === 'timeout') { h.tick(100); await settle(); }
    // Feed exact bytes from the production serializer, not reconstructed events.
    wire = stream.res.writes.filter(value => value.startsWith('data: ')).join('');
    events = stream.events();
    assert.equal(stream.res.ended, true);
    let sent = false;
    return { ok: true, status: 200, body: { getReader: () => ({
      read: async () => {
        if (sent) return { done: true };
        sent = true;
        return { done: false, value: new TextEncoder().encode(wire) };
      }, cancel: async () => {},
    }) } };
  } });
  const controller = await loadTsModule(new URL('client/features/dev-journey/realRequestController.ts', root), {});
  const adapter = await loadTsModule(new URL('client/features/dev-journey/realRequestAdapter.ts', root), {
    'expo-crypto': { randomUUID: () => 'synthetic-short-deep' },
    '@/screens/chat/api/cozeApi': api,
    '@/features/dev-journey/realRequestController': controller,
  }, { process: { env: { EXPO_PUBLIC_APP_ENV: 'DEV' } } });
  const transport = adapter.createDevRealRequestTransport();
  if (ordinary) {
    // Only start projection is test-owned for ordinary routes. The actual
    // streaming parser/adapter/controller is shared; no fake DEV receipt.
    transport.start = async input => {
      const res = await startBackend(input);
      assert.equal(res.statusCode, 200);
      return { sessionId: res.body.sessionId, reactionText: res.body.reactionLayer, companionText: res.body.companionLayer };
    };
  }
  const client = controller.createDevRealRequestController({ enabled: true, transport, createRequestId: () => 'synthetic-short-deep' });
  const success = await client.send(config.message ?? INPUT);
  const snapshot = client.getSnapshot();
  const confirmEligible = client.getSnapshot() === snapshot && snapshot.status === 'success'
    && snapshot.source === 'backend-deep' && !!snapshot.requestId;
  const session = h.sessions[0];
  const validators = h.calls.filter(call => call.name === 'validator');
  const audits = h.calls.filter(call => call.name === 'audit').map(call => call.args[0]);
  const expected = config.expected;
  assert.equal(success, !!expected);
  assert.equal(confirmEligible, !!expected);
  assert.equal(snapshot.deepText, expected);
  assert.equal(session.deepDone, !!expected);
  assert.equal(session.deepError, expected ? null : 'deep_analysis_failure');
  assert.equal(h.providerRequests.length, 1, 'no retry');
  assert.equal(events[0].schemaVersion, 1);
  assert.deepEqual(plain(events.map(event => event.sequence)), events.map((_, index) => index + 1));
  if (expected) {
    assert.deepEqual(plain(events.slice(-2).map(event => event.eventType)), ['deep.completed', 'turn.completed']);
    assert.equal(events.at(-1).payload.status, 'completed');
    assert.equal(events.filter(event => event.eventType === 'deep.delta').map(event => event.payload.content).join(''), expected);
    assert.ok(audits.some(event => event.providerCategory === 'stream_completed'));
    assert.ok(audits.some(event => event.sseCategory === 'completed'));
    if (ordinary) for (const name of completionWrites) assert.ok(h.calls.some(call => call.name === name), name);
  } else {
    assert.equal(snapshot.status, 'failed');
    assert.equal(events.at(-1).eventType, 'error');
    assert.equal(events.at(-1).payload.code, 'DEEP_RESPONSE_FAILED');
    assert.ok(!events.some(event => ['deep.delta', 'deep.completed', 'turn.completed'].includes(event.eventType)));
    assert.ok(!audits.some(event => event.providerCategory === 'stream_completed' || event.sseCategory === 'completed'));
    assert.ok(audits.some(event => event.sseCategory === 'deep_failure'));
    assert.ok(!h.calls.some(call => completionWrites.includes(call.name)));
  }
  if (!ordinary) assert.deepEqual(h.identityCalls(), []);
  else {
    assert.ok(h.calls.some(call => call.name === 'change.recordChange'), 'ordinary accepted-input processing preserved');
    assert.ok(h.calls.some(call => call.name === 'neural.getOrCreateProfile'));
  }
  if (config.validatorCalls !== undefined) assert.equal(validators.length, config.validatorCalls);
  if (config.validatorSource) assert.equal(validators[0].args[0].source, config.validatorSource);
  if (config.expectedChunks) assert.deepEqual(plain(session.deepChunks), config.expectedChunks);
  if (validators.length) assert.ok(validators.every(call => call.args[0].userTurn === (ordinary ? turn : 1)));
  assert.doesNotMatch(JSON.stringify([h.logs, wire]), /PRIVATE-SYNTHETIC/);
  if (failure && config.failure === 'timeout') {
    const before = JSON.stringify([session.deepChunks, h.calls, wire]);
    if (config.late === 'reject') failure.pending.reject(new Error('PRIVATE-SYNTHETIC-LATE'));
    else failure.pending.resolve({ done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: LONG } }] })}\n\n`) });
    await settle(); h.tick(1000); await settle();
    assert.equal(JSON.stringify([session.deepChunks, h.calls, wire]), before, 'late result ignored');
  }
  return { h, events, snapshot, validators };
}

const entryCases = [
  { name: 'exact permitted short content', text: SHORT, expected: SHORT, validatorCalls: 1, validatorSource: 'cleaned' },
  { name: 'trimmed permitted short content', text: ` \n${SHORT}\n `, expected: SHORT, validatorCalls: 1, validatorSource: 'cleaned' },
  { name: 'wrapped short content', text: `synthetic ascii padding longer than twenty characters\n\n${SHORT}`, expected: SHORT, validatorCalls: 1, validatorSource: 'cleaned' },
  { name: 'reasoning short content', text: SHORT, reasoning: true, expected: SHORT, validatorCalls: 1, validatorSource: 'reasoning' },
  { name: 'confused-overload keeps existing EF41 selection', text: SHORT, message: CONFUSED, expected: composition.EF41_DEEP_FALLBACK, validatorCalls: 1 },
  { name: 'ordinary clean completion', text: LONG, expected: LONG, validatorCalls: 1 },
  { name: 'empty provider output', text: '', expected: '', validatorCalls: 0, expectedChunks: [] },
  { name: 'whitespace provider output', text: ' \n\t ', expected: '', validatorCalls: 0, expectedChunks: [] },
  { name: 'ASCII garbage', text: 'synthetic non-Chinese garbage that contains no final answer', expected: '', validatorCalls: 0 },
  { name: 'other short Chinese is not newly admitted', text: '慢慢来。', expected: '', validatorCalls: 0 },
  { name: 'short unsafe content is not newly admitted', text: '我在喝咖啡。', expected: '', validatorCalls: 0 },
  { name: 'cleaned unsafe text retains safe validator fallback', text: UNSAFE, expected: SHORT, validatorCalls: 1, validatorSource: 'cleaned' },
  { name: 'last-resort unsafe text retains safe validator fallback', text: LAST_RESORT, expected: SHORT, validatorCalls: 1, validatorSource: 'last-resort' },
  { name: 'reasoning unsafe text retains safe validator fallback', text: UNSAFE, reasoning: true, expected: SHORT, validatorCalls: 1, validatorSource: 'reasoning' },
  { name: 'budget exactly permits short reply', text: SHORT, prefixLength: 115, expected: SHORT, validatorCalls: 1 },
  { name: 'validator empty string is a failure', text: SHORT, prefixLength: 116, expected: '', validatorCalls: 1, expectedChunks: [''] },
  { name: 'last-resort validator empty string is a failure', text: LAST_RESORT, prefixLength: 116, expected: '', validatorCalls: 1, validatorSource: 'last-resort', expectedChunks: [''] },
  { name: 'reasoning validator empty string is a failure', text: SHORT, reasoning: true, prefixLength: 116, expected: '', validatorCalls: 1, validatorSource: 'reasoning', expectedChunks: [''] },
  { name: 'prior nonempty chunk plus empty result still succeeds', text: SHORT, prefixLength: 116, priorChunks: [LONG], expected: LONG, validatorCalls: 1, expectedChunks: [LONG, ''] },
  { name: 'read error after short partial is not successful', failure: 'reject', expected: '', validatorCalls: 0 },
  { name: 'timeout ignores late resolve', failure: 'timeout', late: 'resolve', expected: '', validatorCalls: 0 },
  { name: 'timeout ignores late reject', failure: 'timeout', late: 'reject', expected: '', validatorCalls: 0 },
];
for (const ordinary of [false, true]) for (const config of entryCases) {
  test(`actual short Deep chain ${ordinary ? 'ordinary' : 'DEV'} turn1: ${config.name}`, () => runCase(config, ordinary, 1));
}
for (const config of [entryCases[0], entryCases[4], entryCases[6], entryCases[11], entryCases[12], entryCases[13], entryCases[15]]) {
  test(`actual short Deep chain ordinary turn2: ${config.name}`, () => runCase(config, true, 2));
}
for (const config of [
  { name: 'short-content exception is not broadened', text: SHORT, expected: '', validatorCalls: 0 },
  { name: 'clean completion remains unchanged', text: LONG, expected: LONG, validatorCalls: 1 },
  { name: 'later-turn validator pass-through remains unchanged', text: UNSAFE, expected: UNSAFE, validatorCalls: 1 },
  { name: 'genuinely empty remains failure', text: '', expected: '', validatorCalls: 0 },
]) test(`actual short Deep chain ordinary turn3: ${config.name}`, () => runCase(config, true, 3));

test('DEV still forces turn1 even when a test caller supplies turn3', () => runCase(entryCases[0], false, 3));
