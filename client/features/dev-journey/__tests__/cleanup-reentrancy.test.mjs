// Actual controller cancellation reentrancy; no provider or browser requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deferred, loadTsModule } from './moduleHarness.mjs';

async function scenario(transition, observer, choose) {
  let c, once = false, replacement;
  let nextRequest = 0, nextTimer = 0;
  const calls = { starts: [], ends: [] }, timers = new Map();
  const pending = deferred();
  class Clock extends Date { static now() { return 1000; } }
  const m = await loadTsModule(new URL('../realRequestController.ts', import.meta.url), {}, {
    Date: Clock,
    setTimeout(fn, ms) { timers.set(++nextTimer, { fn, ms }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  });
  function reenter() {
    if (once || !choose) return;
    once = true;
    if (choose === 'safety') c.safety('emergency');
    else {
      c.reset();
      replacement = c.send('new fictional input');
    }
  }
  c = m.createDevRealRequestController({ enabled: true, createRequestId: () => `request-${++nextRequest}`,
    transport: {
      async start(input, signal) {
        calls.starts.push({ input, signal });
        if (input.requestId === 'request-1') {
          if (observer === 'abort') signal.addEventListener('abort', reenter, { once: true });
          if (transition === 'unavailable') throw Object.assign(new Error('fixed unconfirmed start'), { code: 'dev_start_unconfirmed' });
        }
        return { sessionId: 'session', devConversationId: 'conversation', expiresAt: 10000, remainingLifetimeMs: 9000,
          devReplyContract: 'dev-reply-practice-v1', devRetryContract: 'dev-manual-retry-v1', reactionText: '', companionText: '' };
      },
      async stream(_session, cb, _signal, expected) {
        if (expected.requestId === 'request-1') {
          if (transition === 'recover') { cb.onError('retry_turn'); return; }
          await pending.promise;
          cb.onDeepChunk('late old response');
          cb.onDone({ contract: 'dev-reply-practice-v1', reply: 'late old response', practiceCandidate: null,
            source: { sessionId: 'session', devConversationId: 'conversation', requestId: expected.requestId } });
          return;
        }
        cb.onDeepChunk('new response');
        cb.onDone({ contract: 'dev-reply-practice-v1', reply: 'new response', practiceCandidate: null,
          source: { sessionId: 'session', devConversationId: 'conversation', requestId: expected.requestId } });
      },
      async end(id) { calls.ends.push(id); if (id === 'request-1' && observer === 'end') reenter(); },
    } });
  const old = c.send('old fictional input');
  for (let i = 0; i < 8; i++) await Promise.resolve();
  if (transition === 'stop' || transition === 'reset') c[transition]();
  assert.equal(await old, false);
  if (replacement) assert.equal(await replacement, true);
  pending.resolve();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  return { c, calls, timers, invoked: once };
}
const boundaries = [
  ['recover', 'abort'], ['stop', 'abort'], ['reset', 'abort'], ['unavailable', 'abort'],
  ['stop', 'end'], ['reset', 'end'], ['unavailable', 'end'],
];
for (const [transition, observer] of boundaries) {
  test(`${transition} ${observer} cleanup cannot overwrite a newer explicit safety choice`, async () => {
    const h = await scenario(transition, observer, 'safety');
    try {
      const s = h.c.getSnapshot();
      assert.equal(h.invoked, true); assert.equal(s.status, 'safety');
      assert.equal(s.safetySupport, '现在先把现实安全放在前面。请尽快联系身边可信的人、当地紧急服务或危机支持。');
      assert.equal(s.canRetry, false); assert.equal(s.canSend, false);
      for (const key of ['inputText', 'reactionText', 'companionText', 'deepText']) assert.equal(s[key], '');
      assert.equal(s.discoveryText, undefined); assert.equal(s.practiceCandidate, null);
      assert.equal(s.requestId, null); assert.equal(s.completedTurns.length, 0);
      assert.equal(h.timers.size, 0); assert.equal(h.calls.starts.length, 1);
      assert.deepEqual(h.calls.ends, ['request-1']);
      assert.equal(await h.c.retry(), false); assert.equal(await h.c.send('not sent'), false);
    } finally { h.c.dispose(); }
  });
}
for (const [transition, observer] of [['recover', 'abort'], ['stop', 'abort'], ['reset', 'end'], ['unavailable', 'end']]) {
  test(`${transition} ${observer} cleanup cannot retire a synchronously created replacement`, async () => {
    const h = await scenario(transition, observer, 'replacement');
    try {
      const s = h.c.getSnapshot();
      assert.equal(h.invoked, true); assert.equal(s.status, 'success');
      assert.equal(s.inputText, 'new fictional input'); assert.equal(s.deepText, 'new response');
      assert.equal(s.requestId, 'request-2'); assert.equal(s.canSend, true);
      assert.equal(h.calls.starts.length, 2); assert.equal(h.calls.starts[1].signal.aborted, false);
      assert.equal(h.calls.starts[1].input.devConversationId, undefined);
      assert.equal(h.calls.starts[1].input.afterRequestId, undefined);
      assert.deepEqual(h.calls.ends, ['request-1']); assert.equal(h.timers.size, 1);
    } finally { h.c.dispose(); }
    assert.deepEqual(h.calls.ends, ['request-1', 'request-2']); assert.equal(h.timers.size, 0);
  });
}
for (const [transition, status, canSend, canRetry] of [
  ['recover', 'recoverable', false, true], ['stop', 'stopped', false, false],
  ['reset', 'idle', true, false], ['unavailable', 'failed', false, false],
]) {
  test(`passive ${transition} cleanup preserves its existing contract`, async () => {
    const h = await scenario(transition, 'abort', null);
    try {
      assert.equal(h.c.getSnapshot().status, status);
      assert.equal(h.c.getSnapshot().canSend, canSend);
      assert.equal(h.c.getSnapshot().canRetry, canRetry);
      assert.equal(h.calls.starts.length, 1);
    } finally { h.c.dispose(); }
  });
}

test('unavailable end replacement retains context for third send and unique timer',async()=>{
 const h=await scenario('unavailable','end','replacement');try{
 assert.equal(await h.c.send('third fictional input'),true);
 assert.equal(h.calls.starts.length,3);
 assert.equal(h.calls.starts[2].input.devConversationId,'conversation');
 assert.equal(h.calls.starts[2].input.afterRequestId,'request-2');
 assert.equal(h.c.getSnapshot().requestId,'request-3');
 assert.equal(h.c.getSnapshot().completedTurns.length,1);
 assert.equal(h.c.getSnapshot().completedTurns[0].requestId,'request-2');
 assert.equal(h.timers.size,1);assert.deepEqual(h.calls.ends,['request-1']);
 }finally{h.c.dispose();}assert.deepEqual(h.calls.ends,['request-1','request-3']);assert.equal(h.timers.size,0);
});
test('passive unavailable deadline clears retained input without repeating retired end',async()=>{
 const h=await scenario('unavailable','end',null);try{
 assert.equal(h.c.getSnapshot().status,'failed');assert.equal(h.c.getSnapshot().inputText,'old fictional input');
 assert.equal(h.timers.size,1);assert.deepEqual(h.calls.ends,['request-1']);
 [...h.timers.values()][0].fn();
 assert.equal(h.c.getSnapshot().status,'failed');assert.equal(h.c.getSnapshot().inputText,'');
 assert.equal(h.c.getSnapshot().preserveDraft,undefined);assert.equal(h.c.getSnapshot().canRetry,false);assert.equal(h.c.getSnapshot().canSend,false);assert.equal(h.timers.size,0);assert.deepEqual(h.calls.ends,['request-1']);
 }finally{h.c.dispose();}assert.deepEqual(h.calls.ends,['request-1']);
});
