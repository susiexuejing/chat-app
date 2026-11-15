// Source-level callback reentrancy only. No provider, browser or diagnostic service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTsModule } from './moduleHarness.mjs';

const source = new URL('../realRequestController.ts', import.meta.url);
const P = 'dev-reply-practice-v1';
function assertSafety(c) {
  const s = c.getSnapshot();
  assert.equal(s.status, 'safety');
  assert.ok(s.safetySupport);
  assert.equal(s.canSend, false); assert.equal(s.canRetry, false);
  assert.equal(s.practiceCandidate, null); assert.equal(s.source, null);
  assert.equal(s.inputText, ''); assert.equal(s.deepText, '');
  assert.equal(s.completedTurns.length, 0);
}
async function setup({ atReceipt, atExpiry } = {}) {
  let now = 1000, nextTimer = 0, nextRequest = 0;
  const timers = new Map(), calls = { starts: [], streams: [], ends: [] };
  class FakeDate extends Date { static now() { return now; } }
  const m = await loadTsModule(source, {}, {
    Date: FakeDate,
    setTimeout(fn, ms) { timers.set(++nextTimer, { fn, ms }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  });
  let controller;
  controller = m.createDevRealRequestController({
    enabled: true, allowCandidateDiagnostics: true,
    createRequestId: () => `request-${++nextRequest}`,
    onCandidateDiagnostic: result => { if (result.transport === 'unavailable') atReceipt?.(controller); },
    onCandidateDiagnosticExpiry: () => atExpiry?.(controller),
    transport: {
      async start(input, signal) {
        calls.starts.push({ input, signal });
        return { sessionId: 'session', devConversationId: 'conversation', expiresAt: now + 100, remainingLifetimeMs: 100,
          devReplyContract: P, devRetryContract: 'dev-manual-retry-v1' };
      },
      async stream(session, cb, signal, expected) {
        calls.streams.push({ session, cb, signal, expected });
        cb.onDeepChunk('fictional reply');
        cb.onDone({ contract: P, reply: 'fictional reply', practiceCandidate: null,
          source: { sessionId: 'session', devConversationId: 'conversation', requestId: expected.requestId } });
      },
      async end(id) { calls.ends.push(id); },
    },
  });
  return { controller, calls, timers, expire() { now = 1101; const expiry = [...timers.values()].find(t => t.ms === 100); assert.ok(expiry); expiry.fn(); } };
}

for (const kind of ['help', 'emergency', 'unknown']) {
  test(`receipt observer cannot overwrite explicit ${kind} safety with streaming`, async () => {
    const h = await setup({ atReceipt: c => c.safety(kind) });
    assert.equal(await h.controller.send('fictional input', true), false);
    assertSafety(h.controller);
    assert.equal(h.calls.starts.length, 1); assert.equal(h.calls.streams.length, 0);
    assert.equal(h.calls.starts[0].signal.aborted, true);
    assert.deepEqual(h.calls.ends, ['request-1']);
    assert.equal(h.timers.size, 0);
    assert.equal(await h.controller.retry(), false);
    assert.equal(await h.controller.send('not sent'), false);
    h.controller.dispose();
  });
}
for (const action of ['stop', 'reset', 'dispose']) {
  test(`receipt observer honors ${action} rather than reviving streaming/context`, async () => {
    const h = await setup({ atReceipt: c => c[action]() });
    assert.equal(await h.controller.send('fictional input', true), false);
    assert.equal(h.controller.getSnapshot().status, action === 'reset' ? 'idle' : 'stopped');
    assert.equal(h.calls.streams.length, 0); assert.equal(h.timers.size, 0);
    assert.deepEqual(h.calls.ends, ['request-1']); h.controller.dispose();
  });
}
test('expiry cleanup observer cannot replace newly requested safety with expired failure', async () => {
  const h = await setup({ atExpiry: c => c.safety('emergency') });
  assert.equal(await h.controller.send('fictional input', true), true);
  h.expire(); assertSafety(h.controller);
  assert.deepEqual(h.calls.ends, ['request-1']); assert.equal(h.timers.size, 0);
  assert.equal(h.calls.starts.length, 1); h.controller.dispose();
});
test('expiry cleanup observer reset is not overwritten by the older expiry', async () => {
  const h = await setup({ atExpiry: c => c.reset() });
  assert.equal(await h.controller.send('fictional input', true), true);
  h.expire(); assert.equal(h.controller.getSnapshot().status, 'idle');
  assert.equal(h.controller.getSnapshot().canSend, true);
  assert.deepEqual(h.calls.ends, ['request-1']); h.controller.dispose();
});
test('passive observers preserve ordinary success and original expiration', async () => {
  const h = await setup();
  assert.equal(await h.controller.send('fictional input', true), true);
  assert.equal(h.controller.getSnapshot().status, 'success');
  h.expire(); assert.equal(h.controller.getSnapshot().status, 'failed');
  assert.equal(h.controller.getSnapshot().canSend, false);
  assert.equal(h.controller.getSnapshot().deepText, '');
  assert.deepEqual(h.calls.ends, ['request-1']); h.controller.dispose();
});

test('receipt reset and synchronous new send owns context, completion and timer',async()=>{
 let replacement;let once=false;
 const h=await setup({atReceipt:c=>{if(!once){once=true;c.reset();replacement=c.send('replacement',true);}}});
 assert.equal(await h.controller.send('old',true),false);assert.equal(await replacement,true);
 assert.equal(h.controller.getSnapshot().inputText,'replacement');assert.equal(h.controller.getSnapshot().requestId,'request-2');assert.equal(h.controller.getSnapshot().status,'success');
 assert.equal(h.calls.starts.length,2);assert.equal(h.calls.streams.length,1);assert.equal(h.calls.streams[0].expected.requestId,'request-2');assert.deepEqual(h.calls.ends,['request-1']);assert.equal(h.timers.size,1);
 h.controller.dispose();assert.deepEqual(h.calls.ends,['request-1','request-2']);assert.equal(h.timers.size,0);
});
test('expiry reset and synchronous new send is not cancelled by old end',async()=>{
 let replacement;let once=false;
 const h=await setup({atExpiry:c=>{if(!once){once=true;c.reset();replacement=c.send('replacement',true);}}});
 assert.equal(await h.controller.send('old',true),true);h.expire();assert.equal(await replacement,true);
 assert.equal(h.controller.getSnapshot().status,'success');assert.equal(h.controller.getSnapshot().inputText,'replacement');assert.equal(h.calls.starts.length,2);assert.equal(h.calls.streams.length,2);assert.deepEqual(h.calls.ends,['request-1']);assert.equal(h.timers.size,1);h.controller.dispose();
});
test('throwing passive receipt and expiry observers do not strand cleanup',async()=>{
 const h=await setup({atReceipt:()=>{throw Error('fixture');},atExpiry:()=>{throw Error('fixture');}});
 assert.equal(await h.controller.send('old',true),true);h.expire();assert.equal(h.controller.getSnapshot().status,'failed');assert.equal(h.timers.size,0);assert.deepEqual(h.calls.ends,['request-1']);h.controller.dispose();
});
