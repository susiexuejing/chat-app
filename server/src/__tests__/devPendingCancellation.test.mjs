// Actual controller -> actual registered handlers/store/provider-request assembly.
// Authentication timing, transport, provider response and clocks are hermetic mocks.
import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, harness, MODE, plain, providerResponse, settle, START, STREAM } from './devEphemeralHarness.mjs';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';

const END = '/api/v1/chat/dev-journey/end';
const FIRST = '虚构测试：我想先整理眼前的材料。';
const NEXT = '虚构测试：这是尚未接纳的下一条输入。';
const REPLY = '可以从眼前最想整理的材料说起，先把这一件事情说清楚。';

async function chain({ abortVisible = false, failedEnd, deferEnds = false } = {}) {
  const auth = deferred(), seen = deferred(), streamRelease = deferred(), streamSeen = deferred();
  let blockNext = false, failBeforeRequest = false, blockedId, pauseNextStream = false;
  let serial = 0, timerId = 0;
  const starts = [], ends = [], streams = [], endTasks = [], endGates = new Map(), timers = new Map();
  const h = await harness({
    provider: async () => providerResponse({ text: REPLY }),
    authWait: async req => {
      if (req.body?.message && req.body.requestId === blockedId) {
        seen.resolve(req);
        await auth.promise;
      }
    },
  });
  const { createDevRealRequestController } = await loadTsModule(
    new URL('../../../client/features/dev-journey/realRequestController.ts', import.meta.url), {}, {
      Date: class extends Date { static now() { return h.now(); } },
      setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
      clearTimeout: id => timers.delete(id),
    });
  const controller = createDevRealRequestController({ enabled: true,
    createRequestId: () => `${h.now()}_chain-${++serial}`,
    transport: {
      start: async (input, signal) => {
        const row = { input: plain(input), signal }; starts.push(row);
        const blocked = blockNext; blockNext = false;
        if (blocked) {
          blockedId = input.requestId;
          if (failBeforeRequest) throw new Error('mock transport failure before request');
        }
        const operation = h.request('POST', START, { input: { requestMode: MODE, ...input } });
        if (blocked && abortVisible) {
          const req = await seen.promise;
          signal.addEventListener('abort', () => { req.aborted = true; }, { once: true });
        }
        const response = await operation; row.response = response;
        if (response.res.statusCode !== 200) throw new Error(`start_http_${response.res.statusCode}`);
        return response.res.body;
      },
      stream: async (sessionId, callbacks, signal) => {
        const response = await h.request('GET', STREAM, { query: { sessionId } });
        assert.equal(response.res.statusCode, 200);
        const row = { response, callbacks }; streams.push(row);
        if (pauseNextStream) { pauseNextStream = false; streamSeen.resolve(row); await streamRelease.promise; }
        await settle(); h.tick(3100); await settle();
        for (const event of response.events()) {
          if (signal.aborted) break;
          if (event.eventType === 'deep.delta') callbacks.onDeepChunk(event.content);
          if (event.eventType === 'turn.completed') callbacks.onDone();
          if (event.eventType === 'error') callbacks.onError();
        }
      },
      end: requestId => {
        const row = { requestId }; ends.push(row);
        if (failedEnd?.index === ends.length - 1) {
          row.failure = failedEnd.kind;
          if (failedEnd.kind === 'throw') throw new Error('mock end throw');
          if (failedEnd.kind === 'reject') return Promise.reject(new Error('mock end rejection'));
          return new Promise(() => undefined);
        }
        const deliver = async () => {
          const result = await h.request('POST', END, { input: { requestMode: MODE, requestId } });
          row.status = result.res.statusCode;
          assert.deepEqual(plain(result.res.body), { ended: true });
        };
        let task;
        if (deferEnds) {
          const gate = deferred(); endGates.set(requestId, gate); task = gate.promise.then(deliver);
        } else task = deliver();
        endTasks.push(task); return task;
      },
    },
  });
  return { h, controller, starts, ends, streams, auth, seen, streamRelease, streamSeen, endGates,
    block: (fail = false) => { blockNext = true; failBeforeRequest = fail; },
    pauseStream: () => { pauseNextStream = true; },
    flushEnds: () => Promise.all(endTasks),
    timeout: () => {
      const timer = [...timers.values()].find(value => value.ms === 165000);
      assert.ok(timer); timer.fn();
    },
    probe: (started, suffix = 'probe') => h.request('POST', START, { input: {
      requestMode: MODE, roleId: 'clever-fox', message: '虚构测试：明确探测已结束的旧会话。',
      requestId: `${h.now()}_${suffix}`, devConversationId: started.response.res.body.devConversationId,
      afterRequestId: started.input.requestId,
    } }),
  };
}

