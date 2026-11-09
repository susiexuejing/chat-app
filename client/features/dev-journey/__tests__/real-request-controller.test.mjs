import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTsModule } from './moduleHarness.mjs';

const receipt = { devConversationId: 'dev-conversation', expiresAt: 700000, remainingLifetimeMs: 600000 };
const source = new URL('../realRequestController.ts', import.meta.url);
const { createDevRealRequestController } = await loadTsModule(source, {});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function setup(overrides = {}, enabled = true) {
  const calls = { start: [], stream: [], uuid: 0 };
  const transport = {
    end: async () => undefined,
    start: async (...args) => {
      calls.start.push(args);
      return { ...receipt, sessionId: 'backend-session', reactionText: 'front reaction', companionText: 'front companion' };
    },
    stream: async (...args) => {
      calls.stream.push(args);
      args[1].onDeepChunk('backend Deep');
      args[1].onDone();
    },
    ...overrides,
  };
  const controller = createDevRealRequestController({ enabled, transport,
    createRequestId: () => `request-${++calls.uuid}` });
  return { controller, calls, transport };
}

test('construction, subscription, empty input and reset never initiate work', async () => {
  const { controller, calls } = setup();
  const unsubscribe = controller.subscribe(() => undefined);
  assert.equal(await controller.send(' \n '), false);
  controller.stop(); controller.reset(); unsubscribe(); controller.dispose();
  assert.deepEqual(calls, { start: [], stream: [], uuid: 0 });
});

test('disabled guard refuses explicit requests as well as implicit work', async () => {
  const { controller, calls } = setup({}, false);
  assert.equal(controller.getSnapshot().canSend, false);
  assert.equal(await controller.send('hello'), false);
  controller.reset();
  assert.equal(await controller.send('hello again'), false);
  assert.equal(calls.start.length, 0);
});

test('input length boundary is checked before consuming a turn or generating ID', async () => {
  const { controller, calls } = setup();
  assert.equal(await controller.send('a'.repeat(1001)), false);
  assert.equal(calls.uuid, 0); assert.equal(calls.start.length, 0);
  assert.equal(controller.getSnapshot().status, 'idle'); assert.equal(controller.getSnapshot().canSend, true);
  assert.equal(await controller.send('a'.repeat(1000)), true);
  assert.equal(calls.start[0][0].message.length, 1000);
});

test('invalid request IDs never reach transport or consume a turn', async () => {
  for (const id of ['', 'space id', 'x'.repeat(101), 'id/with/slash', undefined]) {
    let calls = 0, valid = false;
    const controller = createDevRealRequestController({ enabled: true, createRequestId: () => valid ? 'valid_ID-1' : id,
      transport: { end: async () => undefined, start: async () => { calls++; return { ...receipt, sessionId: 's' }; }, stream: async (_s, c) => { c.onDeepChunk('ok'); c.onDone(); } },
    });
    assert.equal(await controller.send('one'), false); assert.equal(calls, 0);
    assert.equal(controller.getSnapshot().canSend, true); assert.equal(controller.getSnapshot().status, 'idle');
    valid = true; assert.equal(await controller.send('one'), true); assert.equal(calls, 1);
  }
});

test('success omits front layers and sends only allowlisted current input', async () => {
  const { controller, calls } = setup();
  assert.equal(await controller.send('  current input  '), true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.start[0][0])), { roleId: 'clever-fox', message: 'current input', requestId: 'request-1' });
  assert.equal(calls.start[0][1], calls.stream[0][2]);
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getSnapshot())), {
    status: 'success', inputText: 'current input', requestId: 'request-1', sentAt: controller.getSnapshot().sentAt,
    reactionText: '', companionText: '', deepText: 'backend Deep',
    completedTurns: [], error: null, canSend: true, source: 'backend-deep',
  });
  assert.equal(await controller.send('explicit second turn'), true);
  assert.equal(calls.start.length, 2);
  assert.equal(calls.start[1][0].devConversationId, 'dev-conversation');
  assert.equal(calls.start[1][0].afterRequestId, 'request-1');
  assert.ok(Object.isFrozen(controller.getSnapshot()));
});

test('duplicate click during start starts exactly once and does not queue', async () => {
  const pending = deferred(); let count = 0;
  const { controller } = setup({ start: () => { count++; return pending.promise; } });
  const first = controller.send('one');
  assert.equal(await controller.send('two'), false);
  assert.equal(count, 1);
  pending.resolve({ ...receipt, sessionId: 's', reactionText: '', companionText: '' });
  assert.equal(await first, true);
});

