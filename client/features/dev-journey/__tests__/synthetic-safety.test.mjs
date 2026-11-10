import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deferred, loadTsModule } from './moduleHarness.mjs';

const source = new URL('../realRequestController.ts', import.meta.url);
const module = await loadTsModule(source, {});
const H01 = '现在先把现实安全放在前面。请尽快联系身边可信的人、当地紧急服务或危机支持。';
const U01 = '这里不能确认现实安全情况。如果你担心当前安全，请联系身边可信的人、当地紧急服务或危机支持。';
const cases = [['help', U01], ['emergency', H01], ['unknown', U01]];
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const receipt = {
  sessionId: 'session', devConversationId: 'conversation', expiresAt: 700000, remainingLifetimeMs: 600000,
  devReplyContract: 'dev-reply-practice-v1', devRetryContract: 'dev-manual-retry-v1', reactionText: '', companionText: '',
};
function reply(requestId) {
  return { contract: 'dev-reply-practice-v1', reply: 'ordinary answer', practiceCandidate: { ifCue: 'synthetic cue', thenAction: 'synthetic action' },
    source: { sessionId: 'session', devConversationId: 'conversation', requestId } };
}
function setup(overrides = {}, customModule = module, enabled = true) {
  const calls = { starts: [], streams: [], ends: [], ids: 0 };
  const transport = {
    start: async (input, signal) => { calls.starts.push({ input, signal }); return receipt; },
    stream: async (session, cb, signal, expected) => {
      calls.streams.push({ session, cb, signal, expected });
      cb.onDeepChunk('ordinary answer'); cb.onDone(reply(expected.requestId));
    },
    end: async id => { calls.ends.push(id); },
    ...overrides,
  };
  const controller = customModule.createDevRealRequestController({ enabled, transport, createRequestId: () => `request-${++calls.ids}` });
  return { controller, calls, transport };
}
function expectSafety(controller, expected) {
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.status, 'safety'); assert.equal(snapshot.safetySupport, expected);
  assert.equal(snapshot.canSend, false); assert.equal(snapshot.canRetry, false);
  for (const field of ['inputText', 'reactionText', 'companionText', 'deepText']) assert.equal(snapshot[field], '');
  for (const field of ['requestId', 'source', 'practiceCandidate', 'error']) assert.equal(snapshot[field], null);
  assert.equal(snapshot.completedTurns.length, 0); assert.equal(snapshot.preserveDraft, undefined);
  assert.ok(Object.isFrozen(snapshot));
}

for (const [kind, expected] of cases) for (const phase of ['idle', 'completed', 'pending-start', 'pending-stream', 'recoverable']) {
  test(`${kind} explicit synthetic control from ${phase} maps to its exact frozen support without sending`, async () => {
    const pending = deferred(); let callbacks;
    const { controller: c, calls, transport } = setup();
    let result;
    if (phase === 'completed') { await c.send('first fictional input'); await c.send('second fictional input'); assert.equal(c.getSnapshot().completedTurns.length, 1); }
    if (phase === 'pending-start') transport.start = (input, signal) => { calls.starts.push({ input, signal }); return pending.promise; };
    if (phase === 'pending-stream') transport.stream = (_s, cb, signal) => { callbacks = cb; calls.streams.push({ signal }); cb.onDeepChunk('private partial'); return pending.promise; };
    if (phase === 'recoverable') transport.stream = async (_s, cb) => { cb.onDeepChunk('private partial'); cb.onError('retry_turn'); };
    if (phase.startsWith('pending') || phase === 'recoverable') { result = c.send('fictional pending input'); await flush(); }
    if (phase === 'recoverable') { assert.equal(await result, false); assert.equal(c.getSnapshot().canRetry, true); }
    const before = { starts: calls.starts.length, streams: calls.streams.length, ids: calls.ids };
    c.safety(kind); expectSafety(c, expected);
    const safetySnapshot = c.getSnapshot();
    c.safety(kind); c.safety(kind === 'emergency' ? 'unknown' : 'emergency');
    assert.equal(c.getSnapshot(), safetySnapshot, 'duplicate/other safety clicks cannot replace a halted result');
    assert.equal(await c.send('cannot resume'), false); assert.equal(await c.retry(), false);
    assert.deepEqual({ starts: calls.starts.length, streams: calls.streams.length, ids: calls.ids }, before);
    assert.deepEqual(calls.ends, phase === 'idle' ? [] : [phase === 'completed' ? 'request-2' : 'request-1']);
    if (phase.startsWith('pending')) {
      assert.equal(await result, false); assert.equal(calls.starts[0].signal.aborted, true);
      callbacks?.onDeepChunk('late answer'); callbacks?.onDone(reply('request-1')); callbacks?.onError('terminal');
      pending.resolve(phase === 'pending-start' ? receipt : undefined); await flush();
      assert.equal(c.getSnapshot(), safetySnapshot);
      assert.equal(calls.streams.length, before.streams, 'a late start cannot open a stream');
    }
    c.dispose();
  });
}

