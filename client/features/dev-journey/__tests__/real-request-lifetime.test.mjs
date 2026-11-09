import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, loadTsModule } from './moduleHarness.mjs';

const source = new URL('../realRequestController.ts', import.meta.url);
const FIRST_SEND = 100_000;
const MAX_SESSION_MS = 600_000;
const EXPIRES_AT = FIRST_SEND + MAX_SESSION_MS;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const receipt = (remainingLifetimeMs = MAX_SESSION_MS, expiresAt = EXPIRES_AT) => ({
  sessionId: 'session', devConversationId: 'conversation', expiresAt, remainingLifetimeMs,
  reactionText: '', companionText: '',
});

async function setup({ stream, createRequestId } = {}) {
  let now = FIRST_SEND, timerSerial = 0, requestSerial = 0;
  const timers = new Map(), starts = [], streams = [], ends = [], notifications = [];
  const mod = await loadTsModule(source, {}, {
    Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, delay) => {
      const id = ++timerSerial;
      timers.set(id, { fn, due: now + delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
  });
  const controller = mod.createDevRealRequestController({ enabled: true,
    createRequestId: createRequestId ?? (() => `request-${++requestSerial}`),
    transport: {
      start: (input, signal) => {
        const pending = deferred();
        starts.push({ input, signal, at: now, ...pending });
        return pending.promise;
      },
      stream: async (...args) => {
        streams.push(args);
        if (stream) return stream(...args);
        args[1].onDeepChunk('A complete fictional test reply.'); args[1].onDone();
      },
      end: async requestId => { ends.push(requestId); },
    },
  });
  controller.subscribe(() => notifications.push(controller.getSnapshot()));
  return {
    controller, timers, starts, streams, ends, notifications,
    advanceTo(value) {
      assert.ok(value >= now, 'controlled time cannot move backwards');
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.due <= value)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        const [id, timer] = next; now = Math.max(now, timer.due); timers.delete(id); timer.fn();
      }
      now = value;
    },
    // Model a promise continuation running before an overdue timer task.
    elapseWithoutTimers(value) { assert.ok(value >= now); now = value; },
  };
}

function assertExpired(x) {
  const state = x.controller.getSnapshot();
  assert.equal(state.status, 'failed'); assert.equal(state.canSend, false);
  assert.equal(state.inputText, ''); assert.equal(state.deepText, '');
  assert.equal(state.reactionText, ''); assert.equal(state.companionText, '');
  assert.equal(state.requestId, null); assert.equal(state.sentAt, 0); assert.equal(state.source, null);
  assert.equal(state.completedTurns.length, 0);
  assert.match(state.error, /过期/);
}

for (const delay of [0, 1000, 10_000, 30_000]) {
  test(`first start receipt delayed ${delay}ms still clears exactly ten minutes after accepted send`, async t => {
    const x = await setup(); t.after(() => x.controller.dispose());
    const sent = x.controller.send('Fictional first input.');
    assert.equal(x.controller.getSnapshot().sentAt, FIRST_SEND);
    x.advanceTo(FIRST_SEND + delay); x.starts[0].resolve(receipt());
    assert.equal(await sent, true);
    assert.deepEqual([...x.timers.values()].map(timer => timer.due), [EXPIRES_AT]);
    x.advanceTo(EXPIRES_AT - 1);
    assert.equal(x.controller.getSnapshot().status, 'success');
    assert.equal(x.controller.getSnapshot().canSend, true);
    assert.notEqual(x.controller.getSnapshot().deepText, '');
    x.advanceTo(EXPIRES_AT); assertExpired(x);
    assert.deepEqual(x.ends, ['request-1']); assert.equal(x.timers.size, 0);
    assert.equal(await x.controller.send('Must not send after expiry.'), false);
    assert.equal(x.starts.length, 1); assert.equal(x.streams.length, 1);
  });
}

test('equally delayed continuation never extends the first accepted send deadline', async t => {
  const x = await setup(); t.after(() => x.controller.dispose());
  const first = x.controller.send('First fictional turn.');
  x.advanceTo(110_000); x.starts[0].resolve(receipt()); assert.equal(await first, true);
  x.advanceTo(200_000);
  const second = x.controller.send('Second fictional turn.');
  x.advanceTo(210_000); x.starts[1].resolve(receipt(500_000)); assert.equal(await second, true);
  assert.equal(x.controller.getSnapshot().completedTurns.length, 1);
  assert.equal(x.starts[1].input.afterRequestId, 'request-1');
  assert.deepEqual([...x.timers.values()].map(timer => timer.due), [EXPIRES_AT]);
  x.advanceTo(EXPIRES_AT); assertExpired(x);
  assert.deepEqual(x.ends, ['request-2']); assert.equal(x.starts.length, 2);
});