function assertCleared(controller) {
  const snapshot = plain(controller.getSnapshot());
  assert.equal(snapshot.requestId, null); assert.equal(snapshot.inputText, '');
  assert.equal(snapshot.deepText, ''); assert.deepEqual(snapshot.completedTurns, []);
}

for (const action of ['stop', 'reset', 'dispose', 'timeout', 'failure']) {
  for (const abortVisible of action === 'failure' ? [false] : [false, true]) {
    test(`controller/handler pending cancellation: ${action}, server abort visible=${abortVisible}`, async () => {
      const x = await chain({ abortVisible });
      assert.equal(await x.controller.send(FIRST), true);
      x.block(action === 'failure'); const pending = x.controller.send(NEXT);
      if (action !== 'failure') {
        await x.seen.promise; await settle();
        assert.equal(x.controller.getSnapshot().status, 'starting');
        assert.equal(x.h.providerRequests.length, 1);
        if (action === 'timeout') x.timeout(); else x.controller[action]();
      }
      assert.equal(await pending, false); await x.flushEnds();
      assertCleared(x.controller);
      const ids = x.starts.map(row => row.input.requestId);
      assert.deepEqual(x.ends, ids.map(requestId => ({ requestId, status: 200 })));
      x.auth.resolve(); await settle();
      if (action !== 'failure') assert.equal(x.starts[1].response.res.statusCode, 409);
      assert.equal((await x.probe(x.starts[0])).res.statusCode, 404, 'previous accepted anchor is revoked');
      assert.equal(x.h.providerRequests.length, 1, 'no provider call for delayed start or old anchor');
      assert.equal(x.streams.length, 1, 'late start never attaches another stream');
      assert.deepEqual(x.h.identityCalls(), []);
      x.controller.stop(); x.controller.reset(); x.controller.dispose(); x.controller.dispose();
      assert.equal(x.ends.length, 2, 'repeated cleanup does not re-send either end');
    });
  }
}

for (const kind of ['throw', 'reject', 'hang']) for (const index of [0, 1]) {
  test(`controller/handler each cleanup is independent: ${kind} at ${index === 0 ? 'accepted' : 'pending'} ID`, async () => {
    const x = await chain({ failedEnd: { kind, index } });
    assert.equal(await x.controller.send(FIRST), true);
    x.block(); const pending = x.controller.send(NEXT); await x.seen.promise;
    x.controller.stop(); assert.equal(await pending, false); await x.flushEnds(); await settle();
    assertCleared(x.controller);
    assert.deepEqual(x.ends.map(row => row.requestId), x.starts.map(row => row.input.requestId));
    assert.equal(x.ends[1 - index].status, 200, 'the other cleanup is dispatched without waiting for this one');
    x.auth.resolve(); await settle();
    assert.equal(x.starts[1].response.res.statusCode, index === 0 ? 409 : 404);
    if (index === 1) assert.equal((await x.probe(x.starts[0])).res.statusCode, 404);
    else {
      // Delivery failure is still best effort. Existing authoritative expiry remains the backstop.
      x.h.tick(600000);
      assert.equal((await x.probe(x.starts[0])).res.statusCode, 404);
    }
    assert.equal(x.h.providerRequests.length, 1);
    assert.deepEqual(x.h.identityCalls(), []);
    x.controller.dispose(); assert.equal(x.ends.length, 2);
  });
}