test('revokes the first generation and publishes cleared safety before synchronous abort/end callbacks', async () => {
  let onAbort = () => undefined;
  class SyncAbortController {
    signal = { aborted: false };
    // Deliberately non-cooperative cancellation: generation revocation, not
    // the signal flag, must reject callbacks and the eventual settlement.
    abort() { onAbort(); }
  }
  const mod = await loadTsModule(source, {}, { AbortController: SyncAbortController });
  const pending = deferred(); let callbacks;
  const { controller: c, transport, calls } = setup({}, mod);
  const order = [];
  transport.stream = (_s, cb) => { callbacks = cb; return pending.promise; };
  const result = c.send('first generation'); await flush();
  c.subscribe(() => { if (c.getSnapshot().status === 'safety') order.push('cleared'); });
  const deliverStale = () => {
    expectSafety(c, H01); callbacks.onDeepChunk('ordinary answer'); callbacks.onDone(reply('request-1')); callbacks.onError('terminal');
  };
  onAbort = () => { order.push('abort'); deliverStale(); };
  transport.end = async id => { order.push('end'); calls.ends.push(id); deliverStale(); };
  c.safety('emergency'); assert.deepEqual(order, ['cleared', 'abort', 'end']);
  assert.equal(await result, false); pending.resolve(); await flush();
  expectSafety(c, H01); assert.deepEqual(calls.ends, ['request-1']); c.dispose();
});

test('safety from the starting notification prevents the first transport dispatch', async () => {
  const { controller: c, calls } = setup();
  c.subscribe(() => { if (c.getSnapshot().status === 'starting') c.safety('unknown'); });
  assert.equal(await c.send('fictional input'), false); expectSafety(c, U01);
  assert.equal(calls.starts.length, 0); assert.equal(calls.streams.length, 0);
  assert.deepEqual(calls.ends, ['request-1']); c.dispose();
});

test('throwing safety observers cannot block later observers, cancellation or end cleanup', async () => {
  const pending = deferred(); const { controller: c, transport, calls } = setup();
  transport.start = (input, signal) => { calls.starts.push({ input, signal }); return pending.promise; };
  const result = c.send('fictional input'); let notified = 0;
  c.subscribe(() => { throw new Error('synthetic failed observer'); });
  c.subscribe(() => { notified++; expectSafety(c, H01); });
  assert.doesNotThrow(() => c.safety('emergency')); assert.equal(notified, 1);
  assert.equal(calls.starts[0].signal.aborted, true); assert.equal(await result, false);
  assert.deepEqual(calls.ends, ['request-1']); pending.resolve(receipt); await flush(); expectSafety(c, H01); c.dispose();
});