test('a shorter receipt lifetime remains stricter and later receipts cannot extend it', async t => {
  const x = await setup(); t.after(() => x.controller.dispose());
  const first = x.controller.send('First fictional turn.');
  x.advanceTo(101_000); x.starts[0].resolve(receipt(5000)); assert.equal(await first, true);
  assert.deepEqual([...x.timers.values()].map(timer => timer.due), [106_000]);
  x.advanceTo(102_000);
  const second = x.controller.send('Second fictional turn.');
  x.advanceTo(103_000); x.starts[1].resolve(receipt(5000)); assert.equal(await second, true);
  assert.deepEqual([...x.timers.values()].map(timer => timer.due), [106_000]);
  x.advanceTo(106_000); assertExpired(x);
});

for (const serverExpiresAt of [123, 9_999_999_999]) {
  test(`delayed receipts keep duration-based clock-skew compatibility (server expiry ${serverExpiresAt})`, async t => {
    const x = await setup(); t.after(() => x.controller.dispose());
    const first = x.controller.send('Fictional skewed-clock input.');
    x.advanceTo(110_000); x.starts[0].resolve(receipt(MAX_SESSION_MS, serverExpiresAt));
    assert.equal(await first, true);
    x.advanceTo(200_000);
    const second = x.controller.send('Fictional skewed-clock continuation.');
    x.advanceTo(210_000); x.starts[1].resolve(receipt(500_000, serverExpiresAt));
    assert.equal(await second, true);
    assert.deepEqual([...x.timers.values()].map(timer => timer.due), [EXPIRES_AT]);
    x.advanceTo(EXPIRES_AT); assertExpired(x);
  });
}

test('rejected input and request-ID preflight do not start a session lifetime', async t => {
  let validId = false;
  const x = await setup({ createRequestId: () => validId ? 'accepted-request' : 'invalid id' });
  t.after(() => x.controller.dispose());
  assert.equal(await x.controller.send(' '), false);
  assert.equal(await x.controller.send('x'.repeat(1001)), false);
  assert.equal(await x.controller.send('Fictional retryable preflight.'), false);
  assert.equal(x.starts.length, 0); assert.equal(x.timers.size, 0);
  x.advanceTo(300_000); validId = true;
  const accepted = x.controller.send('Fictional accepted input.');
  x.advanceTo(310_000); x.starts[0].resolve(receipt()); assert.equal(await accepted, true);
  assert.deepEqual([...x.timers.values()].map(timer => timer.due), [900_000]);
  x.advanceTo(900_000); assertExpired(x);
});

test('explicit reset discards the old deadline and only a new accepted send starts another', async t => {
  const x = await setup(); t.after(() => x.controller.dispose());
  const first = x.controller.send('Fictional old chat.');
  x.advanceTo(110_000); x.starts[0].resolve(receipt()); assert.equal(await first, true);
  x.advanceTo(200_000); x.controller.reset();
  assert.equal(x.timers.size, 0); assert.deepEqual(x.ends, ['request-1']);
  const second = x.controller.send('Fictional new chat.');
  x.advanceTo(210_000); x.starts[1].resolve(receipt()); assert.equal(await second, true);
  assert.equal(x.starts[1].input.devConversationId, undefined);
  assert.deepEqual([...x.timers.values()].map(timer => timer.due), [800_000]);
  x.advanceTo(EXPIRES_AT); assert.equal(x.controller.getSnapshot().status, 'success');
  x.advanceTo(800_000); assertExpired(x);
});

test('expiry while a continuation start is pending aborts it and ignores its late receipt', async t => {
  const x = await setup(); t.after(() => x.controller.dispose());
  const first = x.controller.send('Fictional first turn.');
  x.advanceTo(110_000); x.starts[0].resolve(receipt()); assert.equal(await first, true);
  x.advanceTo(EXPIRES_AT - 1000);
  const second = x.controller.send('Fictional nearly expired continuation.');
  x.advanceTo(EXPIRES_AT); assertExpired(x); assert.equal(await second, false);
  assert.equal(x.starts[1].signal.aborted, true);
  assert.deepEqual(x.ends, ['request-1', 'request-2']);
  const expired = x.controller.getSnapshot();
  x.advanceTo(EXPIRES_AT + 1000); x.starts[1].resolve(receipt(1000)); await flush();
  assert.equal(x.controller.getSnapshot(), expired); assert.equal(x.streams.length, 1);
  assert.equal(x.timers.size, 0);
});

