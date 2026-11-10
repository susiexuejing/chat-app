// Fresh synthetic inputs only. Actual handler, parser, validator and Zod wire schema.
import assert from 'node:assert/strict';
import test from 'node:test';
import { body, deferred, harness, MODE, OWNER, plain, providerResponse, settle, START, STREAM } from './devEphemeralHarness.mjs';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';
const CONTRACT = 'dev-reply-practice-v1';
const RETRY = 'dev-manual-retry-v1';
const accept = `application/json; dev-reply-contract=${CONTRACT}`;
const input = '虚构测试：我还没有决定周末要不要去公园。';
const answer = '你还没有决定周末是否去公园。';
const output = (reply = answer) => JSON.stringify({ contract: CONTRACT, reply, practiceCandidate: null });
const setup = options => harness({ realValidator: true, realStreamContract: true,
  provider: async () => providerResponse({ text: output() }), ...options });
const start = async (h, payload = body({ message: input }), options = {}) => {
  const r = await h.request('POST', START, { input: payload, accept, retryContract: RETRY, ...options }); await settle(); return r;
};
const retry = (h, prior, name = 'retry', options = {}) => start(h, body({ message: prior.req.body.message,
  requestId: `${h.now()}_${name}`, retryOfRequestId: prior.req.body.requestId }), options);
const stream = async (h, begun) => {
  const r = await h.request('GET', STREAM, { query: { sessionId: begun.res.body.sessionId } });
  h.tick(100); await settle(); return r;
};
const next = (h, prior, name = 'next') => start(h, body({ message: '虚构测试：现在我决定先在家整理书架。',
  requestId: `${h.now()}_${name}`, devConversationId: prior.res.body.devConversationId, afterRequestId: prior.req.body.requestId }));
const end = (h, prior) => h.request('POST', '/api/v1/chat/dev-journey/end', {
  input: { requestMode: MODE, requestId: prior.req.body.requestId },
});

test('validator fallback is recoverable before SSE, never reply or accepted context; retry preserves prior pairs exactly', async () => {
  let attempt = 0;
  const h = await setup({ provider: async () => providerResponse({ text: output(++attempt === 2 ? '你现在很焦虑。' : answer) }) });
  const first = await start(h); await stream(h, first);
  const failed = await next(h, first);
  assert.equal(failed.res.body.devRetryContract, RETRY);
  const failStream = await stream(h, failed);
  assert.deepEqual(failStream.events().map(x => x.eventType), ['turn.started', 'error']);
  assert.equal(failStream.events().at(-1).payload.recoverable, true);
  assert.equal(h.sessions[1].userMessage, ''); assert.equal(h.sessions[1].deepChunks.length, 0);
  assert.equal(h.sessions[1].devPracticeReply, undefined);
  const repaired = await retry(h, failed); const repairedStream = await stream(h, repaired);
  assert.equal(repaired.res.body.userTurn, 2);
  assert.equal(repaired.res.body.devConversationId, first.res.body.devConversationId);
  assert.equal(repaired.res.body.expiresAt, first.res.body.expiresAt);
  assert.equal(repairedStream.events().at(-1).payload.practiceReply.source.requestId, repaired.req.body.requestId);
  const context = JSON.parse(h.providerRequests[2].options.body).messages.slice(1);
  assert.deepEqual(context, [{ role: 'user', content: input }, { role: 'assistant', content: answer },
    { role: 'user', content: failed.req.body.message }]);
  assert.equal(h.providerRequests.length, 3); assert.deepEqual(h.identityCalls(), []);
});

test('repeated invalid output retains first input, does not append rejected pairs and performs no automatic provider retry', async () => {
  const h = await setup({ provider: async () => providerResponse({ text: 'invalid JSON' }) });
  let failed = await start(h);
  for (let i = 0; i < 3; i++) {
    const response = await stream(h, failed); assert.equal(response.events().at(-1).payload.recoverable, true);
    assert.equal(h.providerRequests.length, i + 1);
    if (i < 2) failed = await retry(h, failed, `attempt-${i}`);
  }
  for (const r of h.providerRequests) assert.equal(JSON.parse(r.options.body).messages.length, 2);
  assert.equal(h.sessions.every(s => s.userMessage === '' && s.deepChunks.length === 0), true);
});

