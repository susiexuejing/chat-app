import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTsModule } from './moduleHarness.mjs';

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
    start: async (...args) => {
      calls.start.push(args);
      return { sessionId: 'backend-session', reactionText: 'front reaction', companionText: 'front companion' };
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
      transport: { start: async () => { calls++; return { sessionId: 's' }; }, stream: async (_s, c) => { c.onDeepChunk('ok'); c.onDone(); } },
    });
    assert.equal(await controller.send('one'), false); assert.equal(calls, 0);
    assert.equal(controller.getSnapshot().canSend, true); assert.equal(controller.getSnapshot().status, 'idle');
    valid = true; assert.equal(await controller.send('one'), true); assert.equal(calls, 1);
  }
});

test('success separates front layers and Deep, sending only allowlisted current input', async () => {
  const { controller, calls } = setup();
  assert.equal(await controller.send('  current input  '), true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.start[0][0])), { roleId: 'clever-fox', message: 'current input', requestId: 'request-1' });
  assert.equal(calls.start[0][1], calls.stream[0][2]);
  assert.deepEqual(JSON.parse(JSON.stringify(controller.getSnapshot())), {
    status: 'success', inputText: 'current input', requestId: 'request-1',
    reactionText: 'front reaction', companionText: 'front companion', deepText: 'backend Deep',
    error: null, canSend: false, source: 'backend-deep',
  });
  assert.equal(await controller.send('duplicate'), false);
  assert.equal(calls.start.length, 1);
  assert.ok(Object.isFrozen(controller.getSnapshot()));
});

test('duplicate click during start starts exactly once and does not queue', async () => {
  const pending = deferred(); let count = 0;
  const { controller } = setup({ start: () => { count++; return pending.promise; } });
  const first = controller.send('one');
  assert.equal(await controller.send('two'), false);
  assert.equal(count, 1);
  pending.resolve({ sessionId: 's', reactionText: '', companionText: '' });
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
    assert.equal(controller.getSnapshot().reactionText, 'front reaction');
  });
}

test('partial Deep with error remains failed and partial content remains identifiable', async () => {
  const { controller } = setup({ stream: async (_s, callbacks) => {
    callbacks.onDeepChunk('partial'); callbacks.onError(); callbacks.onDone(); callbacks.onDeepChunk('late');
  } });
  assert.equal(await controller.send('one'), false);
  assert.equal(controller.getSnapshot().status, 'failed');
  assert.equal(controller.getSnapshot().deepText, 'partial');
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
  pending.resolve({ sessionId: 'late', reactionText: 'late', companionText: '' });
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
  assert.equal(controller.getSnapshot().deepText, 'partial');
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
  pending.resolve({ sessionId: 'late', reactionText: '', companionText: '' }); await flush();
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
    transport: { start: (_input, s) => { signal = s; return pending.promise; }, stream: async () => { streams++; } },
  });
  const result = controller.send('one'); fireDeadline();
  assert.equal(await result, false); assert.equal(signal.aborted, true); assert.equal(timerCleared, true);
  assert.equal(controller.getSnapshot().status, 'failed'); assert.equal(await controller.send('retry'), false);
  pending.resolve({ sessionId: 'late', reactionText: '', companionText: '' }); await flush();
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
