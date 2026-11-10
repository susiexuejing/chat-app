import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';
import { body, deferred, harness, plain, providerResponse, settle, START, STREAM } from './devEphemeralHarness.mjs';

const contract = await loadTsModule(new URL('../contracts/devPracticeCandidate.ts', import.meta.url), {});
const version = 'dev-reply-practice-v1';
const accept = `application/json; dev-reply-contract=${version}`;
const message = '今天开会时我低头看稿。已经说清楚了，请给我一个很小的下一步建议。';
const reply = '你说的是今天开会时低头看稿。';
const evidence = () => ({ permissionQuote: '请给我一个很小的下一步建议', anchorQuote: '今天开会时我低头看稿',
  naturalClosing: true, smallChoiceFits: true, currentUserRequest: true,
  continuingExpression: false, correctionOrRefusalOrExit: false, topicChanged: false });
const output = () => ({ contract: version, reply, practiceCandidate: {
  ifCue: '下次开会低头看稿时', thenAction: '可以选一句熟悉的话，抬头说完再看稿', evidence: evidence(),
} });
const source = { sessionId: 's', devConversationId: 'c', requestId: 'r' };
const parse = (value = output(), overrides = {}) => contract.parseDevPracticeReply(JSON.stringify(value), {
  latestUserMessage: message, providerCompleted: true, source, replyMaxChars: 120, validateReply: x => x, ...overrides,
});

test('complete contract accepts AI-new action without turning it into a user fact', () => {
  const result = parse();
  assert.equal(result.practiceCandidate.thenAction, output().practiceCandidate.thenAction);
  assert.deepEqual(plain(result.source), source);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.source) && Object.isFrozen(result.practiceCandidate));
  assert.deepEqual(Object.keys(result.practiceCandidate), ['ifCue', 'thenAction']);
});
test('nullable candidate is a complete ordinary reply, not a missing field', () => {
  assert.equal(parse({ ...output(), practiceCandidate: null }).practiceCandidate, null);
  const absent = output(); delete absent.practiceCandidate; assert.equal(parse(absent), null);
});
for (const field of ['naturalClosing', 'smallChoiceFits', 'currentUserRequest', 'continuingExpression', 'correctionOrRefusalOrExit', 'topicChanged']) {
  test(`negative semantic evidence ${field} removes candidate, leaves reply`, () => {
    const value = output(); value.practiceCandidate.evidence[field] = !value.practiceCandidate.evidence[field];
    assert.equal(parse(value).practiceCandidate, null);
  });
}
for (const field of ['permissionQuote', 'anchorQuote']) test(`${field} cannot come from previous turns or assistant`, () => {
  const value = output(); value.practiceCandidate.evidence[field] = 'not in current input';
  assert.equal(parse(value).practiceCandidate, null);
});
for (const mutation of [v => { v.extra = true; }, v => { v.contract = 'unknown'; }, v => { v.reply = ''; },
  v => { v.practiceCandidate.extra = 'x'; }, v => { v.practiceCandidate.ifCue = ''; },
  v => { v.practiceCandidate.thenAction = 'x'.repeat(201); }, v => { v.practiceCandidate.evidence = {}; },
  v => { v.practiceCandidate.evidence.naturalClosing = 'true'; }]) {
  test('malformed structure fails whole contract without repair', () => { const value = output(); mutation(value); assert.equal(parse(value), null); });
}
test('no provider terminal, wrong source and invalid reply cannot produce success', () => {
  assert.equal(parse(output(), { providerCompleted: false }), null);
  assert.equal(parse(output(), { source: { ...source, requestId: '' } }), null);
  assert.equal(parse(output(), { validateReply: () => { throw new Error('unsafe'); } }), null);
  assert.equal(parse(output(), { validateReply: () => '' }), null);
  assert.equal(parse(output(), { validateReply: () => '我听到了。' }).practiceCandidate, null);
});
test('no free text / Markdown extraction or raw tail fallback', () => {
  for (const raw of ['```json\n' + JSON.stringify(output()) + '\n```', 'prefix ' + JSON.stringify(output()), JSON.stringify(output()).slice(0, -1)]) {
    assert.equal(contract.parseDevPracticeReply(raw, { latestUserMessage: message, providerCompleted: true, source, replyMaxChars: 120, validateReply: x => x }), null);
  }
});
test('prompt preserves original reply contract and names all semantic exclusions, not an implemented keyword detector', () => {
  const prompt = contract.buildDevPracticeReplyContract('UNCHANGED_REPLY_FACT_CONTRACT');
  for (const text of ['UNCHANGED_REPLY_FACT_CONTRACT', '自然接近结束', '最新这条用户消息', '模糊', '转述别人', '纠正', '不保证效果', '轮数', '评分', '不要声称保存/激活']) assert.ok(prompt.includes(text));
});