test('stream loss after completed acceptance replays new identity with zero additional calls and exactly one pair', async () => {
  const h = await setup(); const first = await start(h);
  // Provider completed but no SSE terminal was observed by the client.
  assert.equal(h.sessions[0].deepDone, true);
  const recovered = await retry(h, first);
  assert.equal(h.providerRequests.length, 1);
  assert.equal(recovered.res.body.userTurn, 1);
  const completed = await stream(h, recovered);
  assert.equal(completed.events().at(-1).payload.practiceReply.source.requestId, recovered.req.body.requestId);
  assert.equal((await retry(h, first, 'stale')).res.statusCode, 409);
  await next(h, recovered);
  assert.deepEqual(JSON.parse(h.providerRequests[1].options.body).messages.slice(1, -1), [
    { role: 'user', content: input }, { role: 'assistant', content: answer },
  ]);
});

test('completed replay survives lost success terminal and repeated replay without duplicate provider or pair', async () => {
  const h = await setup(); const first = await start(h); await stream(h, first);
  const one = await retry(h, first, 'replay-1'); await stream(h, one);
  const two = await retry(h, one, 'replay-2'); await stream(h, two);
  assert.equal(h.providerRequests.length, 1); assert.equal(two.res.body.expiresAt, first.res.body.expiresAt);
  await next(h, two); assert.equal(JSON.parse(h.providerRequests[1].options.body).messages.length, 4);
});

test('pending Retry is only a state probe; pending ID is not consumed and original work finishes once', async () => {
  const pending = deferred(); const h = await setup({ provider: () => pending.promise });
  const first = await start(h);
  const open = await h.request('GET', STREAM, { query: { sessionId: first.res.body.sessionId } }); open.close();
  const probe = await retry(h, first, 'pending-id');
  assert.equal(probe.res.statusCode, 409); assert.equal(probe.res.headers['X-Dev-Retry-State'], 'pending');
  assert.equal(h.providerRequests.length, 1); assert.equal(h.sessions[0].devAbort.signal.aborted, false);
  pending.resolve(providerResponse({ text: output() })); await settle();
  const recovered = await retry(h, first, 'pending-id');
  assert.equal(recovered.res.statusCode, 200); assert.equal(h.providerRequests.length, 1);
  assert.equal((await stream(h, recovered)).events().at(-1).eventType, 'turn.completed');
});

test('provider deadline confirms failure; late completed old output cannot appear after explicit new attempt', async () => {
  const late = deferred(); let n = 0;
  const h = await setup({ provider: () => ++n === 1 ? late.promise : Promise.resolve(providerResponse({ text: output() })) });
  const first = await start(h); h.tick(135000); await settle();
  assert.equal(h.sessions[0].devRetryableFailure, true);
  const recovered = await retry(h, first); await stream(h, recovered);
  late.resolve(providerResponse({ text: output('未被接受的旧回复。') })); await settle();
  assert.equal(h.sessions[0].deepChunks.length, 0);
  await next(h, recovered);
  assert.deepEqual(JSON.parse(h.providerRequests[2].options.body).messages.slice(1, -1), [
    { role: 'user', content: input }, { role: 'assistant', content: answer },
  ]);
});

for (const status of [401, 403, 400, 402]) test(`provider HTTP ${status} is terminal, cannot retry safety/auth/config rejection`, async () => {
  const h = await setup({ provider: async () => providerResponse({ status }) }); const first = await start(h);
  assert.equal((await stream(h, first)).res.statusCode, 404);
  assert.equal((await retry(h, first)).res.statusCode, 404); assert.equal(h.providerRequests.length, 1);
});
for (const status of [429, 500, 503]) test(`provider HTTP ${status} stays recoverable without automatic retry`, async () => {
  const h = await setup({ provider: async () => providerResponse({ status }) }); const first = await start(h);
  assert.equal((await stream(h, first)).events().at(-1).payload.recoverable, true);
  assert.equal(h.providerRequests.length, 1);
});