for (const first of [0, 1]) test(`controller/handler cleanup delivery order: ${first === 0 ? 'accepted' : 'pending'} first`, async () => {
  const x = await chain({ deferEnds: true });
  assert.equal(await x.controller.send(FIRST), true);
  x.block(); const pending = x.controller.send(NEXT); await x.seen.promise;
  x.controller.stop(); assert.equal(await pending, false);
  const ids = x.ends.map(row => row.requestId); assert.equal(ids.length, 2);
  x.endGates.get(ids[first]).resolve(); await settle();
  x.auth.resolve(); await settle();
  assert.equal(x.starts[1].response.res.statusCode, first === 0 ? 404 : 409);
  x.endGates.get(ids[1 - first]).resolve(); await x.flushEnds();
  assert.equal((await x.probe(x.starts[0])).res.statusCode, 404);
  assert.equal(x.h.providerRequests.length, 1); assert.equal(x.streams.length, 1);
  x.controller.dispose(); assert.equal(x.ends.length, 2);
});

test('controller/handler first pending turn has one cleanup and no provider', async () => {
  const x = await chain(); x.block();
  const pending = x.controller.send(FIRST); await x.seen.promise;
  x.controller.stop(); assert.equal(await pending, false); await x.flushEnds();
  x.auth.resolve(); await settle();
  assert.deepEqual(x.ends, [{ requestId: x.starts[0].input.requestId, status: 200 }]);
  assert.equal(x.starts[0].response.res.statusCode, 409); assert.equal(x.h.providerRequests.length, 0);
  assertCleared(x.controller); x.controller.dispose(); assert.equal(x.ends.length, 1);
});

test('controller/handler completed context deduplicates accepted and latest IDs', async () => {
  const x = await chain(); assert.equal(await x.controller.send(FIRST), true);
  x.controller.stop(); await x.flushEnds();
  assert.deepEqual(x.ends, [{ requestId: x.starts[0].input.requestId, status: 200 }]);
  assert.equal((await x.probe(x.starts[0])).res.statusCode, 404);
  assert.equal(x.h.providerRequests.length, 1); x.controller.dispose(); assert.equal(x.ends.length, 1);
});

test('controller/handler admitted continuation uses one cleanup and ignores late stream callbacks', async () => {
  const x = await chain(); assert.equal(await x.controller.send(FIRST), true);
  x.pauseStream(); const pending = x.controller.send(NEXT); const late = await x.streamSeen.promise;
  assert.equal(x.controller.getSnapshot().status, 'streaming');
  x.controller.stop(); assert.equal(await pending, false); await x.flushEnds();
  assert.deepEqual(x.ends, [{ requestId: x.starts[1].input.requestId, status: 200 }]);
  const cleared = x.controller.getSnapshot();
  late.callbacks.onDeepChunk('late content'); late.callbacks.onDone(); late.callbacks.onError();
  x.streamRelease.resolve(); await settle();
  assert.equal(x.controller.getSnapshot(), cleared);
  assert.equal((await x.probe(x.starts[0], 'old-probe')).res.statusCode, 404);
  assert.equal((await x.probe(x.starts[1], 'admitted-probe')).res.statusCode, 404);
  assert.equal(x.h.providerRequests.length, 2, 'only the two explicitly admitted sends reached the mock provider');
  x.controller.dispose(); assert.equal(x.ends.length, 1);
});

test('controller/handler reset starts a fresh explicit conversation unaffected by the retired start', async () => {
  const x = await chain(); assert.equal(await x.controller.send(FIRST), true);
  x.block(); const pending = x.controller.send(NEXT); await x.seen.promise;
  x.controller.reset(); assert.equal(await pending, false); await x.flushEnds();
  assert.equal(x.h.providerRequests.length, 1, 'reset never sends automatically');
  assert.equal(await x.controller.send('虚构测试：明确开始新对话。'), true);
  assert.equal(x.starts[2].input.devConversationId, undefined);
  const fresh = x.controller.getSnapshot();
  x.auth.resolve(); await settle();
  assert.equal(x.starts[1].response.res.statusCode, 409);
  assert.equal(x.controller.getSnapshot(), fresh);
  assert.equal((await x.probe(x.starts[0])).res.statusCode, 404);
  assert.equal(x.h.providerRequests.length, 2);
  assert.deepEqual(JSON.parse(x.h.providerRequests[1].options.body).messages.slice(1), [
    { role: 'user', content: x.starts[2].input.message },
  ]);
  x.controller.dispose(); await x.flushEnds(); assert.equal(x.ends.length, 3);
});