test('start failure uses safe text, consumes turn, and does not stream/retry', async () => {
  const { controller, calls } = setup({ start: async () => { throw new Error('secret raw error'); } });
  assert.equal(await controller.send('one'), false);
  assert.equal(controller.getSnapshot().status, 'failed');
  assert.ok(!controller.getSnapshot().error.includes('secret'));
  assert.equal(await controller.send('retry'), false);
  assert.equal(calls.stream.length, 0);
});

for (const content of ['', ' \n ']) {
  test(`front-only / empty Deep is never success (${JSON.stringify(content)})`, async () => {
    const { controller } = setup({ stream: async (_s, callbacks) => {
      callbacks.onDeepChunk(content); callbacks.onDone();
    } });
    assert.equal(await controller.send('one'), false);
    assert.equal(controller.getSnapshot().status, 'failed');
    assert.equal(controller.getSnapshot().source, null);
    assert.equal(controller.getSnapshot().reactionText, '', 'failed conversation context is cleared');
  });
}

test('partial Deep with error remains failed and partial content remains identifiable', async () => {
  const { controller } = setup({ stream: async (_s, callbacks) => {
    callbacks.onDeepChunk('partial'); callbacks.onError(); callbacks.onDone(); callbacks.onDeepChunk('late');
  } });
  assert.equal(await controller.send('one'), false);
  assert.equal(controller.getSnapshot().status, 'failed');
  assert.equal(controller.getSnapshot().deepText, '', 'failed/stopped context is cleared');
});

test('transport resolution without terminal is not success', async () => {
  const { controller } = setup({ stream: async (_s, callbacks) => callbacks.onDeepChunk('partial') });
  assert.equal(await controller.send('one'), false);
  assert.equal(controller.getSnapshot().status, 'failed');
});

test('stop during pending auth/start settles promptly and late start cannot launch a stream', async () => {
  const pending = deferred(); let signal;
  const { controller, calls } = setup({ start: (_input, value) => { signal = value; return pending.promise; } });
  const result = controller.send('one');
  controller.stop();
  assert.equal(signal.aborted, true);
  assert.equal(await result, false);
  pending.resolve({ ...receipt, sessionId: 'late', reactionText: 'late', companionText: '' });
  await flush();
  assert.equal(calls.stream.length, 0);
  assert.equal(controller.getSnapshot().status, 'stopped');
  assert.equal(controller.getSnapshot().reactionText, '');
  assert.equal(await controller.send('retry'), false);
});

test('stop at streaming transition prevents even calling stream', async () => {
  const { controller, calls } = setup();
  controller.subscribe(() => { if (controller.getSnapshot().status === 'streaming') controller.stop(); });
  assert.equal(await controller.send('one'), false);
  assert.equal(calls.stream.length, 0);
});

test('stop during stream ignores late chunks, terminal and rejection', async () => {
  const pending = deferred(); let callbacks, signal;
  const { controller } = setup({ stream: (_s, c, a) => { callbacks = c; signal = a; return pending.promise; } });
  const result = controller.send('one'); await flush();
  callbacks.onDeepChunk('partial'); controller.stop();
  assert.equal(await result, false); assert.equal(signal.aborted, true);
  callbacks.onDeepChunk('late'); callbacks.onDone(); callbacks.onError(); pending.reject(new Error('late'));
  await flush();
  assert.equal(controller.getSnapshot().status, 'stopped');
  assert.equal(controller.getSnapshot().deepText, '', 'failed/stopped context is cleared');
});

test('explicit reset invalidates old generation and permits one new turn only', async () => {
  const pending = deferred(); const callbacks = [];
  const { controller, calls } = setup({ stream: async (_s, c) => {
    callbacks.push(c);
    if (callbacks.length === 1) return pending.promise;
    c.onDeepChunk('new'); c.onDone();
  } });
  const first = controller.send('old'); await flush();
  controller.reset();
  assert.equal(await first, false);
  assert.equal(controller.getSnapshot().deepText, '');
  assert.equal(await controller.send('new'), true);
  callbacks[0].onDeepChunk('obsolete'); callbacks[0].onDone(); pending.resolve(); await flush();
  assert.equal(controller.getSnapshot().deepText, 'new');
  assert.equal(controller.getSnapshot().requestId, 'request-2');
  assert.equal(calls.start.length, 2);
});