function metadataResponse(metadata, after = '') {
  const chunks = [`data: ${JSON.stringify(metadata)}\n\n`, after]; let i = 0;
  return { ok: true, status: 200, body: { getReader: () => ({ read: async () => i < chunks.length
    ? { done: false, value: new TextEncoder().encode(chunks[i++]) } : { done: true } }) } };
}
for (const metadata of [{ choices: [{ delta: {}, finish_reason: 'content_filter' }] },
  { choices: [{ delta: { refusal: 'synthetic policy refusal' } }] },
  { choices: [{ message: { refusal: 'synthetic policy refusal' } }] },
  { refusal: 'synthetic policy refusal', choices: [] }, { error: { code: 'synthetic_policy_error' } },
  { output: { error: { code: 'synthetic_error' }, choices: [] } },
  { request_id: 'synthetic', code: 'DataInspectionFailed', message: 'synthetic error' },
  { output: { code: 'UnexpectedNativeFailure', message: 'synthetic error' } }]) {
  test('structured safety/refusal/provider error metadata is terminal with attached SSE and no bypass Retry', async () => {
    const pending = deferred(); const h = await setup({ provider: () => pending.promise });
    const first = await start(h);
    const open = await h.request('GET', STREAM, { query: { sessionId: first.res.body.sessionId } });
    pending.resolve(metadataResponse(metadata, 'data: [DONE]\n\n')); await settle(); h.tick(100); await settle();
    assert.equal(open.events().at(-1).eventType, 'error');
    assert.equal(open.events().at(-1).payload.recoverable, false);
    assert.equal(open.events().some(e => e.eventType === 'deep.delta'), false);
    assert.equal((await retry(h, first)).res.statusCode, 404);
  });
}

test('unchanged valid refusal is a normal validated reply; no prose keyword refusal classifier', async () => {
  const refusal = '这个请求我无法帮助。'; const h = await setup({ provider: async () => providerResponse({ text: output(refusal) }) });
  const first = await start(h); const done = await stream(h, first);
  assert.equal(done.events().at(-1).payload.practiceReply.reply, refusal);
});

test('exact unchanged acknowledgment and harmless trim accepted; identical fallback from rejected gate fails', async () => {
  const reaction = await loadTsModule(new URL('../flows/firstTwoRoundsReaction.ts', import.meta.url), {});
  const validator = await loadTsModule(new URL('../flows/ef41DeepCompositionValidator.ts', import.meta.url), { './firstTwoRoundsReaction': reaction });
  const base = { text: '我听到了。', roleId: 'clever-fox', userTurn: 1, userMessage: '我想说一句话。', source: 'cleaned', devPrimaryResponse: true };
  assert.deepEqual(plain(validator.validateEf41DeepOutputOutcome(base)), { text: '我听到了。', rejected: false });
  assert.deepEqual(plain(validator.validateEf41DeepOutputOutcome({ ...base, userMessage: '事情太多，脑子很乱，不知道从哪开始说。' })), { text: '我听到了。', rejected: true });
  for (const [text, user, expected] of [['我听到了。', '我想说一句话。', true], ['  我听到了。  ', '我想说一句话。', true], ['我听到了。', '事情太多，脑子很乱，不知道从哪开始说。', false]]) {
    const h = await setup({ provider: async () => providerResponse({ text: output(text) }) }); const first = await start(h, body({ message: user }));
    const done = await stream(h, first); assert.equal(done.events().at(-1).eventType, expected ? 'turn.completed' : 'error');
  }
});

test('retry is bound to owner and exact input, closed to history/settings injection and stale logical turn', async () => {
  const h = await setup(); const first = await start(h);
  assert.equal((await retry(h, first, 'foreign', { owner: 'another-owner' })).res.statusCode, 404);
  assert.equal((await start(h, body({ requestId: '100000_changed', message: input + 'x', retryOfRequestId: first.req.body.requestId }))).res.statusCode, 409);
  for (const extra of [{ history: [] }, { afterRequestId: 'x' }, { devConversationId: first.res.body.devConversationId }, { userId: OWNER }]) {
    assert.equal((await start(h, body({ requestId: '100000_extra', message: input, retryOfRequestId: first.req.body.requestId, ...extra }))).res.statusCode, 400);
  }
  const fresh = await next(h, first); await stream(h, fresh);
  assert.equal((await retry(h, first, 'stale-turn')).res.statusCode, 409);
  assert.equal(h.providerRequests.length, 2);
});

