import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';
import { body, harness, providerResponse, settle, START, STREAM } from './devEphemeralHarness.mjs';
const old = await loadTsModule(new URL('../contracts/devPracticeCandidate.ts', import.meta.url), {});
const v2 = await loadTsModule(new URL('../contracts/devPracticeV2.ts', import.meta.url), { './devPracticeCandidate': old });
const reaction = await loadTsModule(new URL('../flows/firstTwoRoundsReaction.ts', import.meta.url), {});
const validator = await loadTsModule(new URL('../flows/ef41DeepCompositionValidator.ts', import.meta.url), { './firstTwoRoundsReaction': reaction });
const version = 'dev-reply-practice-v2', accept = `application/json; dev-reply-contract=${version}`;
const message = '我不接受刚才的建议。我在歌单里切换了十分钟，请给我一个可随时停止的小练习。';
const output = () => ({ contract: version, narrative: '你想给切换歌曲留一点选择空间。', practiceCandidate: {
  ifCue: '手指准备点击下一首时', thenAction: '暂停动作，然后自行决定继续或换歌。', evidence: {
    permissionQuote: '请给我一个可随时停止的小练习', anchorQuote: '我在歌单里切换了十分钟', naturalClosing: false,
    smallChoiceFits: true, currentUserRequest: true, continuingExpression: true, correction: true, refusalOrExit: false, topicChanged: false,
  },
} });
const realValidator = text => validator.validateEf41DeepOutputOutcome({ text, roleId: 'clever-fox', userTurn: 1,
  userMessage: message, source: 'cleaned', visiblePrefix: '', devPrimaryResponse: true });
const parse = (value = output(), overrides = {}) => v2.parseDevPracticeV2(JSON.stringify(value), { latestUserMessage: message,
  providerCompleted: true, source: { sessionId: 's', devConversationId: 'c', requestId: 'r' },
  replyMaxChars: 120, validateReply: realValidator, ...overrides });

test('one action projection and separate validated discovery; explicit correction does not alone veto', () => {
  const value = output(), result = parse(value); assert.ok(result);
  assert.equal(result.reply, `${value.narrative}\n如果：${value.practiceCandidate.ifCue}\n那么：${value.practiceCandidate.thenAction}`);
  assert.equal(result.discoveryText, value.narrative);
  assert.ok(!result.discoveryText.includes(value.practiceCandidate.thenAction));
  assert.equal(result.practiceCandidate.thenAction, value.practiceCandidate.thenAction);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.practiceCandidate));
});
test('no duplicate reply/action field, invalid evidence, explicit refusal, or topic switch is accepted', () => {
  for (const mutate of [v => { v.reply = '另外做一个不同的动作'; }, v => { v.practiceCandidate.evidence.refusalOrExit = true; },
    v => { v.practiceCandidate.evidence.topicChanged = true; }, v => { v.practiceCandidate.evidence.currentUserRequest = false; },
    v => { v.practiceCandidate.evidence.anchorQuote = 'from a prior turn'; }, v => { delete v.practiceCandidate.evidence.correction; }]) {
    const value = output(); mutate(value); assert.equal(parse(value), null);
  }
});
test('null candidate is valid ordinary understanding, not a forced practice failure', () => {
  const value = { ...output(), practiceCandidate: null }, result = parse(value);
  assert.equal(result.reply, value.narrative); assert.equal(result.discoveryText, value.narrative); assert.equal(result.practiceCandidate, null);
});
test('both narrative and full visible text are checked; reject/rewrite cannot leave a candidate behind', () => {
  const seen = []; assert.ok(parse(output(), { validateReply: text => { seen.push(text); return text; } }));
  assert.equal(seen.length, 2); assert.ok(seen[1].includes(output().practiceCandidate.thenAction));
  assert.equal(parse(output(), { validateReply: text => text.includes('那么：') ? { text, rejected: true } : text }), null);
  assert.equal(parse(output(), { validateReply: text => text.includes('那么：') ? '我听到了。' : text }), null);
  const value = output(); value.practiceCandidate.thenAction = '我正在窗边喝咖啡。'; assert.equal(parse(value), null);
  value.practiceCandidate.thenAction = '字'.repeat(120); assert.equal(parse(value), null);
});
test('observed unsafe direct-send form is NOT claimed semantically blocked by this contract', () => {
  const value = output(); value.narrative = '你想减少反复检查。';
  value.practiceCandidate.thenAction = '意思清楚就直接发送，不再修改。';
  // This known limitation is explicit: the inherited fact validator is not a semantic safety evaluator.
  assert.ok(parse(value));
});
test('version negotiation is explicit/default-off; v1 parser cannot consume v2', () => {
  assert.equal(v2.negotiatePracticeContract(accept, undefined), old.DEV_PRACTICE_CONTRACT);
  assert.equal(v2.negotiatePracticeContract(accept, 'true'), old.DEV_PRACTICE_CONTRACT);
  assert.equal(v2.negotiatePracticeContract(accept, '1'), version);
  assert.equal(v2.negotiatePracticeContract('application/json', '1'), undefined);
  assert.equal(old.parseDevPracticeReply(JSON.stringify(output()), {}), null);
});

