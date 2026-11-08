// Runs through the existing EF-385 backend CI entrypoint. No external I/O.
import assert from 'node:assert/strict';
import test from 'node:test';
import { body, deferred, harness, MODE, OWNER, plain, providerResponse, settle, START, STREAM } from './devEphemeralHarness.mjs';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';
const END = '/api/v1/chat/dev-journey/end';
const begin = async (h, input, options = {}) => { const r = await h.request('POST', START, { input, ...options }); await settle(); return r; };
const complete = async (h, started) => {
  const stream = await h.request('GET', STREAM, { query: { sessionId: started.res.body.sessionId } });
  h.tick(3100); await settle();
  assert.equal(stream.events().at(-1)?.eventType, 'turn.completed');
  return stream;
};
const nextBody = (h, started, requestId, message = '虚构测试：我想继续说清楚眼前这一件事情。') => body({
  requestId: `${h.now()}_${requestId}`, message,
  devConversationId: started.res.body.devConversationId, afterRequestId: started.req.body.requestId,
});

test('four explicit turns send only bounded role-separated completed raw pairs; turn3+ remains isolated and safe', async () => {
  const h = await harness();
  const inputs = [], replies = [];
  let previous;
  for (let i = 1; i <= 5; i++) {
    const input = `虚构测试第${i}轮：我想说清楚眼前的安排。`;
    const started = await begin(h, previous ? nextBody(h, previous, `turn-${i}`, input) : body({ message: input }));
    assert.equal(started.res.statusCode, 200);
    assert.equal(started.res.body.userTurn, i);
    for (const name of ['local.reaction', 'local.companion']) {
      const calls = h.calls.filter(call => call.name === name);
      assert.equal(calls.length, i, 'exactly one generator call per explicit DEV turn');
      assert.deepEqual(plain(calls.at(-1).args), ['clever-fox', input, {}, 1], 'DEV generators retain raw current input and safe entry turn even after turn two');
    }
    assert.equal(started.res.body.expiresAt, 700000, 'absolute, never sliding');
    const sent = JSON.parse(h.providerRequests.at(-1).options.body);
    const prior = inputs.slice(-3).flatMap((user, index) => [
      { role: 'user', content: user }, { role: 'assistant', content: replies.slice(-3)[index] },
    ]);
    assert.deepEqual(sent.messages.slice(1), [...prior, { role: 'user', content: input }]);
    assert.match(sent.messages[0].content, new RegExp(`当前是第 ${i} 轮`));
    assert.doesNotMatch(sent.messages[0].content, /生命系统|你首先是一个真实的人|PRIOR-PRIVATE/);
    if (i > 1) assert.match(sent.messages[0].content, /assistant 消息只供理解对话衔接/);
    const validation = h.calls.filter(x => x.name === 'validator').at(-1).args[0];
    assert.equal(validation.userTurn, 1, 'DEV safety is independent of conversation turn');
    assert.equal(validation.userMessage, input, 'classification remains current input');
    assert.deepEqual(plain(validation.sameSessionUserMessages), inputs.slice(-3));
    const stream = await complete(h, started);
    const reply = stream.events().find(x => x.eventType === 'deep.delta').content;
    inputs.push(input); replies.push(reply); previous = started;
    assert.deepEqual(h.identityCalls(), []);
    assert.equal(h.sessions.at(-1).userMessage, '');
    assert.deepEqual(plain(h.sessions.at(-1).deepChunks), []);
  }
});

test('duplicate, overlapping, stale anchor, foreign owner and repeated SSE never invoke a second provider', async () => {
  const h = await harness(); const first = await begin(h, body());
  assert.equal((await begin(h, body())).res.statusCode, 409);
  assert.equal((await begin(h, nextBody(h, first, 'overlap'))).res.statusCode, 409);
  assert.equal((await begin(h, nextBody(h, first, 'foreign'), { owner: 'other-owner' })).res.statusCode, 404);
  const stream = await h.request('GET', STREAM, { query: { sessionId: first.res.body.sessionId } });
  assert.equal((await h.request('GET', STREAM, { query: { sessionId: first.res.body.sessionId } })).res.statusCode, 409);
  h.tick(3100); await settle(); assert.equal(stream.events().at(-1).eventType, 'turn.completed');
  const second = await begin(h, nextBody(h, first, 'second')); await complete(h, second);
  assert.equal((await begin(h, nextBody(h, first, 'stale'))).res.statusCode, 409);
  assert.equal(h.providerRequests.length, 2); assert.deepEqual(h.identityCalls(), []);
});