test('dispose during start aborts work, ignores late result and cannot be revived', async () => {
  const pending = deferred(); let signal, notifications = 0;
  const { controller, calls } = setup({ start: (_i, s) => { signal = s; return pending.promise; } });
  controller.subscribe(() => { notifications++; });
  const result = controller.send('one');
  controller.dispose(); const before = notifications;
  assert.equal(await result, false); assert.equal(signal.aborted, true);
  pending.resolve({ ...receipt, sessionId: 'late', reactionText: '', companionText: '' }); await flush();
  controller.reset(); assert.equal(await controller.send('two'), false);
  assert.equal(calls.stream.length, 0); assert.equal(notifications, before);
});

test('late callbacks after completed send cannot mutate its snapshot', async () => {
  let callbacks;
  const { controller } = setup({ stream: async (_s, c) => { callbacks = c; c.onDeepChunk('final'); c.onDone(); } });
  await controller.send('one'); const snapshot = controller.getSnapshot();
  callbacks.onDeepChunk('late'); callbacks.onError();
  assert.equal(controller.getSnapshot(), snapshot);
});

test('deadline aborts a stuck start without retry and rejects late completion', async () => {
  let fireDeadline, timerCleared = false, signal;
  const module = await loadTsModule(source, {}, {
    setTimeout: (callback, delay) => { assert.equal(delay, 165_000); fireDeadline = callback; return 1; },
    clearTimeout: () => { timerCleared = true; },
  });
  const pending = deferred(); let streams = 0;
  const controller = module.createDevRealRequestController({ enabled: true, createRequestId: () => 'id',
    transport: { end: async () => undefined, start: (_input, s) => { signal = s; return pending.promise; }, stream: async () => { streams++; } },
  });
  const result = controller.send('one'); fireDeadline();
  assert.equal(await result, false); assert.equal(signal.aborted, true); assert.equal(timerCleared, true);
  assert.equal(controller.getSnapshot().status, 'failed'); assert.equal(await controller.send('retry'), false);
  pending.resolve({ ...receipt, sessionId: 'late', reactionText: '', companionText: '' }); await flush();
  assert.equal(streams, 0);
});

test('dispose during stream aborts and discards late content and completion', async () => {
  const pending = deferred(); let callbacks, signal;
  const { controller } = setup({ stream: (_s, c, a) => { callbacks = c; signal = a; return pending.promise; } });
  const result = controller.send('one'); await flush(); controller.dispose();
  assert.equal(await result, false); assert.equal(signal.aborted, true);
  const snapshot = controller.getSnapshot();
  callbacks.onDeepChunk('late'); callbacks.onDone(); pending.resolve(); await flush();
  assert.equal(controller.getSnapshot(), snapshot); assert.equal(snapshot.status, 'stopped');
});

test('three explicit turns share opaque anchor, retain bounded presentation, and never send history fields', async () => {
  const { controller, calls } = setup();
  for (let n = 1; n <= 5; n++) {
    assert.equal(await controller.send(`input ${n}`), true);
    assert.equal(calls.start.length, n);
    const sent = calls.start[n - 1][0];
    assert.deepEqual(Object.keys(sent).sort(), n === 1 ? ['message', 'requestId', 'roleId']
      : ['afterRequestId', 'devConversationId', 'message', 'requestId', 'roleId']);
    if (n > 1) assert.equal(sent.afterRequestId, `request-${n - 1}`);
    assert.equal(controller.getSnapshot().completedTurns.length, Math.min(n - 1, 3));
  }
  controller.stop();
  assert.equal(controller.getSnapshot().canSend, false);
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getSnapshot().completedTurns)), []);
  assert.equal(controller.getSnapshot().deepText, '');
});

test('end during pending start is sent once by request identity and late result never establishes context', async () => {
  const pending = deferred(), ended = [];
  const { controller, calls } = setup({ start: () => pending.promise, end: async id => { ended.push(id); } });
  const sent = controller.send('one'); controller.stop(); controller.stop(); controller.dispose();
  assert.equal(await sent, false); assert.deepEqual(ended, ['request-1']);
  pending.resolve({ ...receipt, sessionId: 'late' }); await flush();
  assert.equal(calls.stream.length, 0); assert.equal(controller.getSnapshot().inputText, '');
});

test('new chat and dispose retire completed server context but never implicitly send a next turn', async () => {
  const ended = []; const { controller, calls } = setup({ end: async id => { ended.push(id); } });
  await controller.send('one'); controller.reset();
  assert.deepEqual(ended, ['request-1']); assert.equal(calls.start.length, 1);
  await controller.send('two'); assert.equal(calls.start[1][0].devConversationId, undefined);
  controller.dispose(); assert.deepEqual(ended, ['request-1', 'request-2']);
});

