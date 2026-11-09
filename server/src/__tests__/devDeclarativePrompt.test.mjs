// Prompt/request contract tests with synthetic provider output, not a live
// response-quality claim. No sockets, credentials, or persistent writes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { body, harness, ORDINARY_START, plain, providerResponse, settle, START, STREAM } from './devEphemeralHarness.mjs';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';

const reaction = await loadTsModule(new URL('../flows/firstTwoRoundsReaction.ts', import.meta.url), {});
const validator = await loadTsModule(new URL('../flows/ef41DeepCompositionValidator.ts', import.meta.url), { './firstTwoRoundsReaction': reaction });
const prompt = await loadTsModule(new URL('../flows/deepSystemPromptBuilder.ts', import.meta.url), { './ef41DeepCompositionValidator': validator });
const DEV_LINE = '- 用陈述句自然承接，不要提问。';
const ORDINARY_LINE = '- 最多一个问题；如有问题，必须是用户可以不回答的邀请。';
const ACK = '我听到了。';
const reply = '你想把拍摄对象从街景换成花草，这就是现在说出的打算。';
const input = '虚构测试：我想把拍摄对象从街景换成花草。';
const build = (turn, devSession) => prompt.buildDeepSystemPrompt(
  'clever-fox', '测试角色', '前置测试文本', undefined, null, '测试变化', null, '测试摘要', turn, input, devSession,
);

for (const userTurn of [1, 2, 3, 5]) test(`DEV entry-style prompt requests only declarative continuation at conversation turn${userTurn}`, () => {
  const hasContext = userTurn > 1;
  // DEV always passes the safe entry turn separately from its conversation turn.
  const text = build(1, { userTurn, hasContext, deepMaxChars: 71 });
  assert.ok(text.includes(DEV_LINE));
  assert.ok(!text.includes(ORDINARY_LINE));
  assert.match(text, new RegExp(`当前是第 ${userTurn} 轮`));
  assert.match(text, /本次 Deep 完整输出不超过 71 个字符（按 Unicode 码点计数，标点、空格和换行均计入），最多两句/);
  assert.match(text, /不要诊断、解释原因、给建议或安排任务/);
  assert.match(text, /只输出“我听到了。”/);
  assert.match(text, hasContext ? /仅当前消息和随请求提供的本次会话用户原话可作为用户事实来源；assistant 消息只供理解对话衔接/ : /当前这条用户消息是关于用户的唯一事实来源/);
  assert.doesNotMatch(text, /生命系统|测试变化|测试摘要|前置测试文本/);
});

