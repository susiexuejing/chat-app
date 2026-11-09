// Actual handler/prompt/validator and provider payload, all hermetic.
import assert from 'node:assert/strict';
import test from 'node:test';
import { body, deferred, harness, ORDINARY_START, plain, providerResponse, settle, START, STREAM } from './devEphemeralHarness.mjs';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';

const reaction = await loadTsModule(new URL('../flows/firstTwoRoundsReaction.ts', import.meta.url), {});
const validator = await loadTsModule(new URL('../flows/ef41DeepCompositionValidator.ts', import.meta.url), { './firstTwoRoundsReaction': reaction });
const overload = '虚构场景：很多事情挤在一起，脑子很乱，不知道从哪里开始说。';
const whole = '眼前的事情暂时还没有清楚的顺序。事情同时挤在一起，说清楚它们也需要一点空间。';
const ACK = '我听到了。';
const base = { roleId: 'clever-fox', userTurn: 1, userMessage: overload, visiblePrefix: '', devPrimaryResponse: true };

for (const source of ['cleaned', 'last-resort', 'reasoning']) test(`DEV primary composition keeps every safe sentence, ordinary still selects one (${source})`, () => {
  assert.equal(validator.validateEf41DeepOutput({ ...base, source, text: whole }), whole);
  assert.equal(validator.validateEf41DeepOutput({ ...base, devPrimaryResponse: undefined, source, text: whole }), whole.split('。')[0] + '。');
});

for (const source of ['cleaned', 'last-resort']) for (const unsafe of [
  '你可以先整理一下桌面。', '你应该拿出纸来写下所有事情。', '不妨先喝一杯水。',
  '你只管慢慢说。', '我们一起整理。', '咱们再慢慢找。', '我一直在听着。',
  '如果你愿意，最想先说什么？', '先挑一件说出来。',
  '你之前提到过这件事。', '你感到害怕，也有些疲惫。', '我正在窗边喝咖啡。',
  '短句。', '```你应该先整理桌面。```',
]) test(`DEV overload rejects the whole unsafe candidate, never hides only the unsafe sentence: ${source}/${unsafe}`, () => {
  for (const text of [whole + unsafe, unsafe + whole]) {
    assert.equal(validator.validateEf41DeepOutput({ ...base, source, text }), ACK);
  }
});

for (const source of ['cleaned', 'last-resort']) test(`DEV primary keeps raw and candidate fact safety (${source})`, () => {
  const raw = `你\`\`\`${'x'.repeat(30)}\`\`\`以前留下的材料仍然摆在眼前。`;
  assert.equal(validator.validateEf41DeepOutput({ ...base, source, text: raw }), ACK);
  const safe = '这份害怕是你此刻说出的感受。';
  const input = { ...base, source, text: safe, userMessage: '虚构场景：我想接着说。' };
  assert.equal(validator.validateEf41DeepOutput(input), ACK);
  assert.equal(validator.validateEf41DeepOutput({ ...input, sameSessionUserMessages: ['虚构场景：我有些害怕。'] }), safe);
  assert.equal(validator.validateEf41DeepOutput({ ...input, sameSessionUserMessages: ['虚构场景：我想拍花草。'] }), ACK);
  for (const text of ['你最想说什么？', '如果你愿意，想说什么？还有什么？']) {
    assert.equal(validator.validateEf41DeepOutput({ ...input, text }), ACK);
  }
  const optional = '如果你愿意，可以说说拍摄对象是什么？';
  assert.equal(validator.validateEf41DeepOutput({ ...input, text: optional }), optional, 'non-overload optional-question rule unchanged');
  assert.equal(validator.validateEf41DeepOutput({ ...input, text: '🙂'.repeat(120) }), '🙂'.repeat(120));
  assert.equal(validator.validateEf41DeepOutput({ ...input, text: '🙂'.repeat(121) }), ACK);
});

test('DEV actual output is the entire validated answer without an artificial wait or front events', async () => {
  const h = await harness({ realValidator: true, provider: async () => providerResponse({ text: whole }) });
  const started = await h.request('POST', START, { input: body({ message: overload }) });
  await settle();
  const session = h.sessions[0];
  assert.deepEqual(plain(session.deepChunks), [whole]);
  assert.equal(session.deepReadyAt, session.createdAt);
  assert.equal(session.flowContext, null);
  assert.deepEqual(plain(session.keywords), []);
  for (const field of ['frontFlowText', 'reactionLayer', 'companionLayer']) assert.equal(started.res.body[field], '');
  assert.equal(started.res.body.reactionTimeline, undefined); assert.equal(started.res.body.companionTimeline, undefined);
  const sent = JSON.parse(h.providerRequests[0].options.body);
  assert.match(sent.messages[0].content, /完整回复不超过 120 个字符/);
  assert.match(sent.messages[0].content, /没有前置 Reaction \/ Companion/);
  assert.match(sent.messages[0].content, /一个 AI 陪伴角色，不是真人或医师/);
  assert.match(sent.messages[0].content, /不要诊断、解释原因、给建议或安排任务/);
  assert.doesNotMatch(sent.messages[0].content, /只是在为|补一句短|已占用总预算|生命系统|PRIOR-PRIVATE/);
  const stream = await h.request('GET', STREAM, { query: { sessionId: started.res.body.sessionId } });
  h.tick(100); await settle();
  assert.equal(stream.res.ended, true, 'first poll can publish a completed answer');
  assert.deepEqual(stream.events().map(x => x.eventType), ['turn.started', 'deep.delta', 'deep.completed', 'turn.completed']);
  assert.equal(stream.events()[1].content, whole);
  assert.deepEqual(h.identityCalls(), []);
});