test('throwing abort cannot skip end cleanup or let a pending result overwrite safety', async () => {
  class ThrowingAbortController {
    signal = { aborted: false };
    abort() { throw new Error('synthetic abort failure'); }
  }
  const mod = await loadTsModule(source, {}, { AbortController: ThrowingAbortController });
  const pending = deferred(); const { controller: c, transport, calls } = setup({}, mod);
  transport.start = (input, signal) => { calls.starts.push({ input, signal }); return pending.promise; };
  const result = c.send('fictional input');
  assert.doesNotThrow(() => c.safety('unknown')); assert.equal(await result, false);
  assert.deepEqual(calls.ends, ['request-1']); pending.resolve(receipt); await flush();
  expectSafety(c, U01); assert.equal(calls.streams.length, 0); c.dispose();
});

test('safety on the streaming notification prevents stream subscription', async () => {
  const { controller: c, calls } = setup();
  c.subscribe(() => { if (c.getSnapshot().status === 'streaming') c.safety('help'); });
  assert.equal(await c.send('fictional input'), false); expectSafety(c, U01);
  assert.equal(calls.starts.length, 1); assert.equal(calls.streams.length, 0); c.dispose();
});

for (const cleanup of ['throws', 'rejects', 'never-settles']) test(`cleanup ${cleanup} cannot undo safety, trigger retry or leak a raw error`, async () => {
  const { controller: c, transport } = setup();
  await c.send('fictional input'); let ends = 0;
  transport.end = () => { ends++; if (cleanup === 'throws') throw new Error('raw cleanup secret');
    return cleanup === 'rejects' ? Promise.reject(new Error('raw cleanup secret')) : new Promise(() => { /* Deliberately never settles. */ }); };
  c.safety('unknown'); await flush(); expectSafety(c, U01);
  assert.equal(await c.retry(), false); c.safety('help'); c.stop(); c.reset(); c.dispose();
  assert.equal(ends, 1);
});

test('pending continuation cleans both acknowledged and current request IDs exactly once', async () => {
  const { controller: c, calls, transport } = setup(); await c.send('completed');
  const pending = deferred(); transport.start = (input, signal) => { calls.starts.push({ input, signal }); return pending.promise; };
  const result = c.send('continuation'); c.safety('help');
  assert.equal(await result, false); assert.deepEqual(calls.ends, ['request-1', 'request-2']);
  pending.resolve(receipt); await flush(); expectSafety(c, U01);
  c.stop(); c.reset(); c.dispose(); assert.deepEqual(calls.ends, ['request-1', 'request-2']);
});

test('pending manual retry loses its recovery anchor and cannot revive on late errors', async () => {
  const { controller: c, calls, transport } = setup({ stream: async (_s, cb) => cb.onError('retry_turn') });
  assert.equal(await c.send('fictional input'), false);
  const pending = deferred(); transport.start = (input, signal) => { calls.starts.push({ input, signal }); return pending.promise; };
  const retry = c.retry(); assert.equal(calls.starts[1].input.retryOfRequestId, 'request-1');
  c.safety('emergency'); assert.equal(await retry, false); expectSafety(c, H01);
  assert.deepEqual(calls.ends, ['request-1', 'request-2']);
  pending.reject(Object.assign(new Error('late pending'), { code: 'dev_retry_pending' })); await flush();
  assert.equal(await c.retry(), false); expectSafety(c, H01); c.dispose();
});

test('retired lifetime and request timers cannot override safety or auto-resume', async () => {
  const timers = [], cleared = new Set();
  const mod = await loadTsModule(source, {}, { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: id => cleared.add(id) });
  const { controller: c, calls } = setup({}, mod); await c.send('fictional input');
  c.safety('help'); assert.equal(cleared.has(1), true); assert.equal(cleared.has(2), true);
  for (const timer of timers) timer.fn(); await flush(); expectSafety(c, U01);
  assert.equal(calls.starts.length, 1); assert.deepEqual(calls.ends, ['request-1']); c.dispose();
});