test('end is authenticated/CSRF protected, owner-scoped, idempotent, and clears before late response', async () => {
  const pending = deferred(); const h = await harness({ provider: () => pending.promise });
  const first = await begin(h, body());
  const endBody = { requestMode: MODE, requestId: first.req.body.requestId };
  for (const [options, code] of [[{ owner: null }, 401], [{ csrf: '' }, 403]]) {
    assert.equal((await h.request('POST', END, { input: endBody, ...options })).res.statusCode, code);
  }
  assert.equal((await h.request('POST', END, { input: endBody, owner: 'other-owner' })).res.statusCode, 200);
  assert.notEqual(h.sessions[0].userMessage, '', 'foreign owner cannot invalidate');
  assert.equal((await h.request('POST', END, { input: endBody })).res.statusCode, 200);
  assert.equal((await h.request('POST', END, { input: endBody })).res.statusCode, 200);
  assert.equal(h.sessions[0].userMessage, ''); assert.equal(h.sessions[0].devAbort.signal.aborted, true);
  pending.resolve(providerResponse()); await settle();
  assert.equal(h.sessions[0].deepDone, false);
  assert.deepEqual(plain(h.sessions[0].deepChunks), []);
  assert.equal((await begin(h, nextBody(h, first, 'late'))).res.statusCode, 404);
  assert.equal((await h.request('GET', STREAM, { query: { sessionId: first.res.body.sessionId } })).res.statusCode, 404);
  const fresh = await begin(h, body({ requestId: `${h.now()}_fresh` }));
  assert.equal(fresh.res.statusCode, 200);
  assert.equal(JSON.parse(h.providerRequests.at(-1).options.body).messages.length, 2);
});

test('end-before-start and end during authentication cannot revive a cancelled request', async () => {
  let authBlocked = false; const auth = deferred();
  const h = await harness({ authWait: req => req.body?.message && authBlocked ? auth.promise : undefined });
  const payload = body();
  await h.request('POST', END, { input: { requestMode: MODE, requestId: payload.requestId } });
  assert.equal((await begin(h, payload)).res.statusCode, 409);
  authBlocked = true;
  const second = body({ requestId: '100000_waiting' });
  const starting = h.request('POST', START, { input: second }); await settle();
  await h.request('POST', END, { input: { requestMode: MODE, requestId: second.requestId } });
  auth.resolve(); assert.equal((await starting).res.statusCode, 409);
  assert.equal(h.providerRequests.length, 0);
});

test('failure clears without any SSE attachment; a clean later start has no failed context', async () => {
  let failure = false;
  const h = await harness({ provider: async () => providerResponse(failure ? { status: 503 } : {}) });
  const first = await begin(h, body()); await complete(h, first);
  failure = true;
  const second = await begin(h, nextBody(h, first, 'failed'));
  assert.equal(h.sessions[1].userMessage, ''); assert.deepEqual(plain(h.sessions[1].devContext), []);
  assert.equal((await begin(h, nextBody(h, second, 'after-failure'))).res.statusCode, 404);
  failure = false;
  await begin(h, body({ requestId: `${h.now()}_new` }));
  assert.equal(JSON.parse(h.providerRequests.at(-1).options.body).messages.length, 2);
  assert.deepEqual(h.identityCalls(), []);
});

test('exact server expiry rejects continuation, stream and expired initial replay; no sliding', async () => {
  const h = await harness(); const first = await begin(h, body()); await complete(h, first);
  h.tick(600000 - 3100);
  assert.equal((await begin(h, nextBody(h, first, 'expired'))).res.statusCode, 404);
  assert.equal((await begin(h, body())).res.statusCode, 410, 'first-start replay stays stale after marker eviction');
  assert.equal((await h.request('GET', STREAM, { query: { sessionId: first.res.body.sessionId } })).res.statusCode, 404);
  assert.equal((await h.request('POST', END, { input: { requestMode: MODE, requestId: first.req.body.requestId } })).res.statusCode, 200);
  assert.equal(h.providerRequests.length, 1);
});

test('request age is checked before and after auth wait; future skew does not lengthen server conversation', async () => {
  const pending = deferred(); const h = await harness({ authWait: () => pending.promise });
  h.tick(600000);
  const old = await h.request('POST', START, { input: body() });
  assert.equal(old.res.statusCode, 410); assert.equal(h.calls.filter(x => x.name === 'auth').length, 0);
  const waiting = h.request('POST', START, { input: body({ requestId: `${h.now()}_waiting` }) });
  await settle(); h.tick(600000); pending.resolve();
  assert.equal((await waiting).res.statusCode, 410); assert.equal(h.providerRequests.length, 0);
  const future = await harness();
  const input = body({ requestId: '400000_future' });
  const first = await begin(future, input);
  assert.equal(first.res.statusCode, 200); assert.equal(first.res.body.expiresAt, 700000);
  assert.equal(first.res.body.remainingLifetimeMs, 600000);
  future.tick(600000);
  assert.equal((await begin(future, input)).res.statusCode, 409, 'live replay marker outlives conversation for future-skew ID');
  future.tick(300000);
  assert.equal((await begin(future, input)).res.statusCode, 410);
  assert.equal((await begin(future, body({ requestId: `${future.now() + 300001}_too-future` }))).res.statusCode, 410);
});

