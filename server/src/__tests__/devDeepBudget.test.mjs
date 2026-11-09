// Hermetic actual handler/prompt/validator regressions. No live provider calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { body, harness, ORDINARY_START, plain, providerResponse, settle, START, STREAM } from './devEphemeralHarness.mjs';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';

const reaction = await loadTsModule(new URL('../flows/firstTwoRoundsReaction.ts', import.meta.url), {});
const validator = await loadTsModule(new URL('../flows/ef41DeepCompositionValidator.ts', import.meta.url), { './firstTwoRoundsReaction': reaction });
const prompt = await loadTsModule(new URL('../flows/deepSystemPromptBuilder.ts', import.meta.url), { './ef41DeepCompositionValidator': validator });
const sha256 = text => createHash('sha256').update(text).digest('hex');
const promptBudget = text => Number(text.match(/本次 Deep 完整输出不超过 (\d+) 个字符/)?.[1]);
const reflection = '你想慢慢说，同时仍担心大家沉默、没有回应。';
const input = '我想把那张卡片当成慢慢说的提醒，但想到大家可能沉默还是想退出。你会怎么理解我现在的顾虑？';
// Screenshot-transcribed fictional QA fixture, not a recovered server variable.
const qaReaction = '你说的「我想把那张卡片当成慢慢说」，我听到了。';
const qaCompanion = '我想把那张卡片当成慢慢说的提醒——你说的，我都在听。';
const qaPrefix = qaReaction + qaCompanion;
const timeline = text => [{ displayAt: 0, text }, { displayAt: 100, text: '未作为validator前缀的后续片段' }];
const withPrefix = (reactionText, companionText, extra = {}) => ({
  realValidator: true, reactionTimeline: timeline(reactionText), companionTimeline: timeline(companionText), ...extra,
});
async function start(h, payload = body({ message: input })) {
  const result = await h.request('POST', START, { input: payload });
  await settle(); assert.equal(result.res.statusCode, 200); return result;
}
async function complete(h, started) {
  const stream = await h.request('GET', STREAM, { query: { sessionId: started.res.body.sessionId } });
  h.tick(3100); await settle();
  assert.deepEqual(stream.events().slice(-2).map(x => x.eventType), ['deep.completed', 'turn.completed']);
  return stream;
}
function assertRequest(h, expectedPrefix, expectedBudget, expectedCount = 1) {
  assert.equal(h.providerRequests.length, expectedCount, 'one provider request per explicit turn, never a budget retry');
  const request = JSON.parse(h.providerRequests.at(-1).options.body);
  assert.deepEqual(Object.keys(request).sort(), ['max_tokens', 'messages', 'model', 'stream', 'temperature']);
  assert.equal(request.model, 'qwen3.6-plus'); assert.equal(request.max_tokens, 1200);
  assert.equal(request.stream, true); assert.equal(request.temperature, 0.6);
  assert.equal(promptBudget(request.messages[0].content), expectedBudget);
  assert.match(request.messages[0].content, /Unicode 码点计数，标点、空格和换行均计入/);
  assert.deepEqual(plain(h.calls.filter(x => x.name === 'prompt').at(-1).args[10]), {
    userTurn: expectedCount, hasContext: expectedCount > 1, deepMaxChars: expectedBudget,
  });
  for (const call of h.calls.filter(x => x.name === 'validator').slice(-1)) {
    assert.equal(call.args[0].visiblePrefix, expectedPrefix, 'same server strings, no join separator or timeline summation');
    assert.equal(call.args[0].userTurn, 1, 'DEV stays under entry-turn safety');
  }
  assert.deepEqual(h.identityCalls(), []);
  return request;
}

for (const [name, reactionText, companionText, expectedBudget] of [
  ['QA prefix49', qaReaction, qaCompanion, 71],
  ['25 non-BMP code points', '🙂'.repeat(12), '🙂'.repeat(13), 95],
  ['mixed punctuation whitespace and non-BMP', '中🙂，\n', ' 文。\n', 112],
  ['fallback fits exactly5', '前'.repeat(60), '置'.repeat(55), 5],
  ['fallback cannot fit4', '前'.repeat(60), '置'.repeat(56), 4],
  ['exact full prefix120', '前'.repeat(60), '置'.repeat(60), 0],
  ['overfull prefix121', '前'.repeat(60), '置'.repeat(61), 0],
]) {
  test(`actual handler sends accurate shared budget: ${name}`, async () => {
    // An overlong synthetic candidate isolates existing validator fallback behavior.
    const h = await harness(withPrefix(reactionText, companionText, { provider: async () => providerResponse({ text: '事'.repeat(121) }) }));
    const started = await start(h);
    assertRequest(h, reactionText + companionText, expectedBudget);
    assert.equal(h.sessions[0].frontFlowText, '当前输入的本地陪伴。', 'budget is not estimated from frontFlowText');
    assert.equal(h.sessions[0].reactionLayer, reactionText); assert.equal(h.sessions[0].companionLayer, companionText);
    const stream = await complete(h, started);
    const deep = stream.events().filter(x => x.eventType === 'deep.delta').map(x => x.content).join('');
    assert.equal(deep, expectedBudget >= 5 ? '我听到了。' : '');
    assert.ok(!stream.events().some(x => x.eventType === 'error'), 'low budget retains the existing empty-completed terminal');
    assert.equal(h.providerRequests.length, 1); assert.deepEqual(h.identityCalls(), []);
    if (expectedBudget < 5) {
      const continuation = await h.request('POST', START, { input: body({ message: input, requestId: `${h.now()}_next`,
        devConversationId: started.res.body.devConversationId, afterRequestId: started.req.body.requestId }) });
      assert.equal(continuation.res.statusCode, 404, 'empty Deep still ends context, without absorbing PR167');
      assert.equal(h.providerRequests.length, 1);
    }
  });
}