async function start(h, header = accept) {
  const r = await h.request('POST', START, { input: body({ message }), accept: header });
  await settle(); return r;
}
async function finish(h, r) {
  const stream = await h.request('GET', STREAM, { query: { sessionId: r.res.body.sessionId } });
  h.tick(100); await settle(); return stream;
}
test('actual route negotiates one same-request model call and publishes candidate only in successful terminal', async () => {
  const h = await harness({ provider: async () => providerResponse({ text: JSON.stringify(output()) }), realValidator: true });
  const r = await start(h); assert.equal(r.res.body.devReplyContract, version);
  const stream = await finish(h, r); const events = stream.events();
  const final = events.find(e => e.eventType === 'turn.completed');
  assert.ok(final); assert.equal(final.practiceReply.practiceCandidate.thenAction, output().practiceCandidate.thenAction);
  assert.equal(final.practiceReply.source.requestId, body().requestId);
  assert.equal(final.practiceReply.source.sessionId, r.res.body.sessionId);
  assert.equal(events.filter(e => e.eventType === 'deep.delta').map(e => e.content).join(''), reply);
  assert.equal(h.providerRequests.length, 1);
  assert.equal(JSON.parse(h.providerRequests[0].options.body).max_tokens, 1200);
  const c = h.mode; assert.ok(c);
  assert.ok(!h.identityCalls().some(x => x.name.startsWith('conversation.')));
});
for (const header of [undefined, 'application/json', `application/json; dev-reply-contract=${version}-other`, `application/json; not-dev-reply-contract=${version}`]) {
  test(`old/unnegotiated client retains free-text path: ${header}`, async () => {
    const h = await harness({ provider: async () => providerResponse({ text: reply }), realValidator: true });
    const r = await start(h, header === undefined ? '' : header);
    assert.equal(r.res.body.devReplyContract, undefined);
    const stream = await finish(h, r); assert.ok(stream.events().some(e => e.eventType === 'turn.completed'));
    assert.ok(stream.events().every(e => !e.practiceReply));
  });
}
for (const raw of ['not JSON', JSON.stringify(output()).slice(0, -1), JSON.stringify({ ...output(), practiceCandidate: {} })]) {
  test('actual route rejects malformed negotiated output instead of publishing clean fallback', async () => {
    const h = await harness({ provider: async () => providerResponse({ text: raw }) }); const r = await start(h);
    const stream = await finish(h, r); assert.ok(!stream.events().some(e => e.eventType === 'turn.completed' || e.eventType === 'deep.delta'));
    assert.equal(h.providerRequests.length, 1);
  });
}
for (const finishReason of [null, 'length']) test(`EOF/truncation cannot masquerade as structured completion: ${finishReason}`, async () => {
  let read = false;
  const h = await harness({ provider: async () => ({ ...providerResponse(), body: { getReader: () => ({ read: async () => {
    if (read) return { done: true }; read = true;
    return { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(output()) }, finish_reason: finishReason }] })}\n\n${finishReason ? 'data: [DONE]\n\n' : ''}`) };
  } }) } }) });
  const r = await start(h); const stream = await finish(h, r);
  assert.ok(!stream.events().some(e => e.eventType === 'turn.completed'));
});
test('cancel before provider settles revokes late structured reply', async () => {
  const d = deferred(); const h = await harness({ provider: () => d.promise }); const r = await start(h);
  await h.request('POST', '/api/v1/chat/dev-journey/end', { input: { requestMode: 'dev-ephemeral-v1', requestId: body().requestId } });
  d.resolve(providerResponse({ text: JSON.stringify(output()) })); await settle();
  const stream = await finish(h, r); assert.equal(stream.res.statusCode, 404);
  assert.ok(h.sessions.every(s => !s.devPracticeReply));
});

const dataFrame = content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
for (const [name, wire] of [
  ['provider error after valid content', dataFrame(JSON.stringify(output())) + 'data: {"error":{"code":"failed"}}\n\ndata: [DONE]\n\n'],
  ['content after terminal', 'data: [DONE]\n\n' + dataFrame(JSON.stringify(output()))],
  ['malformed frame before valid content', 'data: {invalid}\n\n' + dataFrame(JSON.stringify(output())) + 'data: [DONE]\n\n'],
  ['unterminated trailing data', dataFrame(JSON.stringify(output())) + 'data: [DONE]\n\ndata: {'],
  ['duplicate terminal', dataFrame(JSON.stringify(output())) + 'data: [DONE]\n\ndata: [DONE]\n\n'],
]) test(`strict negotiated provider lifecycle rejects ${name}`, async () => {
  let read = false;
  const h = await harness({ provider: async () => ({ ...providerResponse(), body: { getReader: () => ({ read: async () => {
    if (read) return { done: true }; read = true;
    return { done: false, value: new TextEncoder().encode(wire) };
  } }) } }) });
  const r = await start(h); const stream = await finish(h, r);
  assert.ok(!stream.events().some(e => e.eventType === 'turn.completed' || e.eventType === 'deep.delta'));
});
test('UTF16 suggestion limit matches storage, SSE and client boundary', () => {
  const v = output(); v.practiceCandidate.thenAction = '😀'.repeat(101); assert.equal(parse(v), null);
  v.practiceCandidate.thenAction = '😀'.repeat(100); assert.ok(parse(v).practiceCandidate);
});
for (const header of [`text/plain; dev-reply-contract=${version}`, `${accept}; dev-reply-contract=unknown`, `${accept}, application/json`]) {
  test(`ambiguous/wrong-media negotiation stays on legacy: ${header}`, async () => {
    const h = await harness({ provider: async () => providerResponse({ text: reply }) });
    const r = await start(h, header); assert.equal(r.res.body.devReplyContract, undefined);
    assert.ok((await finish(h, r)).events().some(e => e.eventType === 'turn.completed'));
  });
}