test('explicit end cancels current acceptance and all aliases; late work and retries cannot revive', async () => {
  const pending = deferred(); const h = await setup({ provider: () => pending.promise }); const first = await start(h);
  await end(h, first); pending.resolve(providerResponse({ text: output() })); await settle();
  assert.equal(h.sessions[0].userMessage, ''); assert.equal(h.sessions[0].devAbort.signal.aborted, true);
  assert.equal((await retry(h, first)).res.statusCode, 404); assert.equal(h.sessions[0].deepChunks.length, 0);
});

test('fixed original TTL erases completed replay and failed envelope; fresh attempt cannot extend lifetime', async () => {
  for (const malformed of [false, true]) {
    const h = await setup({ provider: async () => providerResponse({ text: malformed ? 'bad' : output() }) }); const first = await start(h);
    h.tick(590000); const recovered = await retry(h, first);
    assert.equal(recovered.res.body.expiresAt, first.res.body.expiresAt);
    h.tick(10000); await settle();
    assert.equal((await retry(h, recovered, 'expired')).res.statusCode, 404);
    assert.equal(h.sessions.every(s => s.userMessage === '' && s.deepChunks.length === 0 && !s.devPracticeReply), true);
  }
});

test('unnegotiated structured fallback and terminal cleanup remain legacy compatible; retry field requires new contract', async () => {
  const h = await setup({ provider: async () => providerResponse({ text: output('你很焦虑。') }) });
  const first = await start(h, body({ message: input }), { accept: `application/json; dev-reply-contract=${CONTRACT}`, retryContract: undefined });
  assert.equal(first.res.body.devRetryContract, undefined);
  assert.equal((await stream(h, first)).events().at(-1).payload.practiceReply.reply, '我听到了。');
  const invalid = await start(h, body({ requestId: '100100_legacy-retry', message: input, retryOfRequestId: first.req.body.requestId }), { accept: `application/json; dev-reply-contract=${CONTRACT}`, retryContract: undefined });
  assert.equal(invalid.res.statusCode, 400);
});


test('refusal metadata followed by a hanging body stays terminal at the bounded read deadline', async () => {
  let read = false;
  const h = await setup({ provider: async () => ({ status: 200, ok: true, body: { getReader: () => ({
    read: async () => {
      if (read) return new Promise(() => {});
      read = true;
      return { done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"refusal":"synthetic refusal"}}]}\n\n') };
    }, cancel: async () => {},
  }) } }) });
  const first = await start(h);
  const open = await h.request('GET', STREAM, { query: { sessionId: first.res.body.sessionId } });
  h.tick(120000); await settle(); h.tick(100); await settle();
  assert.equal(open.events().at(-1).payload.recoverable, false);
  assert.equal((await retry(h, first)).res.statusCode, 404);
  assert.equal(h.providerRequests.length, 1);
});

test('partial body read failure is recoverable but never exposes rejected chunks or duplicates context', async () => {
  let read = false;
  const h = await setup({ provider: async () => ({ status: 200, ok: true, body: { getReader: () => ({
    read: async () => {
      if (read) throw new Error('synthetic read failure');
      read = true;
      return { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'PRIVATE_PARTIAL_REPLY' } }] })}\n\n`) };
    }, cancel: async () => {},
  }) } }) });
  const first = await start(h); const failed = await stream(h, first);
  assert.equal(failed.events().at(-1).payload.recoverable, true);
  assert.equal(JSON.stringify(failed.events()).includes('PRIVATE_PARTIAL_REPLY'), false);
  assert.equal(JSON.stringify(h.logs).includes('PRIVATE_PARTIAL_REPLY'), false);
  assert.equal(h.sessions[0].deepChunks.length, 0);
  assert.equal(h.providerRequests.length, 1);
});


for (const retryContract of [undefined, 'unknown', 'dev-manual-retry-v1, unknown']) {
  test(`retry negotiation requires one supported version; original structured reply stays compatible (${retryContract})`, async () => {
    const h = await setup(); const first = await start(h, body({ message: input }), { retryContract });
    assert.equal(first.res.body.devReplyContract, CONTRACT);
    assert.equal(first.res.body.devRetryContract, undefined);
    assert.equal((await stream(h, first)).events().at(-1).payload.practiceReply.reply, answer);
  });
}

test('retry header without the supported structured contract does not grant recovery', async () => {
  const h = await setup(); const first = await start(h, body({ message: input }), { accept: 'application/json' });
  assert.equal(first.res.body.devReplyContract, undefined);
  assert.equal(first.res.body.devRetryContract, undefined);
});