test('actual provider assembly handles the internal no-prefix boundary with budget120', async () => {
  const h = await harness({ realValidator: true, provider: async () => providerResponse({ text: reflection }) });
  // Greeting creates a valid ephemeral session without a provider call. The empty
  // prefix is an injected internal boundary, not a normally generated front layer.
  await start(h, body({ message: '你好' })); assert.equal(h.providerRequests.length, 0);
  Object.assign(h.sessions[0], { reactionLayer: '', companionLayer: '', userMessage: input });
  await h.startDeepAnalysis(h.sessions[0], 1, h.now() + 135000); await settle();
  assertRequest(h, '', 120); assert.deepEqual(plain(h.sessions[0].deepChunks), [reflection]);
});

for (const length of [71, 72, 84]) test(`QA prefix49 gives71; unchanged actual validator handles candidate${length}`, async () => {
  const text = length === 84 ? reflection.repeat(4) : '事'.repeat(length - 1) + '。';
  assert.equal(Array.from(qaPrefix).length, 49); assert.equal(Array.from(text).length, length);
  const h = await harness(withPrefix(qaReaction, qaCompanion, { provider: async () => providerResponse({ text }) }));
  const started = await start(h); assertRequest(h, qaPrefix, 71);
  assert.deepEqual(plain(h.sessions[0].deepChunks), [length <= 71 ? text : '我听到了。']);
  await complete(h, started);
});

for (const [source, responseOptions] of [
  ['cleaned', { text: reflection }], ['last-resort', { text: '事'.repeat(10) }], ['reasoning', { text: reflection, reasoning: true }],
]) test(`prompt and ${source} validator use the same exact prefix`, async () => {
  const h = await harness(withPrefix(qaReaction, qaCompanion, { provider: async () => providerResponse(responseOptions) }));
  await start(h); assertRequest(h, qaPrefix, 71);
  const validation = h.calls.filter(x => x.name === 'validator');
  assert.equal(validation.length, 1); assert.equal(validation[0].args[0].source, source);
  assert.deepEqual(plain(h.sessions[0].deepChunks), [responseOptions.text]);
});

test('third DEV turn uses current prefix budget and exact bounded role-separated context', async () => {
  const h = await harness(withPrefix(qaReaction, qaCompanion, { provider: async () => providerResponse({ text: reflection }) }));
  let previous;
  for (let turn = 1; turn <= 3; turn++) {
    const payload = body({ message: input, requestId: `${h.now()}_turn-${turn}`,
      ...(previous ? { devConversationId: previous.res.body.devConversationId, afterRequestId: previous.req.body.requestId } : {}) });
    const started = await start(h, payload), sent = assertRequest(h, qaPrefix, 71, turn);
    assert.deepEqual(sent.messages.slice(1), [
      ...Array.from({ length: turn - 1 }, () => [{ role: 'user', content: input }, { role: 'assistant', content: reflection }]).flat(),
      { role: 'user', content: input },
    ]);
    assert.match(sent.messages[0].content, new RegExp(`当前是第 ${turn} 轮`));
    assert.deepEqual(plain(h.calls.filter(x => x.name === 'validator').at(-1).args[0].sameSessionUserMessages), Array(turn - 1).fill(input));
    await complete(h, started); previous = started;
  }
});

const build = (devSession, turn = 1, role = 'clever-fox') => prompt.buildDeepSystemPrompt(
  role, '测试角色', '前置测试文本', undefined, null, '测试变化', null, '测试摘要', turn, '当前消息', devSession,
);
for (const [value, expected] of [
  [0, 0], [4, 4], [5, 5], [71, 71], [120, 120], [121, 120], [71.9, 71], [-1, 0],
  [NaN, 0], [Infinity, 0], [-Infinity, 0], [undefined, 0], [null, 0], ['71', 0],
]) test(`internal DEV budget normalization: ${String(value)}`, () => {
  const text = build({ userTurn: 3, hasContext: true, deepMaxChars: value });
  assert.equal(promptBudget(text), expected);
  assert.match(text, /最多两句/); assert.match(text, /只输出“我听到了。”/);
  assert.doesNotMatch(text, /不超过 (?:NaN|Infinity|-) /);
});

