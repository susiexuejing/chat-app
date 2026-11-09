// Prompt and transport contracts only. Synthetic provider text is fixed by the
// test, so passing these tests cannot establish live model understanding quality.
import assert from 'node:assert/strict';
import test from 'node:test';
import { body, harness, plain, providerResponse, settle, START, STREAM } from './devEphemeralHarness.mjs';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';

const reaction = await loadTsModule(new URL('../flows/firstTwoRoundsReaction.ts', import.meta.url), {});
const validator = await loadTsModule(new URL('../flows/ef41DeepCompositionValidator.ts', import.meta.url), { './firstTwoRoundsReaction': reaction });
const prompt = await loadTsModule(new URL('../flows/deepSystemPromptBuilder.ts', import.meta.url), { './ef41DeepCompositionValidator': validator });
const understandingTask = '你的任务是形成一段具体、可由用户核对和修正的理解';
const correctionRule = '用户最新的明确纠正或否认优先于较早的说法';
const assistantRule = '本次会话中的 assistant 回复不是用户事实';

function assertUnderstandingContract(text) {
  for (const instruction of [
    understandingTask,
    '只选最有助于理解的事实联系，不逐句复述，也不转成安慰、解释原因或行动指导',
    correctionRule,
    '保留原话中的否定、条件、时间和不确定性',
    '不把“没有”“可能”“打算”“预想”改成已经发生或确定成立',
    assistantRule,
    '用户没有认可的解释、判断或建议，不能在后续回复中当作已经确认的前提',
    '不把同时发生或先后发生解释成因果',
    '不用一般经验替用户补出情绪、动机或身体机制',
    '不预测结果或保证某种做法会带来改善',
    '用户的新描述如果不足以支持某个解释，就保留这个未知',
    '只联系本次会话中仍成立的用户原话，并体现本轮的补充或纠正',
    '有具体事实可回应时，给出具体理解',
    '措辞自然，不套固定句式',
  ]) assert.ok(text.includes(instruction), `missing DEV instruction: ${instruction}`);
  assert.match(text, /一个 AI 陪伴角色，不是真人或医师/);
  assert.match(text, /不要诊断、解释原因、给建议或安排任务，也不要自动判断或保存心理模式/);
  assert.match(text, /不要替用户补充未说出的情绪、身体感受、事件或关系经历/);
  assert.match(text, /用陈述句自然承接，不要提问/);
  assert.match(text, /最多两句/);
  assert.match(text, /只输出“我听到了。”/);
  assert.doesNotMatch(text, /摄影|卡片|空椅|前排|忘词|没拿|没看/,
    'the task contract is general, not a hardcoded replay of the QA scenario');
}

for (const userTurn of [1, 2, 3, 5]) for (const deepMaxChars of [71, 120]) {
  test(`actual DEV prompt defines grounded, revisable understanding: turn${userTurn}/budget${deepMaxChars}`, () => {
    const hasContext = userTurn > 1;
    const text = prompt.buildDeepSystemPrompt('clever-fox', '测试角色', 'UNUSED-FRONT', undefined,
      null, 'UNUSED-CHANGE', null, 'UNUSED-SUMMARY', 1, '当前输入', { userTurn, hasContext, deepMaxChars });
    assertUnderstandingContract(text);
    assert.match(text, new RegExp(`当前是第 ${userTurn} 轮`));
    assert.match(text, new RegExp(`完整回复不超过 ${deepMaxChars} 个字符`));
    assert.match(text, hasContext ? /仅当前消息和随请求提供的本次会话用户原话可作为用户事实来源/
      : /当前这条用户消息是关于用户的唯一事实来源/);
    assert.doesNotMatch(text, /UNUSED-|生命系统|真实的人/);
  });
}