test('actual v2 route validates complete text, emits exact source/discovery, and replays without another model call', async () => {
  const h = await harness({ practiceV2Enabled: '1', realValidator: true, realStreamContract: true,
    provider: async () => providerResponse({ text: JSON.stringify(output()) }) });
  const r = await h.request('POST', START, { input: body({ message }), accept, retryContract: 'dev-manual-retry-v1' }); await settle();
  assert.equal(r.res.body.devReplyContract, version);
  const stream = await h.request('GET', STREAM, { query: { sessionId: r.res.body.sessionId } }); h.tick(100); await settle();
  const final = stream.events().find(e => e.eventType === 'turn.completed'); assert.ok(final);
  assert.equal(final.payload.practiceReply.reply, parse().reply);
  assert.equal(final.payload.practiceReply.discoveryText, output().narrative);
  assert.equal(h.providerRequests.length, 1);
  const replay = await h.request('POST', START, { input: body({ message, requestId: '100100_retry_2', retryOfRequestId: body().requestId }), accept, retryContract: 'dev-manual-retry-v1' }); await settle();
  assert.equal(replay.res.body.devReplyContract, version);
  const again = await h.request('GET', STREAM, { query: { sessionId: replay.res.body.sessionId } }); h.tick(100); await settle();
  assert.equal(again.events().find(e => e.eventType === 'turn.completed').payload.practiceReply.discoveryText, output().narrative);
  assert.equal(h.providerRequests.length, 1);
});
test('default-off route declares v1 fallback and does not send a v2 model prompt', async () => {
  const h = await harness({ provider: async () => providerResponse({ text: JSON.stringify({ contract: old.DEV_PRACTICE_CONTRACT,
    reply: output().narrative, practiceCandidate: null }) }) });
  const r = await h.request('POST', START, { input: body({ message }), accept, retryContract: 'dev-manual-retry-v1' }); await settle();
  assert.equal(r.res.body.devReplyContract, old.DEV_PRACTICE_CONTRACT);
  assert.ok(!JSON.parse(h.providerRequests[0].options.body).messages[0].content.includes(version));
});

test('actual v2 route preserves negotiated candidate_filtered instead of overwriting it as reply_rejected', async () => {
  const value = output(); value.practiceCandidate.evidence.refusalOrExit = true;
  const h = await harness({ practiceV2Enabled: '1', candidateDiagnosticEnabled: '1', realValidator: true, realStreamContract: true,
    provider: async () => providerResponse({ text: JSON.stringify(value) }) });
  const r = await h.request('POST', START, { input: body({ message }), accept,
    retryContract: 'dev-manual-retry-v1', candidateDiagnostic: 'dev-candidate-diagnostic-v1' }); await settle();
  assert.equal(r.res.body.devCandidateDiagnostic, 'dev-candidate-diagnostic-v1');
  const stream = await h.request('GET', STREAM, { query: { sessionId: r.res.body.sessionId } }); h.tick(100); await settle();
  const events = stream.events();
  assert.equal(events.find(e => e.eventType === 'error').payload.candidateDiagnostic, 'candidate_filtered');
  assert.ok(!events.some(e => e.eventType === 'turn.completed' || e.eventType === 'deep.delta'));
  assert.equal(h.providerRequests.length, 1);
});

test('version-bound retry digest cannot collide with a v1 message containing the old separator suffix', async () => {
  const h = await harness({ practiceV2Enabled: '1', realValidator: true, realStreamContract: true,
    provider: async () => providerResponse({ text: JSON.stringify(output()) }) });
  const r = await h.request('POST', START, { input: body({ message }), accept, retryContract: 'dev-manual-retry-v1' }); await settle();
  const stream = await h.request('GET', STREAM, { query: { sessionId: r.res.body.sessionId } }); h.tick(100); await settle();
  assert.ok(stream.events().some(e => e.eventType === 'turn.completed'));
  const collision = await h.request('POST', START, { input: body({ message: `${message}\0dev-reply-practice-v2`,
    requestId: '100100_collision_2', retryOfRequestId: body().requestId }),
    accept: 'application/json; dev-reply-contract=dev-reply-practice-v1', retryContract: 'dev-manual-retry-v1' }); await settle();
  assert.equal(collision.res.statusCode, 409);
  assert.equal(collision.res.body.sessionId, undefined);
  assert.equal(h.providerRequests.length, 1);
});