test('five actual DEV requests retain entry-turn safety, exact bounded context, budget and model options', async () => {
  const h = await harness({ realValidator: true, provider: async () => providerResponse({ text: reply }) });
  const messages = [];
  let previous;
  for (let turn = 1; turn <= 5; turn++) {
    const message = `${input}这是第${turn}轮。`;
    const started = await h.request('POST', START, { input: body({ message, requestId: `${h.now()}_declarative-${turn}`,
      ...(previous ? { devConversationId: previous.res.body.devConversationId, afterRequestId: previous.req.body.requestId } : {}),
    }) });
    await settle();
    assert.equal(started.res.statusCode, 200);
    assert.equal(h.providerRequests.length, turn, 'one provider request per explicit turn, without retries');
    const request = JSON.parse(h.providerRequests.at(-1).options.body);
    assert.deepEqual(Object.keys(request).sort(), ['max_tokens', 'messages', 'model', 'stream', 'temperature']);
    assert.deepEqual({ ...request, messages: undefined }, {
      model: 'qwen3.6-plus', stream: true, temperature: 0.6, max_tokens: 1200, messages: undefined,
    });
    assert.deepEqual(request.messages.slice(1), [
      ...messages.slice(-3).flatMap(content => [{ role: 'user', content }, { role: 'assistant', content: reply }]),
      { role: 'user', content: message },
    ]);
    const args = h.calls.filter(call => call.name === 'prompt').at(-1).args;
    assert.equal(args[8], 1, 'entry-turn prompt safety never changes with DEV conversation turn');
    const session = h.sessions.at(-1);
    const visiblePrefix = session.reactionLayer + session.companionLayer;
    const deepMaxChars = Math.max(0, 120 - Array.from(visiblePrefix).length);
    assert.deepEqual(plain(args[10]), { userTurn: turn, hasContext: turn > 1, deepMaxChars });
    assert.equal(request.messages[0].content, prompt.buildDeepSystemPrompt(...args));
    assert.ok(request.messages[0].content.includes(DEV_LINE));
    assert.ok(!request.messages[0].content.includes(ORDINARY_LINE));
    assert.match(request.messages[0].content, new RegExp(`本次 Deep 完整输出不超过 ${deepMaxChars} 个字符`));
    const calls = h.calls.filter(call => call.name === 'validator');
    assert.equal(calls.length, turn);
    assert.deepEqual(plain(calls.at(-1).args[0]), {
      text: reply, source: 'cleaned', roleId: 'clever-fox', userTurn: 1,
      userMessage: message, visiblePrefix, sameSessionUserMessages: messages.slice(-3),
    });
    const stream = await h.request('GET', STREAM, { query: { sessionId: started.res.body.sessionId } });
    h.tick(3100); await settle();
    assert.deepEqual(stream.events().slice(-2).map(event => event.eventType), ['deep.completed', 'turn.completed']);
    assert.equal(stream.events().filter(event => event.eventType === 'deep.delta').map(event => event.content).join(''), reply);
    assert.equal(session.userMessage, '');
    assert.deepEqual(plain(session.deepChunks), []);
    assert.deepEqual(h.identityCalls(), []);
    messages.push(message); previous = started;
  }
});

for (const turn of [1, 2, 3]) test(`ordinary request keeps its original prompt at turn${turn}`, async () => {
  const h = await harness({ ordinaryTurn: turn, realValidator: true });
  await h.request('POST', ORDINARY_START, { input: { roleId: 'clever-fox', message: input,
    ...(turn > 1 ? { conversationId: 'existing', requestId: 'ordinary' } : {}),
  } });
  await settle();
  assert.equal(h.providerRequests.length, 1);
  const request = JSON.parse(h.providerRequests[0].options.body);
  const args = h.calls.filter(call => call.name === 'prompt').at(-1).args;
  assert.equal(args[8], turn);
  assert.equal(args[10], undefined);
  assert.equal(request.messages[0].content, prompt.buildDeepSystemPrompt(...args));
  assert.ok(!request.messages[0].content.includes(DEV_LINE));
  if (turn <= 2) assert.ok(request.messages[0].content.includes(ORDINARY_LINE));
});

for (const [name, text, expected] of [
  ['non-optional question still falls back', '你想拍摄的花草具体是什么样的呢？', ACK],
  ['multiple optional questions still fall back', '如果你愿意，想拍什么花？可以不回答，想拍什么草？', ACK],
  ['single optional question remains allowed by the unchanged validator', '如果你愿意，想拍摄的花草是什么样的？', '如果你愿意，想拍摄的花草是什么样的？'],
  ['grounded declarative output remains accepted', reply, reply],
  ['ungrounded feeling still falls back', '这让你感到害怕，也让你暂时停下了拍摄。', ACK],
  ['over-budget output still falls back', '景'.repeat(121), ACK],
]) test(`declarative instruction does not modify enforcement: ${name}`, async () => {
  const h = await harness({ realValidator: true, provider: async () => providerResponse({ text }) });
  await h.request('POST', START, { input: body({ message: input }) });
  await settle();
  assert.equal(h.providerRequests.length, 1);
  assert.equal(h.calls.filter(call => call.name === 'validator').length, 1);
  assert.deepEqual(plain(h.sessions[0].deepChunks), [expected]);
  assert.deepEqual(h.identityCalls(), []);
});