for (const userTurn of [1, 2, 3]) test(`grounded DEV task is absent from ordinary prompt at turn${userTurn}`, () => {
  const text = prompt.buildDeepSystemPrompt('clever-fox', '测试角色', '前置文本', undefined,
    null, '', null, '', userTurn, '当前输入');
  for (const instruction of [understandingTask, correctionRule, assistantRule]) assert.ok(!text.includes(instruction));
  // Full ordinary byte parity across all six roles is retained in devDeepBudget.
});

test('actual provider context preserves corrections and role boundaries without promoting assistant assertions to facts', async () => {
  // Synthetic reproduction of the correction/negation shapes. These are not
  // recordings of model output and are not semantic acceptance expectations.
  const inputs = [
    '虚构测试：我准备在摄影分享会上讲照片，担心开场会忘词，已经在卡片上写了两句话。',
    '更准确地说，我不是怕忘词，而是一看到前排的人就说得很快。开场两句话我已经记住了。',
    '今天只是对着空椅子练习，没拿卡片，还是比自己预想的讲得快。',
  ];
  // Deliberately flawed assistant fixtures keep earlier advice/inference visible
  // in its original role. The unchanged validator is not a semantic proof gate.
  const replies = [
    '卡片能帮你稳住节奏，可以带到台上。',
    '紧张让你说得更快，深呼吸后节奏会自然稳定。',
    '这次练习面对的是空椅子，也没有拿卡片，讲述还是比你预想的快。',
  ];
  let providerTurn = 0;
  const h = await harness({ realValidator: true, provider: async () => providerResponse({ text: replies[providerTurn++] }) });
  let previous;
  for (let turn = 0; turn < inputs.length; turn++) {
    const started = await h.request('POST', START, { input: body({
      message: inputs[turn], requestId: `${h.now()}_grounded-${turn + 1}`,
      ...(previous ? { devConversationId: previous.res.body.devConversationId, afterRequestId: previous.req.body.requestId } : {}),
    }) });
    await settle();
    assert.equal(started.res.statusCode, 200);
    assert.equal(h.providerRequests.length, turn + 1, 'one request per explicit send, no repair/retry call');
    const request = JSON.parse(h.providerRequests.at(-1).options.body);
    assert.deepEqual({ ...request, messages: undefined }, {
      model: 'qwen3.6-plus', stream: true, temperature: 0.6, max_tokens: 1200, enable_thinking: false, messages: undefined,
    });
    assertUnderstandingContract(request.messages[0].content);
    const args = h.calls.filter(call => call.name === 'prompt').at(-1).args;
    assert.equal(request.messages[0].content, prompt.buildDeepSystemPrompt(...args));
    assert.deepEqual(request.messages.slice(1), [
      ...inputs.slice(0, turn).flatMap((content, i) => [{ role: 'user', content }, { role: 'assistant', content: replies[i] }]),
      { role: 'user', content: inputs[turn] },
    ], 'latest correction remains last, without summarizing, filtering, relabeling or adding history');
    assert.deepEqual(plain(h.calls.filter(call => call.name === 'validator').at(-1).args[0]), {
      text: replies[turn], source: turn === 0 ? 'last-resort' : 'cleaned', roleId: 'clever-fox', userTurn: 1,
      userMessage: inputs[turn], visiblePrefix: '', devPrimaryResponse: true, sameSessionUserMessages: inputs.slice(0, turn),
    }, 'only user messages are supplied to the existing fact view; assistant assertions stay out');
    const stream = await h.request('GET', STREAM, { query: { sessionId: started.res.body.sessionId } });
    h.tick(100); await settle();
    assert.equal(stream.res.ended, true);
    assert.deepEqual(stream.events().map(event => event.eventType), ['turn.started', 'deep.delta', 'deep.completed', 'turn.completed']);
    assert.equal(stream.events()[1].content, replies[turn], 'no new validator/ACK masking is introduced');
    assert.equal(h.sessions.at(-1).userMessage, '');
    assert.deepEqual(plain(h.sessions.at(-1).deepChunks), []);
    assert.deepEqual(h.identityCalls(), []);
    previous = started;
  }
});