test('pure store enforces whole-pair count/size bounds and excludes oversized pair without losing prior pairs', async () => {
  const h = await harness(); let now = 100000, serial = 0;
  const store = h.mode.createDevConversationStore({ now: () => now, createId: () => `conv-${++serial}`, onInvalidate() {} });
  const first = store.begin('owner', '100000_r1', now); assert.equal(first.ok, true);
  const id = first.conversation.id;
  let previous = '100000_r1';
  store.complete(id, 'owner', previous, 'U'.repeat(1000), 'A'.repeat(1000));
  for (let i = 2; i <= 4; i++) {
    const request = `100000_r${i}`;
    assert.equal(store.begin('owner', request, now, id, previous).ok, true);
    store.complete(id, 'owner', request, String(i).repeat(1000), 'A'.repeat(1000)); previous = request;
  }
  assert.equal(store.find(id, 'owner').pairs.length, 3);
  assert.equal(store.find(id, 'owner').pairs[0].user[0], '2');
  assert.equal(store.find(id, 'owner').pairs.reduce((n, x) => n + x.user.length + x.assistant.length, 0), 6000);
  const before = plain(store.find(id, 'owner').pairs);
  store.begin('owner', '100000_huge', now, id, previous);
  store.complete(id, 'owner', '100000_huge', 'U', 'A'.repeat(6000));
  assert.deepEqual(plain(store.find(id, 'owner').pairs), before);
  store.begin('owner', '100000_large', now, id, '100000_huge');
  store.complete(id, 'owner', '100000_large', 'U'.repeat(1000), 'A'.repeat(4500));
  assert.equal(store.find(id, 'owner').pairs.length, 1);
  const held = store.find(id, 'owner'); now = 700000;
  assert.equal(store.find(id, 'owner'), undefined); assert.deepEqual(plain(held.pairs), []);
});

test('bounded no-text cancellation indexes reject overflow without evicting live owner markers', async () => {
  const h = await harness(); let now = 100000, seq = 0;
  const store = h.mode.createDevConversationStore({ now: () => now, createId: () => `c-${++seq}`, onInvalidate() {} });
  for (let i = 0; i < h.mode.DEV_REQUESTS_PER_OWNER; i++) assert.equal(store.end('a', `100000_cancel-${i}`), true);
  assert.equal(store.end('a', '100000_overflow'), false);
  assert.equal(store.begin('a', '100000_cancel-0', now).status, 409);
  assert.equal(store.begin('a', '100000_new', now).status, 429);
  assert.equal(store.begin('b', '100000_cancel-0', now).ok, true, 'unrelated owner is unaffected');
  now = 700000; store.sweep();
  assert.equal(store.begin('a', '700000_new', now).ok, true, 'expired indexes release capacity');
  const full = h.mode.createDevConversationStore({ now: () => now, createId: () => `x-${++seq}`, onInvalidate() {} });
  for (let i = 0; i < h.mode.DEV_REQUESTS_TOTAL; i++) assert.equal(full.end(`owner-${i}`, `700000_r-${i}`), true);
  assert.equal(full.begin('fresh-owner', '700000_new', now).status, 429);
  assert.equal(full.begin('owner-0', '700000_r-0', now).status, 409);
});

const reaction = await loadTsModule(new URL('../flows/firstTwoRoundsReaction.ts', import.meta.url), {});
const validator = await loadTsModule(new URL('../flows/ef41DeepCompositionValidator.ts', import.meta.url), { './firstTwoRoundsReaction': reaction });
test('actual validator accepts user-only bounded facts, rejects assistant assertion and unchanged history/persona violations', () => {
  const input = { text: '这份害怕是你此刻说出的感受。', roleId: 'clever-fox', userTurn: 1,
    userMessage: '虚构场景：这就是我想接着说的事。', source: 'cleaned', visiblePrefix: '' };
  assert.equal(validator.validateEf41DeepOutput(input), '我听到了。');
  assert.equal(validator.validateEf41DeepOutput({ ...input, sameSessionUserMessages: ['虚构场景：我有些害怕。'] }), input.text);
  // Assistant text is deliberately absent from this fact view, even when present in provider role history.
  assert.equal(validator.validateEf41DeepOutput({ ...input, sameSessionUserMessages: ['虚构场景：我在安排明天。'] }), '我听到了。');
  for (const text of ['你以前总是害怕这件事。', '我正在喝咖啡，看着窗边。']) {
    assert.equal(validator.validateEf41DeepOutput({ ...input, text, sameSessionUserMessages: ['我有些害怕。'] }), '我听到了。');
  }
});