test('passive expiry clears completed input/output and uses server remaining lifetime, not skewed wall time', async () => {
  const timers = new Map(); let now = 999999999, seq = 0; const ended = [];
  const mod = await loadTsModule(source, {}, { Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; }, clearTimeout: id => timers.delete(id) });
  const c = mod.createDevRealRequestController({ enabled: true, createRequestId: () => 'id', transport: {
    start: async () => ({ ...receipt, sessionId: 's', expiresAt: 123, remainingLifetimeMs: 5000 }),
    stream: async (_s, callbacks) => { callbacks.onDeepChunk('reply'); callbacks.onDone(); }, end: async id => { ended.push(id); },
  } });
  assert.equal(await c.send('one'), true);
  assert.equal([...timers.values()][0].ms, 5000); now += 5000; [...timers.values()][0].fn();
  assert.equal(c.getSnapshot().status, 'failed'); assert.equal(c.getSnapshot().canSend, false);
  assert.equal(c.getSnapshot().inputText, ''); assert.equal(c.getSnapshot().deepText, '');
  assert.deepEqual(ended, ['id']); assert.equal(await c.send('implicit retry'), false);
});

for (const field of ['sessionId', 'devConversationId']) for (const value of [undefined, null, 123]) {
  test(`malformed receipt ${field}=${value} is rejected without streaming or a reusable context`, async () => {
    const { controller, calls } = setup({ start: async () => ({ ...receipt, sessionId: 's', [field]: value }) });
    assert.equal(await controller.send('one'), false); assert.equal(calls.stream.length, 0);
    assert.equal(controller.getSnapshot().requestId, null); assert.equal(controller.getSnapshot().canSend, false);
  });
}

test('explicit clock/expiry rejection is safe and never regenerated or retried', async () => {
  const { controller, calls } = setup({ start: async () => { throw new Error('dev_request_expired_or_clock_skew'); } });
  assert.equal(await controller.send('one'), false);
  assert.match(controller.getSnapshot().error, /时钟/); assert.equal(calls.uuid, 1);
  assert.equal(await controller.send('retry'), false); assert.equal(calls.uuid, 1);
});


test('pending chunks stay private until both a successful terminal and transport completion', async () => {
  const pending = deferred(); let callbacks;
  const { controller } = setup({ stream: async (_s, c) => { callbacks = c; await pending.promise; } });
  const notifications = [];
  controller.subscribe(() => notifications.push(controller.getSnapshot()));
  const result = controller.send('fictional current input'); await flush();
  callbacks.onDeepChunk('first complete sentence.');
  callbacks.onDeepChunk(' second complete sentence.');
  for (const state of notifications) {
    assert.equal(state.deepText, ''); assert.equal(state.source, null);
    assert.equal(state.reactionText, ''); assert.equal(state.companionText, '');
  }
  assert.equal(controller.getSnapshot().status, 'streaming');
  callbacks.onDone();
  assert.equal(controller.getSnapshot().deepText, '', 'terminal callback alone does not complete a pending transport');
  pending.resolve(); assert.equal(await result, true);
  assert.equal(controller.getSnapshot().deepText, 'first complete sentence. second complete sentence.');
  assert.equal(notifications.filter(state => state.deepText).length, 1, 'publish the entire completed answer once');
  controller.dispose();
});

for (const finish of ['error', 'throw', 'no-terminal', 'stop', 'reset']) test(`pending primary reply is never exposed after ${finish}`, async () => {
  const pending = deferred(); let callbacks;
  const { controller } = setup({ stream: async (_s, c) => { callbacks = c; await pending.promise; } });
  const notifications = [];
  controller.subscribe(() => notifications.push(controller.getSnapshot()));
  const result = controller.send('fictional input'); await flush();
  callbacks.onDeepChunk('must never appear as a completed answer');
  if (finish === 'error') callbacks.onError();
  if (finish === 'stop') controller.stop();
  if (finish === 'reset') controller.reset();
  if (finish === 'throw') { callbacks.onDone(); pending.reject(new Error('late transport failure')); }
  else pending.resolve();
  assert.equal(await result, false);
  for (const state of notifications) { assert.equal(state.deepText, ''); assert.equal(state.source, null); }
  controller.dispose();
});
