import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, loadTsModule } from './moduleHarness.mjs';
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
async function setup(t) {
  let now = 1000, serial = 0, timerId = 0;
  const timers = new Map(), starts = [], streams = [], ends = [];
  const mod = await loadTsModule(new URL('../realRequestController.ts', import.meta.url), {}, {
    Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const transport = {
    start: async (input, signal) => { starts.push({ input, signal }); return receipt(input.requestId); },
    stream: async (session, callbacks, signal, expected) => { streams.push({ session, callbacks, signal, expected }); callbacks.onError('retry_turn'); },
    end: async id => { ends.push(id); },
  };
  const receipt = id => ({ sessionId: `s-${id}`, devConversationId: 'conversation', expiresAt: 601000,
    remainingLifetimeMs: 601000 - now, devReplyContract: 'dev-reply-practice-v1', devRetryContract: 'dev-manual-retry-v1' });
  const controller = mod.createDevRealRequestController({ enabled: true, transport, createRequestId: () => `r-${++serial}` });
  const complete = (session, cb, _signal, expected, reply = 'validated response') => {
    cb.onDeepChunk(reply); cb.onDone({ contract: 'dev-reply-practice-v1', reply, practiceCandidate: null,
      source: { sessionId: session, devConversationId: expected.devConversationId, requestId: expected.requestId } });
  };
  t.after(() => controller.dispose());
  return { controller, transport, starts, streams, ends, receipt, complete, timers,
    advanceTo(time) { for (;;) { const entry = [...timers].filter(([, x]) => x.at <= time).sort((a,b)=>a[1].at-b[1].at)[0]; if (!entry) break;
      const [id, x] = entry; timers.delete(id); now = x.at; x.fn(); } now = time; } };
}
test('manual recovery retains completed history, user bubble, no partial facts; new IDs and no duplicate turn', async t => {
  const x = await setup(t); x.transport.stream = async (...a) => x.complete(...a);
  assert.equal(await x.controller.send('first'), true);
  x.transport.stream = async (_s, cb) => { cb.onDeepChunk('unvalidated private partial'); cb.onError('retry_turn'); };
  assert.equal(await x.controller.send('second'), false);
  const failed = x.controller.getSnapshot();
  assert.equal(failed.error, '刚才的回复没有完成，可以重试'); assert.equal(failed.canRetry, true);
  assert.equal(failed.deepText, ''); assert.equal(failed.source, null); assert.equal(failed.practiceCandidate, null);
  assert.equal(failed.completedTurns.length, 1); assert.equal(failed.inputText, 'second'); assert.equal(x.ends.length, 0);
  assert.equal(await x.controller.send('not a retry'), false); assert.equal(x.starts.length, 2);
  const pending = deferred(); x.transport.stream = async (...a) => { await pending.promise; x.complete(...a); };
  const retry = x.controller.retry(); await flush();
  assert.equal(await x.controller.retry(), false); assert.equal(x.starts.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(x.starts[2].input)), { roleId: 'clever-fox', message: 'second', requestId: 'r-3', retryOfRequestId: 'r-2' });
  pending.resolve(); assert.equal(await retry, true);
  assert.equal(x.controller.getSnapshot().logicalRequestId, 'r-2'); assert.equal(x.controller.getSnapshot().completedTurns.length, 1);
  x.transport.stream = async (...a) => x.complete(...a); assert.equal(await x.controller.send('third'), true);
  assert.equal(x.starts[3].input.afterRequestId, 'r-3'); assert.equal(x.controller.getSnapshot().completedTurns.length, 2);
  assert.equal(x.controller.getSnapshot().completedTurns[1].logicalRequestId, 'r-2');
});
test('pending 409 never advances anchor; subsequent admitted failure does', async t => {
  const x = await setup(t); await x.controller.send('same');
  const start = x.transport.start; x.transport.start = async (...a) => { await start(...a); throw Object.assign(new Error('safe'), { code: 'dev_retry_pending' }); };
  assert.equal(await x.controller.retry(), false); assert.equal(x.controller.getSnapshot().canRetry, true);
  x.transport.start = start; await x.controller.retry(); await x.controller.retry();
  assert.equal(x.starts[1].input.retryOfRequestId, 'r-1'); assert.equal(x.starts[2].input.retryOfRequestId, 'r-1');
  assert.equal(x.starts[3].input.retryOfRequestId, 'r-3');
});
for (const mode of ['eof', 'throw', 'timeout']) test(`negotiated ${mode} allows explicit replay and ignores stale callbacks`, async t => {
  const x = await setup(t); let old; const pending = deferred();
  x.transport.stream = async (...a) => { old = a; a[1].onDeepChunk('partial'); if (mode === 'throw') throw new Error('connection lost'); if (mode === 'timeout') await pending.promise; };
  const run = x.controller.send('same'); await flush(); if (mode === 'timeout') x.advanceTo(166000); await run;
  assert.equal(x.controller.getSnapshot().canRetry, true);
  x.transport.stream = async (...a) => x.complete(...a, 'validated cached reply');
  assert.equal(await x.controller.retry(), true); const snapshot = x.controller.getSnapshot();
  old[1].onDeepChunk('late'); old[1].onError('terminal'); old[1].onDone(); pending.resolve(); await flush();
  assert.equal(x.controller.getSnapshot(), snapshot); assert.equal(snapshot.deepText, 'validated cached reply');
});
for (const method of ['stop', 'reset', 'dispose']) test(`${method} clears recovery and invalidates late callbacks`, async t => {
  const x = await setup(t); await x.controller.send('same'); const callbacks = x.streams[0].callbacks;
  x.controller[method](); callbacks.onDeepChunk('late'); callbacks.onDone();
  assert.equal(await x.controller.retry(), false); assert.equal(x.controller.getSnapshot().inputText, ''); assert.equal(x.controller.getSnapshot().completedTurns.length, 0);
});
test('retries and pending states never renew original 10 minute expiry', async t => {
  const x = await setup(t); await x.controller.send('same'); x.advanceTo(500000); await x.controller.retry();
  x.advanceTo(600999); assert.equal(x.controller.getSnapshot().canRetry, true);
  x.advanceTo(601000); assert.equal(x.controller.getSnapshot().inputText, ''); assert.equal(await x.controller.retry(), false);
});
for (const mode of ['terminal', 'terminal-then-throw', 'mismatch', 'legacy']) test(`${mode} stays terminal without retry`, async t => {
  const x = await setup(t);
  if (mode === 'legacy') x.transport.start = async input => ({ ...x.receipt(input.requestId), devRetryContract: undefined });
  x.transport.stream = async (s, cb, signal, expected) => {
    if (mode === 'mismatch') x.complete(s, cb, signal, { ...expected, requestId: 'wrong' });
    else cb.onError(mode === 'legacy' ? 'retry_turn' : 'terminal');
    if (mode === 'terminal-then-throw') throw new Error('later network loss');
  };
  await x.controller.send('same'); assert.equal(x.controller.getSnapshot().canRetry, false); assert.equal(x.controller.getSnapshot().inputText, '');
});
test('valid in-contract safety refusal is successful, not retryable', async t => {
  const x = await setup(t); x.transport.stream = async (...a) => x.complete(...a, '我不能帮助这个请求。');
  assert.equal(await x.controller.send('fictional input'), true); assert.equal(x.controller.getSnapshot().canRetry, false);
});
test('uncertain retry start retains read-only input, does not retry unknown attempt, expires on original deadline', async t => {
  const x = await setup(t); await x.controller.send('same');
  x.transport.start = async () => { throw Object.assign(new Error('safe'), { code: 'dev_start_unconfirmed' }); };
  await x.controller.retry(); assert.equal(x.controller.getSnapshot().canRetry, false); assert.equal(x.controller.getSnapshot().inputText, 'same');
  assert.equal(await x.controller.retry(), false); x.advanceTo(601000); assert.equal(x.controller.getSnapshot().inputText, '');
});
test('start HTTP/auth/unknown failures never offer retry', async t => {
  const x = await setup(t); x.transport.start = async () => { throw new Error('HTTP 403'); };
  await x.controller.send('same'); assert.equal(x.controller.getSnapshot().canRetry, false); assert.equal(await x.controller.retry(), false);
});