for (const extra of [{ history: [] }, { summary: 'x' }, { userId: 'x' }, { afterRequestId: '100000_old' },
  { devConversationId: 'unknown' }, { devConversationId: null }, { devConversationId: {}, afterRequestId: 'r' }]) {
  test(`closed continuation schema rejects ${JSON.stringify(extra)}`, async () => {
    const h = await harness();
    assert.equal((await begin(h, body(extra))).res.statusCode, 400);
    assert.equal(h.providerRequests.length, 0); assert.deepEqual(h.identityCalls(), []);
  });
}
for (const extra of [{ history: [] }, { devConversationId: 'x' }, { userId: OWNER }, { requestId: {} }]) {
  test(`closed end schema rejects ${JSON.stringify(extra)}`, async () => {
    const h = await harness();
    const r = await h.request('POST', END, { input: { requestMode: MODE, requestId: '100000_r', ...extra } });
    assert.equal(r.res.statusCode, 400); assert.equal(h.providerRequests.length, 0);
  });
}

for (const ordinary of [false, true]) for (const text of ['', '我听到了。']) {
  test(`${ordinary ? 'ordinary' : 'DEV'} empty/short ${JSON.stringify(text)} preserves baseline terminals without absorbing PR167`, async () => {
    const h = await harness({ provider: async () => providerResponse({ text }) });
    const payload = body();
    const first = ordinary
      ? await h.request('POST', '/api/v1/chat/start', { input: { roleId: 'clever-fox', message: payload.message, requestId: payload.requestId } })
      : await begin(h, payload);
    await settle();
    assert.equal(h.calls.filter(x => x.name === 'validator').length, 0, 'short content admission is still unchanged');
    const stream = await h.request('GET', STREAM, { query: { sessionId: first.res.body.sessionId } });
    h.tick(3100); await settle();
    assert.deepEqual(stream.events().slice(-2).map(x => x.eventType), ['deep.completed', 'turn.completed']);
    assert.ok(!stream.events().some(x => x.eventType === 'deep.delta' || x.eventType === 'error'));
    if (!ordinary) {
      assert.equal((await begin(h, nextBody(h, first, 'no-continuation'))).res.statusCode, 404);
      assert.equal(h.providerRequests.length, 1);
    }
  });
}

test('scheduled absolute expiry clears idle and in-flight context without subsequent access; late provider cannot restore it', async () => {
  const pending = deferred(); let second = false;
  const h = await harness({ provider: () => second ? pending.promise : Promise.resolve(providerResponse()) });
  const first = await begin(h, body()); await complete(h, first);
  second = true; await begin(h, nextBody(h, first, 'pending'));
  const active = h.sessions.at(-1);
  assert.equal(active.devContext.length, 1);
  h.tick(600000 - 3100); await settle();
  assert.equal(h.now(), 700000);
  assert.equal(active.devAbort.signal.aborted, true);
  assert.equal(active.userMessage, ''); assert.deepEqual(plain(active.devContext), []);
  assert.deepEqual(plain(active.deepChunks), []);
  pending.resolve(providerResponse()); await settle();
  assert.equal(active.deepDone, false); assert.deepEqual(plain(active.deepChunks), []);
  assert.deepEqual(h.identityCalls(), []);
});

test('idle pair references are cleared by scheduled expiry alone; explicit end cancels the old timer', async () => {
  const h = await harness(); const invalidated = [];
  const store = h.mode.createDevConversationStore({ now: h.now, createId: () => 'same-id', onInvalidate: id => invalidated.push(id) });
  const first = store.begin('owner', '100000_first', h.now());
  store.complete(first.conversation.id, 'owner', '100000_first', 'user', 'assistant');
  h.tick(1000); store.end('owner', '100000_first');
  assert.deepEqual(plain(first.conversation.pairs), []);
  const second = store.begin('owner', '101000_second', h.now());
  store.complete(second.conversation.id, 'owner', '101000_second', 'new user', 'new assistant');
  h.tick(599000); // Old timer's deadline, without any store access.
  assert.equal(second.conversation.pairs.length, 1);
  h.tick(1000); // New timer's deadline, without any store access.
  assert.deepEqual(plain(second.conversation.pairs), []); assert.equal(invalidated.length, 2);
});