// SHA256 of full ordinary prompt bytes captured from the unchanged PR168 source,
// including the existing role style for each later-turn prompt.
for (const [role, laterHash] of [
  ['clever-fox', '9c1fb223715d3f57c4a38a66c965e4d32806c007f71a3b250b7f79401c4db228'],
  ['warm-bear', '8879adae5660a2fd5fe5a8c4e761c335f855f861dc7b276510714ce5d4e71e57'],
  ['wise-owl', 'fe02eb7c948b7d4ce5d40ab458f6ebcc240d12f5741801b12331e7a075110a32'],
  ['emotion-elf', '76ad46d5700d0c98fbd85c8f87f4c67ae44cb8305b4d5dc5c64d93294e4b051f'],
  ['philosophical-dolphin', '75612877e11018c11221833188637c8283132d538a2b01858900291227081717'],
  ['family-elephant', 'ff5132b880f8be08d49099634666fdfc5818ad71368c1c2a323c68fbb4354d25'],
]) test(`ordinary prompt bytes unchanged: ${role}, turns1/2/3`, () => {
  assert.equal(sha256(build(undefined, 1, role)), '89fd396021e54c36f96b0de04a140c998c03f4175589d56c8cd183d729ecfe4a');
  assert.equal(sha256(build(undefined, 2, role)), '39cdc96d9d2d414033c0d0aecfab5dd3f9c16d34a5a4eec5538342352d3bb0c5');
  assert.equal(sha256(build(undefined, 3, role)), laterHash);
});

for (const turn of [1, 2, 3]) test(`ordinary handler does not receive DEV budget at turn${turn}`, async () => {
  const h = await harness({ ordinaryTurn: turn });
  await h.request('POST', ORDINARY_START, { input: { roleId: 'clever-fox', message: input,
    ...(turn > 1 ? { conversationId: 'existing', requestId: 'ordinary' } : {}) } });
  await settle(); assert.equal(h.providerRequests.length, 1);
  const args = h.calls.filter(x => x.name === 'prompt').at(-1).args;
  assert.equal(args[8], turn); assert.equal(args[10], undefined);
  const sent = JSON.parse(h.providerRequests[0].options.body);
  assert.equal(sent.messages[0].content, prompt.buildDeepSystemPrompt(...args));
  assert.doesNotMatch(sent.messages[0].content, /本次 Deep 完整输出不超过|已占用总预算/);
  for (const name of ['local.reaction', 'local.companion']) assert.equal(h.calls.find(x => x.name === name).args[3], turn);
});

for (const source of ['cleaned', 'last-resort', 'reasoning']) test(`unchanged real validator safety/length/question/history matrix: ${source}`, () => {
  for (const userTurn of [1, 2]) for (const roleId of ['clever-fox', 'warm-bear']) {
    const base = { source, userTurn, roleId, userMessage: input, visiblePrefix: qaPrefix };
    for (const text of [
      '我正坐在窗边喝咖啡，翻着笔记本。', '你之前提到担心大家没有回应，现在仍然想退出。',
      '你想慢慢说，同时也害怕大家沉默、没有回应。', '你最在意的是没有回应吗？',
      '如果你愿意，能说说吗？可以不回答，你想继续吗？', reflection.repeat(4),
    ]) assert.equal(validator.validateEf41DeepOutput({ ...base, text }), '我听到了。');
    assert.equal(validator.validateEf41DeepOutput({ ...base, text: reflection }), reflection);
    const optional = '如果你愿意，可以说说大家沉默时你最在意的是什么？';
    assert.equal(validator.validateEf41DeepOutput({ ...base, text: optional }), optional);
    const grounded = '这份害怕是你此刻说出的感受。';
    assert.equal(validator.validateEf41DeepOutput({ ...base, text: grounded, sameSessionUserMessages: ['我有些害怕。'] }), grounded);
    assert.equal(validator.validateEf41DeepOutput({ ...base, text: '你之前提到害怕。', sameSessionUserMessages: ['我有些害怕。'] }), '我听到了。');
    const later = ' \n你之前提到害怕。\n ';
    assert.equal(validator.validateEf41DeepOutput({ ...base, userTurn: 3, text: later }), later);
    for (const prefixLength of [0, 115, 116, 120, 121]) {
      const actual = validator.validateEf41DeepOutput({ ...base, text: '我正在喝咖啡。', visiblePrefix: '🙂'.repeat(prefixLength) });
      assert.equal(actual, prefixLength <= 115 ? '我听到了。' : '');
    }
  }
});
