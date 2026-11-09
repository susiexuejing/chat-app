// Actual registered handlers, provider assembly and SSE/store lifecycle.
// Only clocks, auth/provider promises and observations are controlled. No I/O.
import assert from 'node:assert/strict';
import test from 'node:test';
import { body, deferred, harness, MESSAGE, ORDINARY_START, plain, providerResponse, REPLY, settle, START, STREAM } from './devEphemeralHarness.mjs';

const END = '/api/v1/chat/dev-journey/end';
const categories = h => h.calls.filter(x => x.name === 'audit').map(x => x.args[0].providerCategory).filter(Boolean);
const completed = h => categories(h).filter(x => x === 'stream_completed');
const payload = text => ({ done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`) });
async function start(h, ordinary = false) {
  const r = await h.request('POST', ordinary ? ORDINARY_START : START, { input: ordinary
    ? { roleId: 'clever-fox', message: MESSAGE, conversationId: 'existing', requestId: 'ordinary-deadline' } : body() });
  await settle();
  assert.equal(r.res.statusCode, 200);
  return r;
}
const open = (h, r) => h.request('GET', STREAM, { query: { sessionId: r.res.body.sessionId } });
function noCompletion(h, stream) {
  assert.equal(h.sessions[0].deepDone, false);
  assert.deepEqual(plain(h.sessions[0].deepChunks), []);
  assert.deepEqual(completed(h), []);
  assert.ok(!h.calls.some(x => ['ltu.updateProfile', 'evolution.adjustWeights', 'neural.updateAfterSession', 'neural.saveProfiles'].includes(x.name)));
  if (stream) assert.ok(!stream.events().some(x => ['deep.delta', 'deep.completed', 'turn.completed'].includes(x.eventType)));
}
function delayedBody(cancel = async () => {}) {
  const pending = deferred();
  let reads = 0, cancels = 0;
  const response = { ...providerResponse(), body: { getReader: () => ({
    read: () => ++reads === 1 ? pending.promise : Promise.resolve({ done: true }),
    cancel: () => { cancels++; return cancel(); },
  }) } };
  return { pending, response, reads: () => reads, cancels: () => cancels };
}

for (const ordinary of [false, true]) for (const elapsed of [70000, 119999]) {
  test(`${ordinary ? 'ordinary 60s failure' : 'DEV bounded success'} with body ready at ${elapsed}ms`, async () => {
    const d = delayedBody();
    const h = await harness({ provider: async () => d.response, realValidator: true });
    const r = await start(h, ordinary), stream = await open(h, r);
    h.tick(elapsed); await settle();
    d.pending.resolve(payload(REPLY)); await settle(); h.tick(100); await settle();
    if (ordinary) {
      noCompletion(h, stream);
      assert.ok(categories(h).includes('stream_timeout'));
      assert.equal(h.sessions[0].deepError, 'deep_analysis_failure');
    } else {
      assert.equal(stream.events().filter(x => x.eventType === 'turn.completed').length, 1);
      assert.ok(stream.events().some(x => x.eventType === 'deep.delta' && x.content));
      assert.deepEqual(completed(h), ['stream_completed']);
      assert.equal(h.sessions[0].deepError, null);
      assert.deepEqual(h.identityCalls(), []);
      assert.equal(r.res.body.remainingLifetimeMs, 600000, 'conversation expiry unchanged');
      assert.equal(Object.hasOwn(r.res.body, 'devDeepDeadlineAt'), false, 'deadline stays private');
    }
    const args = JSON.parse(h.providerRequests[0].options.body);
    assert.equal(args.max_tokens, 1200); assert.equal(args.temperature, 0.6); assert.equal(args.stream, true);
    assert.equal(h.providerRequests.length, 1);
  });
}

for (const justInTime of [false, true]) test(`auth/session/header elapsed deducted from one 135s deadline: ${justInTime ? '134999 success' : '135000 failure'}`, async () => {
  const auth = deferred(), headers = deferred(), d = delayedBody();
  let h;
  h = await harness({ authWait: req => req.body?.message ? auth.promise : undefined,
    onCall: (name, args) => { if (name === 'audit' && args[0]?.dbSessionCategory === 'session_created') h.elapse(10000); },
    provider: () => headers.promise });
  const pending = start(h); await settle();
  h.tick(20000); auth.resolve(); const r = await pending;
  assert.equal(h.now(), 130000);
  assert.equal(h.sessions[0].devDeepDeadlineAt, 235000);
  h.tick(20000); headers.resolve(d.response); await settle();
  const stream = await open(h, r);
  h.tick(justInTime ? 84999 : 85000); await settle();
  d.pending.resolve(payload(REPLY)); await settle();
  if (justInTime) {
    assert.equal(h.sessions[0].deepDone, true);
    assert.deepEqual(completed(h), ['stream_completed']);
    assert.equal(h.now(), 234999);
    // Acceptance succeeded, but a later SSE poll still must obey the deadline.
  } else {
    noCompletion(h, stream);
    assert.equal(h.sessions[0].deepError, 'deep_analysis_failure');
  }
  assert.equal(h.providerRequests.length, 1);
  stream.close();
});

for (const phase of ['auth', 'session', 'prompt']) test(`expired ${phase} work never invokes provider, without a pending-auth watchdog`, async () => {
  const auth = deferred(); let h;
  h = await harness({ authWait: req => phase === 'auth' && req.body?.message ? auth.promise : undefined,
    onCall: (name, args) => { if ((phase === 'session' && name === 'audit' && args[0]?.dbSessionCategory === 'session_created') || (phase === 'prompt' && name === 'prompt')) h.elapse(135000); } });
  let settled = false;
  const pending = start(h).then(r => { settled = true; return r; });
  await settle();
  if (phase === 'auth') {
    h.tick(135000); await settle();
    assert.equal(settled, false, 'auth is not forcibly interrupted');
    assert.equal(h.sessions.length, 0); assert.equal(h.providerRequests.length, 0);
    auth.resolve();
  }
  const r = await pending;
  noCompletion(h);
  assert.equal(h.providerRequests.length, 0);
  assert.equal(h.sessions[0].deepError, 'deep_analysis_failure');
  assert.equal((await open(h, r)).res.statusCode, 404);
});

for (const authMs of [0, 110000]) for (const late of ['resolve', 'reject']) {
  test(`header wait capped by ${authMs ? 'remaining 25s' : '60s'}; late ${late} cannot revive it`, async () => {
    const headers = deferred(), auth = deferred(), cancel = deferred(); let cancelled = 0;
    const h = await harness({ authWait: req => req.body?.message ? auth.promise : undefined, provider: () => headers.promise });
    const pending = start(h); await settle(); h.tick(authMs); auth.resolve(); const r = await pending;
    const stream = await open(h, r);
    const wait = Math.min(60000, 135000 - authMs);
    h.tick(wait - 1); await settle();
    assert.equal(h.sessions[0].deepError, null);
    assert.equal(h.providerRequests[0].options.signal.aborted, false);
    h.tick(1); await settle();
    assert.equal(h.providerRequests[0].options.signal.aborted, true);
    assert.equal(h.sessions[0].deepError, 'deep_analysis_failure');
    noCompletion(h, stream);
    if (late === 'resolve') headers.resolve({ ...providerResponse(), body: { cancel: () => { cancelled++; return cancel.promise; } } });
    else headers.reject(new Error('late header rejection'));
    await settle(); h.tick(100); await settle();
    noCompletion(h, stream);
    assert.equal(cancelled, late === 'resolve' ? 1 : 0);
    if (late === 'resolve') cancel.reject(new Error('late cancel rejection'));
    await settle();
    assert.equal(h.providerRequests.length, 1);
    assert.equal((await open(h, r)).res.statusCode, 404);
  });
}

for (const late of ['resolve', 'reject']) for (const cancelResult of ['resolve', 'reject']) {
  test(`120s body cap survives late read ${late} and delayed cancel ${cancelResult}`, async () => {
    const cancel = deferred(), d = delayedBody(() => cancel.promise);
    const h = await harness({ provider: async () => d.response });
    const r = await start(h), stream = await open(h, r);
    h.tick(119999); await settle(); assert.equal(h.sessions[0].deepError, null);
    h.tick(1); await settle(); h.tick(100); await settle();
    assert.equal(d.cancels(), 1);
    noCompletion(h, stream);
    const before = JSON.stringify([h.calls, stream.res.writes]);
    if (late === 'resolve') d.pending.resolve(payload(REPLY)); else d.pending.reject(new Error('late read'));
    if (cancelResult === 'resolve') cancel.resolve(); else cancel.reject(new Error('late cancel'));
    await settle(); h.tick(100); await settle();
    assert.equal(JSON.stringify([h.calls, stream.res.writes]), before);
    noCompletion(h, stream);
  });
}

test('completed body read cannot publish when synchronous validation crosses the deadline', async () => {
  let h;
  h = await harness({ onCall: name => { if (name === 'validator') h.elapse(135000); }, realValidator: true });
  const r = await start(h);
  assert.equal(h.calls.filter(x => x.name === 'validator').length, 1);
  noCompletion(h);
  assert.equal(h.sessions[0].deepError, 'deep_analysis_failure');
  assert.equal((await open(h, r)).res.statusCode, 404);
});

for (const delayed of ['attach', 'poll']) test(`delayed SSE ${delayed} cannot emit accepted Deep or save context after cutoff`, async () => {
  const h = await harness(); const r = await start(h);
  assert.equal(h.sessions[0].deepDone, true, 'provider accepted before deadline');
  const stream = delayed === 'poll' ? await open(h, r) : null;
  if (delayed === 'poll') { h.elapse(135000); h.tick(0); await settle(); }
  else { h.tick(135000); await settle(); }
  if (stream) {
    assert.ok(!stream.events().some(x => ['deep.delta', 'deep.completed', 'turn.completed'].includes(x.eventType)));
    assert.equal(stream.res.ended, true);
  } else assert.equal((await open(h, r)).res.statusCode, 404);
  const next = await h.request('POST', START, { input: body({ requestId: `${h.now()}_next`,
    devConversationId: r.res.body.devConversationId, afterRequestId: '100000_request_1' }) });
  assert.equal(next.res.statusCode, 404, 'late completion cannot append a reusable pair');
  assert.deepEqual(plain(h.sessions[0].deepChunks), []);
  assert.deepEqual(h.identityCalls(), []);
  assert.equal(h.providerRequests.length, 1);
});

for (const phase of ['headers', 'body']) test(`explicit stop wins before ${phase} deadline and late success`, async () => {
  const headers = deferred(), d = delayedBody();
  const h = await harness({ provider: () => phase === 'headers' ? headers.promise : d.response });
  const r = await start(h), stream = await open(h, r);
  h.tick(1000);
  const end = await h.request('POST', END, { input: { requestMode: body().requestMode, requestId: body().requestId } });
  assert.equal(end.res.statusCode, 200); await settle();
  headers.resolve(providerResponse()); d.pending.resolve(payload(REPLY));
  await settle(); h.tick(135000); await settle();
  noCompletion(h, stream); assert.equal((await open(h, r)).res.statusCode, 404);
});

for (const behavior of ['throw', 'reject', 'pending-resolve', 'pending-reject']) for (const status of [302, 401, 500]) {
  test(`DEV HTTP ${status} reads no body and fails immediately with cancel ${behavior}`, async () => {
    const cancel = deferred(); let reads = 0, cancels = 0, readers = 0;
    const h = await harness({ provider: async () => ({ ok: false, status,
      text: () => { reads++; return new Promise(() => {}); },
      body: { getReader: () => { readers++; throw new Error('unused reader'); }, cancel: () => {
        cancels++;
        if (behavior === 'throw') throw new Error('cancel sync');
        if (behavior === 'reject') return Promise.reject(new Error('cancel rejection'));
        return cancel.promise;
      } },
    }) });
    const r = await start(h);
    assert.equal(reads, 0); assert.equal(readers, 0); assert.equal(cancels, 1);
    assert.equal(h.sessions[0].deepError, 'provider_api_error');
    assert.equal(h.sessions[0].deepStreaming, false); noCompletion(h);
    assert.equal((await open(h, r)).res.statusCode, 404);
    const before = JSON.stringify(h.calls);
    if (behavior === 'pending-reject') cancel.reject(new Error('late cancellation'));
    if (behavior === 'pending-resolve') cancel.resolve();
    await settle(); h.tick(135000); await settle();
    assert.equal(JSON.stringify(h.calls), before);
    assert.equal(h.providerRequests.length, 1); assert.deepEqual(h.identityCalls(), []);
  });
}

for (const phase of ['headers', 'body']) test(`delayed timer callbacks cannot extend the DEV ${phase} cap`, async () => {
  const headers = deferred(), d = delayedBody();
  const h = await harness({ provider: () => phase === 'headers' ? headers.promise : d.response });
  const r = await start(h);
  // Simulate a busy event loop: wall clock advances without running timers.
  h.elapse(phase === 'headers' ? 60000 : 120000);
  if (phase === 'headers') headers.resolve(providerResponse()); else d.pending.resolve(payload(REPLY));
  await settle();
  noCompletion(h);
  assert.equal(h.sessions[0].deepError, 'deep_analysis_failure');
  assert.equal((await open(h, r)).res.statusCode, 404);
});

for (const phase of ['serialization', 'request_started']) test(`expiry during ${phase} prevents fetch invocation`, async () => {
  let h;
  h = await harness({
    onSerialize: value => { if (phase === 'serialization' && value?.max_tokens === 1200) h.elapse(135000); },
    onCall: (name, args) => { if (phase === 'request_started' && name === 'audit' && args[0].providerCategory === 'request_started') h.elapse(135000); },
  });
  const r = await start(h);
  assert.equal(h.providerRequests.length, 0);
  noCompletion(h);
  assert.equal(h.sessions[0].deepError, 'deep_analysis_failure');
  assert.equal((await open(h, r)).res.statusCode, 404);
});

for (const ordinary of [false, true]) test(`${ordinary ? 'ordinary unchanged' : 'DEV refuses context save'} when a Deep write crosses cutoff`, async () => {
  let h;
  h = await harness({ onWrite: value => { if (value.includes('"eventType":"deep.delta"')) h.elapse(135000); } });
  const r = await start(h, ordinary), stream = await open(h, r);
  h.tick(3100); await settle();
  assert.equal(stream.events().filter(x => x.eventType === 'deep.delta').length, 1, 'write began before deadline');
  assert.equal(stream.events().some(x => x.eventType === 'turn.completed'), ordinary);
  if (!ordinary) {
    assert.equal(stream.events().at(-1).eventType, 'error');
    const next = await h.request('POST', START, { input: body({ requestId: `${h.now()}_next`,
      devConversationId: r.res.body.devConversationId, afterRequestId: '100000_request_1' }) });
    assert.equal(next.res.statusCode, 404, 'context cannot be accepted after a slow write');
    assert.deepEqual(h.identityCalls(), []);
  }
});