test('End clears support without enabling sends; explicit New starts a fresh conversation only on Send', async () => {
  const pending = deferred(); let oldCallbacks;
  const { controller: c, calls, transport } = setup();
  transport.stream = (_s, cb) => { oldCallbacks = cb; return pending.promise; };
  const first = c.send('old'); await flush(); c.safety('emergency'); assert.equal(await first, false);
  c.stop(); assert.equal(c.getSnapshot().status, 'stopped'); assert.equal(c.getSnapshot().safetySupport, undefined);
  assert.equal(await c.send('not allowed'), false); c.safety('help'); assert.equal(c.getSnapshot().status, 'stopped');
  c.reset(); assert.equal(c.getSnapshot().status, 'idle'); assert.equal(calls.starts.length, 1);
  transport.stream = async (_s, cb, _signal, expected) => { cb.onDeepChunk('ordinary answer'); cb.onDone(reply(expected.requestId)); };
  assert.equal(await c.send('new fictional input'), true);
  assert.equal(calls.starts[1].input.devConversationId, undefined); assert.equal(calls.starts[1].input.afterRequestId, undefined);
  oldCallbacks.onDeepChunk('old'); oldCallbacks.onDone(reply('request-1')); pending.resolve(); await flush();
  assert.equal(c.getSnapshot().inputText, 'new fictional input'); assert.equal(c.getSnapshot().requestId, 'request-2'); c.dispose();
});

test('invalid controls, disabled runtime and disposed instances cannot create a safety result', () => {
  const { controller: c, calls } = setup(); const before = c.getSnapshot();
  for (const kind of ['H01', 'terminal', '', null, undefined, {}, '__proto__']) c.safety(kind);
  assert.equal(c.getSnapshot(), before); c.dispose(); c.safety('help'); assert.equal(c.getSnapshot().status, 'stopped');
  const disabled = setup({}, module, false); disabled.controller.safety('help');
  assert.equal(disabled.controller.getSnapshot().status, 'idle'); assert.equal(calls.ids, 0); disabled.controller.dispose();
});

test('provider terminal refusal remains a technical failure, not synthetic safety', async () => {
  const { controller: c } = setup({ stream: async (_s, cb) => cb.onError('terminal') });
  assert.equal(await c.send('fictional input'), false); assert.equal(c.getSnapshot().status, 'failed');
  assert.equal(c.getSnapshot().safetySupport, undefined); assert.equal(c.getSnapshot().canRetry, false);
  c.safety('unknown'); assert.equal(c.getSnapshot().status, 'failed'); c.dispose();
});

test('actual runtime adapter routes safety only to existing end cleanup, with no additional start, stream or UUID', async () => {
  const calls = { starts: 0, streams: 0, ids: 0, ends: [] }; const pending = deferred(); let streamCallbacks, signal;
  const adapter = await loadTsModule(new URL('../realRequestAdapter.ts', import.meta.url), {
    'expo-crypto': { randomUUID: () => `uuid-${++calls.ids}` },
    '@/features/dev-journey/realRequestController': module,
    '@/screens/chat/api/cozeApi': {
      chatStart: async () => { calls.starts++; return { ...receipt, requestMode: 'dev-ephemeral-v1' }; },
      chatStream: (_session, cb, _offset, abortSignal) => { calls.streams++; streamCallbacks = cb; signal = abortSignal; return pending.promise; },
      endDevConversation: async id => { calls.ends.push(id); },
    },
  }, { process: { env: { EXPO_PUBLIC_APP_ENV: 'DEV' } } });
  const c = adapter.createDevRealRequestControllerForRuntime();
  c.safety('help'); assert.deepEqual(calls, { starts: 0, streams: 0, ids: 0, ends: [] });
  c.reset(); const result = c.send('fictional input'); await flush(); const requestId = c.getSnapshot().requestId;
  c.safety('emergency'); assert.equal(await result, false); assert.equal(signal.aborted, true);
  streamCallbacks.onChunk(JSON.stringify({ eventType: 'deep.delta', content: 'late' })); streamCallbacks.onError(new Error('late')); streamCallbacks.onDone();
  pending.resolve(); await flush(); expectSafety(c, H01);
  assert.deepEqual(calls, { starts: 1, streams: 1, ids: 1, ends: [requestId] }); c.dispose();
});