test('provider partial and reasoning remain private until final reading and validation complete', async () => {
  const lastRead = deferred(); let count = 0;
  const h = await harness({ realValidator: true, provider: async () => ({ ok: true, status: 200, body: { getReader: () => ({
    read: async () => ++count === 1 ? { done: false, value: new TextEncoder().encode(
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '不应展示的内部推理', content: whole } }] })}\n\n`) } : lastRead.promise,
    cancel: async () => {},
  }) } }) });
  const started = await h.request('POST', START, { input: body({ message: overload }) }); await settle();
  const stream = await h.request('GET', STREAM, { query: { sessionId: started.res.body.sessionId } }); h.tick(100); await settle();
  assert.equal(h.sessions[0].deepDone, false); assert.deepEqual(plain(h.sessions[0].deepChunks), []);
  assert.deepEqual(stream.events().map(x => x.eventType), ['turn.started']);
  lastRead.resolve({ done: true }); await settle(); h.tick(100); await settle();
  assert.equal(stream.events().find(x => x.eventType === 'deep.delta').content, whole);
  assert.ok(!JSON.stringify(stream.events()).includes('不应展示的内部推理'));
  assert.deepEqual(h.identityCalls(), []);
});

const defaultBase = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
for (const model of ['qwen3.6-plus', 'qwen3.6-plus-2026-04-02', 'qwen-plus', 'qwen3.6-plus-new', 'QWEN3.6-PLUS', 'custom-model']) {
  for (const ordinary of [false, true]) test(`supported non-thinking option is explicitly DEV/model scoped: ${model}/${ordinary ? 'ordinary' : 'DEV'}`, async () => {
    const h = await harness({ model });
    await h.request('POST', ordinary ? ORDINARY_START : START, { input: ordinary ? { roleId: 'clever-fox', message: '虚构场景：我想拍花草。' } : body() });
    await settle();
    const request = JSON.parse(h.providerRequests[0].options.body);
    const enabled = !ordinary && ['qwen3.6-plus', 'qwen3.6-plus-2026-04-02'].includes(model);
    assert.deepEqual(Object.keys(request).sort(), [...(enabled ? ['enable_thinking'] : []), 'max_tokens', 'messages', 'model', 'stream', 'temperature']);
    if (enabled) assert.equal(request.enable_thinking, false);
    assert.equal(request.model, model); assert.equal(request.max_tokens, 1200); assert.equal(request.temperature, 0.6);
    assert.equal(request.stream, true); assert.equal(h.providerRequests.length, 1);
  });
}
for (const baseUrl of [
  defaultBase, defaultBase + '/', defaultBase + '?mode=compat', defaultBase + '#endpoint',
  'http://dashscope.aliyuncs.com/compatible-mode/v1', 'https://dashscope.aliyuncs.com/custom/v1',
  'https://dashscope.aliyuncs.com.attacker.invalid/compatible-mode/v1',
  'https://dashscope.aliyuncs.com@custom.invalid/compatible-mode/v1',
  'https://synthetic-user@dashscope.aliyuncs.com/compatible-mode/v1',
  'https://custom.invalid/compatible-mode/v1', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
]) test(`non-thinking option requires the exact verified endpoint: ${baseUrl}`, async () => {
  const h = await harness({ baseUrl });
  await h.request('POST', START, { input: body() }); await settle();
  const request = JSON.parse(h.providerRequests[0].options.body);
  assert.equal(Object.hasOwn(request, 'enable_thinking'), baseUrl === defaultBase);
  assert.equal(h.providerRequests[0].url, `${baseUrl}/chat/completions`, 'configuration is not rewritten');
  assert.equal(h.providerRequests.length, 1);
});

test('unsupported-option/provider failure never causes a fallback or duplicate model request', async () => {
  const h = await harness({ provider: async () => providerResponse({ status: 400 }) });
  const started = await h.request('POST', START, { input: body() }); await settle();
  assert.equal(h.providerRequests.length, 1);
  assert.equal(JSON.parse(h.providerRequests[0].options.body).enable_thinking, false);
  assert.equal(h.sessions[0].deepError, 'provider_api_error');
  assert.deepEqual(plain(h.sessions[0].deepChunks), []);
  assert.equal((await h.request('GET', STREAM, { query: { sessionId: started.res.body.sessionId } })).res.statusCode, 404);
  assert.deepEqual(h.identityCalls(), []);
});