test('expiry during a continuation stream clears history and rejects all late callbacks', async t => {
  const pending = deferred(); let callbacks, calls = 0;
  const x = await setup({ stream: async (_id, c) => {
    if (++calls === 1) { c.onDeepChunk('Fictional first reply.'); c.onDone(); return; }
    callbacks = c; c.onDeepChunk('Private incomplete reply.'); await pending.promise;
  } });
  t.after(() => x.controller.dispose());
  const first = x.controller.send('Fictional first turn.');
  x.advanceTo(110_000); x.starts[0].resolve(receipt()); assert.equal(await first, true);
  x.advanceTo(EXPIRES_AT - 1000);
  const second = x.controller.send('Fictional streaming continuation.');
  x.starts[1].resolve(receipt(1000)); await flush();
  assert.equal(x.controller.getSnapshot().status, 'streaming');
  assert.equal(x.controller.getSnapshot().deepText, '');
  x.advanceTo(EXPIRES_AT); assertExpired(x); assert.equal(await second, false);
  assert.equal(x.streams[1][2].aborted, true);
  const expired = x.controller.getSnapshot();
  callbacks.onDeepChunk('Late private content.'); callbacks.onDone(); callbacks.onError();
  pending.resolve(); await flush();
  assert.equal(x.controller.getSnapshot(), expired); assert.equal(x.timers.size, 0);
});

for (const continuation of [false, true]) {
  test(`an overdue ${continuation ? 'continuation' : 'first'} receipt cannot stream before queued timer tasks`, async t => {
    const x = await setup(); t.after(() => x.controller.dispose());
    if (continuation) {
      const first = x.controller.send('Fictional first turn.');
      x.advanceTo(110_000); x.starts[0].resolve(receipt()); assert.equal(await first, true);
      x.advanceTo(EXPIRES_AT - 1000);
    }
    const pending = x.controller.send('Fictional overdue receipt.');
    x.elapseWithoutTimers(EXPIRES_AT);
    x.starts.at(-1).resolve(receipt(continuation ? 1000 : MAX_SESSION_MS));
    assert.equal(await pending, false); assertExpired(x);
    assert.equal(x.streams.length, continuation ? 1 : 0);
    assert.equal(x.timers.size, 0);
  });
}

test('an overdue stream completion cannot publish success before queued timer tasks', async t => {
  const pending = deferred(); let calls = 0;
  const x = await setup({ stream: async (_id, c) => {
    c.onDeepChunk('Fictional complete reply.'); c.onDone();
    if (++calls === 2) await pending.promise;
  } });
  t.after(() => x.controller.dispose());
  const first = x.controller.send('Fictional first turn.');
  x.advanceTo(110_000); x.starts[0].resolve(receipt()); assert.equal(await first, true);
  x.advanceTo(EXPIRES_AT - 1000);
  const second = x.controller.send('Fictional overdue stream.');
  x.starts[1].resolve(receipt(1000)); await flush();
  x.elapseWithoutTimers(EXPIRES_AT); pending.resolve();
  assert.equal(await second, false); assertExpired(x);
  assert.equal(x.notifications.filter(state => state.status === 'success').length, 1);
  assert.equal(x.timers.size, 0);
});

test('send at the deadline clears state without transport even if expiry timer is queued', async t => {
  const x = await setup(); t.after(() => x.controller.dispose());
  const first = x.controller.send('Fictional first turn.');
  x.advanceTo(110_000); x.starts[0].resolve(receipt()); assert.equal(await first, true);
  x.elapseWithoutTimers(EXPIRES_AT);
  const rejected = x.controller.send('Must not send.');
  assertExpired(x); assert.equal(await rejected, false);
  assert.equal(x.starts.length, 1); assert.equal(x.timers.size, 0);
});

test('a stuck first start still fails at the existing 165-second request deadline', async t => {
  const x = await setup(); t.after(() => x.controller.dispose());
  const sent = x.controller.send('Fictional pending first start.');
  x.advanceTo(FIRST_SEND + 164_999); assert.equal(x.controller.getSnapshot().status, 'starting');
  x.advanceTo(FIRST_SEND + 165_000); assert.equal(await sent, false);
  assert.equal(x.controller.getSnapshot().status, 'failed');
  assert.equal(x.controller.getSnapshot().inputText, ''); assert.equal(x.controller.getSnapshot().canSend, false);
  assert.equal(x.starts[0].signal.aborted, true); assert.deepEqual(x.ends, ['request-1']);
  x.starts[0].resolve(receipt()); await flush();
  assert.equal(x.streams.length, 0); assert.equal(x.timers.size, 0);
});
