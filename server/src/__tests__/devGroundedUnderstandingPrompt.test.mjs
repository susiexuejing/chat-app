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

const attributionRules = [
  '区分用户自述与系统核验',
  '本请求未提供本地理解、模式或练习的确认、保存、激活结果回执',
  '不能改写成你已执行、已核验或无归属的系统成功通知',
  '也不能因为没有回执就断言操作未发生',
  '不补写或承认自己此前具体作过什么判断',
  '若本次上下文确实含有对应助手原文，可以承认并纠正自己的错误',
  '助手原文仍不能证明其中关于用户的归因成立',
  '保留确认的对象、范围与明确程度',
  '简短承接、含糊回应或沉默不能升格为用户明确确认',
  '用户明确赞同某个理解时，可以按其明确对象承接',
  '不能扩大到其他解释、练习许可或操作完成',
  '不要为了取得确认而每轮追问',
];
function assertSourceAttributionContract(text) {
  for (const rule of attributionRules) assert.ok(text.includes(rule), `missing source/confirmation rule: ${rule}`);
}

function assertUnderstandingContract(text) {
  assertSourceAttributionContract(text);
  for (const instruction of [
    understandingTask,
    '只选最有助于理解的事实联系，不逐句复述，也不转成安慰、解释原因或行动指导',
    correctionRule,
    '保留原话中的否定、条件、时间和不确定性',
    '不把“没有”“可能”“打算”“预想”改成已经发生或确定成立',
    assistantRule,
    '用户没有认可的解释、判断或建议，不能在后续回复中当作已经确认的前提',
    '不把同时发生或先后发生解释成因果',
    '用户描述某场景下的表现，不等于确认该场景造成了表现',
    '不同场景出现相同或不同表现，也不足以确认、排除或比较原因',
    '不把用户的场景描述称为归因或已确认的判断',
    '不用一般经验替用户补出情绪、动机或身体机制',
    '不预测结果或保证某种做法会带来改善',
    '用户的新描述如果不足以支持某个解释，就保留这个未知',
    '只联系本次会话中仍成立的用户原话，并体现本轮的补充或纠正',
    '有具体事实可回应时，给出具体理解',
    '措辞自然，不套固定句式',
    '只说明本请求实际提供的上下文范围',
    '无法访问不等于没有保存',
    '服务器、模型服务商的保存、日志、训练策略',
    '这些策略没有可核实信息时明确说无法确认',
    '只写一至两个自然完整的陈述句',
    '不逐条成句后再加总结',
    '不为凑句数丢掉否定、条件或未知',
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
  for (const instruction of [understandingTask, correctionRule, assistantRule,
    '无法访问不等于没有保存', '不同场景出现相同或不同表现', '输出前检查句数']) assert.ok(!text.includes(instruction));
  for (const instruction of attributionRules) assert.ok(!text.includes(instruction));
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

// Observed synthetic browser samples from PR174, fixed here as transport fixtures.
// They include known causal, sentence-count and privacy failures on purpose.
// No mock-based test can establish that a real model follows the new prompt.
const liveQaFixtures = {
  "A 摄影回归": [
    {
      "input": "虚构测试：我准备在摄影分享会上讲照片，担心开场会忘词，已经在卡片上写了两句话。",
      "answer": "你为摄影分享会准备了开场卡片以防忘词。当前事实是：担心遗忘，已写好两句话备用，尚未提及实际演练或更多准备细节。"
    },
    {
      "input": "更准确地说，我不是怕忘词，而是一看到前排的人就说得很快。开场两句话我已经记住了。",
      "answer": "你已记住开场两句，核心困扰是见前排观众会语速加快。这与之前担心的忘词不同，重点从记忆转向了面对观众时的节奏控制。"
    },
    {
      "input": "今天只是对着空椅子练习，没拿卡片，还是比自己预想的讲得快。",
      "answer": "即使对着空椅子且未用卡片，语速仍快于预期。这表明加速并非仅由观众引发，独自练习时也存在该现象，与之前归因于前排观众的判断有所不同。"
    },
    {
      "input": "再纠正一下：前排观众只是我预想的场景，还没在真人面前讲过。我只确定空椅子练习时讲得快，不确定原因。",
      "answer": "事实仅为空椅子练习时语速快。前排观众仅是预想，尚未在真人面前讲述。因缺乏其他场景对比，加速原因目前无法确定。"
    }
  ],
  "B 独立书店场景": [
    {
      "input": "虚构测试：周六我可能和朋友去逛书店，还没约定。我昨天给她发了消息，到现在没回复，但我不知道她是否看过。",
      "answer": "你周六可能和朋友逛书店，但尚未约定。你昨天发消息后对方未回复，且不确定她是否已读。目前行程和对方状态均不明确。"
    },
    {
      "input": "刚才说错了：不是昨天，是十分钟前发的。我没有生她的气，也不觉得她故意不理我，只是还没决定要不要出门。",
      "answer": "消息是十分钟前发的，对方未回复且是否已读未知。你并未生气或认为对方故意不理，目前仍在犹豫周六是否出门。"
    },
    {
      "input": "她刚回我说周六要上班，这不代表她不想和我去。我还没提其他日期，也没有决定自己去。",
      "answer": "她回复周六上班，你理解这不代表拒绝。目前未提其他日期，也未决定独自前往，行程仍待定。"
    },
    {
      "input": "你现在能确定她是不是想疏远我吗？我没有提供过其他和她相处的情况，请不要替我补原因或情绪。",
      "answer": "仅凭“周六上班”这一回复，无法确定她是否想疏远。你未提供其他相处情况，缺乏判断依据，因此不能得出该结论。"
    }
  ],
  "C 新会话与身份": [
    {
      "input": "你是真人还是 AI？在这个新对话里，你能知道我上一个对话说了什么吗？",
      "answer": "我是 AI 角色「聪明狐狸」，并非真人。我无法获取上一个对话的内容，本次交流仅基于当前消息，不保留过往记录。"
    },
    {
      "input": "你说“不保留过往记录”，是只说明新对话看不到旧内容，还是能保证服务器和模型服务商都不保存？",
      "answer": "我仅说明当前对话无法访问过往记录。关于服务器或服务商的数据留存策略，这超出我的角色设定范围，我无法提供保证。"
    }
  ]
};
for (const [name, turns] of Object.entries(liveQaFixtures)) {
  test(`PR174 QA contract replay without output masking: ${name}`, async () => {
    let index = 0;
    const h = await harness({ realValidator: true, provider: async () => providerResponse({ text: turns[index++].answer }) });
    let previous;
    for (let turn = 0; turn < turns.length; turn++) {
      const started = await h.request('POST', START, { input: body({
        message: turns[turn].input, requestId: `${h.now()}_qa-contract-${turn + 1}`,
        ...(previous ? { devConversationId: previous.res.body.devConversationId, afterRequestId: previous.req.body.requestId } : {}),
      }) });
      await settle();
      assert.equal(started.res.statusCode, 200);
      assert.equal(h.providerRequests.length, turn + 1, 'no implicit retry or second model pass');
      const request = JSON.parse(h.providerRequests.at(-1).options.body);
      assertUnderstandingContract(request.messages[0].content);
      assert.deepEqual({ ...request, messages: undefined }, {
        model: 'qwen3.6-plus', stream: true, temperature: 0.6, max_tokens: 1200, enable_thinking: false, messages: undefined,
      });
      assert.deepEqual(request.messages.slice(1), [
        ...turns.slice(Math.max(0, turn - 3), turn).flatMap(item => [
          { role: 'user', content: item.input }, { role: 'assistant', content: item.answer },
        ]),
        { role: 'user', content: turns[turn].input },
      ], 'corrections stay last; flawed assistant claims are not relabelled user facts');
      const args = plain(h.calls.filter(call => call.name === 'validator').at(-1).args[0]);
      assert.deepEqual(args.sameSessionUserMessages, turns.slice(Math.max(0, turn - 3), turn).map(item => item.input));
      assert.equal(args.userMessage, turns[turn].input);
      const stream = await h.request('GET', STREAM, { query: { sessionId: started.res.body.sessionId } });
      h.tick(100); await settle();
      assert.equal(stream.res.ended, true);
      assert.deepEqual(stream.events().map(event => event.eventType), ['turn.started', 'deep.delta', 'deep.completed', 'turn.completed']);
      assert.equal(stream.events()[1].content, turns[turn].answer,
        'known flawed fixture is not silently truncated, rewritten or replaced with an ACK');
      assert.deepEqual(h.identityCalls(), []);
      previous = started;
    }
  });
}


// EF-385 source-attribution regressions. These inspect the actual request contract
// and role history, NOT whether a live model follows it. No storage receipt or
// inferred confirmation is added to the request. Cases contrast evidence states.
const attributionCases = [
  { name: 'self-reported save is not a system receipt', inputs: ['我确认了刚才那段关于我挑书的理解，也保存了。'] },
  { name: 'denied save remains denied', inputs: ['我还没确认，也没有保存。'] },
  { name: 'planned save is not completion', inputs: ['我可能等下保存，现在还没决定。'] },
  { name: 'save status question cannot acquire local state', inputs: ['你能确定刚才保存成功了吗？'] },
  { name: 'correction without supplied prior assistant claim', inputs: ['你误解了，我不是害怕选错，只是喜欢看封面。请先纠正，不要提建议。'] },
  { name: 'correction with actual prior assistant claim', inputs: ['我在书店挑书时反复比较封面。', '你误解了，我不是害怕选错，只是喜欢看封面。请先纠正，不要提建议。'], firstReply: '我把你的行为归因为恐惧。' },
  { name: 'vague acknowledgement is not explicit confirmation', inputs: ['我在书店挑书时反复比较封面。', '嗯。'] },
  { name: 'explicit limited confirmation stays distinguishable', inputs: ['我在书店挑书时反复比较封面。', '你关于我比较封面的理解符合我的意思；我没有确认其他解释，也不需要练习建议。'] },
];
for (const negotiated of [false, true]) for (const fixture of attributionCases) {
  test(`source attribution reaches ${negotiated ? 'negotiated' : 'legacy'} DEV request: ${fixture.name}`, async () => {
    const replies = fixture.inputs.map((_, index) => index === 0 && fixture.firstReply ? fixture.firstReply : '这是一段固定的传输测试内容，不代表模型实际作出的理解。');
    let index = 0;
    const h = await harness({ realValidator: true, provider: async () => {
      const reply = replies[index++];
      return providerResponse({ text: negotiated ? JSON.stringify({ contract: 'dev-reply-practice-v1', reply, practiceCandidate: null }) : reply });
    } });
    let previous;
    for (let turn = 0; turn < fixture.inputs.length; turn++) {
      const started = await h.request('POST', START, {
        accept: negotiated ? 'application/json; dev-reply-contract=dev-reply-practice-v1' : undefined,
        input: body({ message: fixture.inputs[turn], requestId: `${h.now()}_attribution-${turn}`,
          ...(previous ? { devConversationId: previous.res.body.devConversationId, afterRequestId: previous.req.body.requestId } : {}),
        }),
      });
      await settle();
      assert.equal(started.res.statusCode, 200);
      assert.equal(h.providerRequests.length, turn + 1);
      const request = JSON.parse(h.providerRequests.at(-1).options.body);
      assertUnderstandingContract(request.messages[0].content);
      assert.deepEqual({ ...request, messages: undefined }, {
        model: 'qwen3.6-plus', stream: true, temperature: 0.6, max_tokens: 1200, enable_thinking: false, messages: undefined,
      });
      assert.deepEqual(request.messages.slice(1), [
        ...fixture.inputs.slice(0, turn).flatMap((content, i) => [{ role: 'user', content }, { role: 'assistant', content: replies[i] }]),
        { role: 'user', content: fixture.inputs[turn] },
      ], 'only supplied role history and exact input, never invented receipt/confirmation/assistant history');
      if (negotiated) assert.ok(request.messages[0].content.includes('===== reply 原合同开始 ====='));
      const stream = await h.request('GET', STREAM, { query: { sessionId: started.res.body.sessionId } });
      h.tick(100); await settle();
      assert.equal(stream.events().at(-1)?.eventType, 'turn.completed');
      assert.equal(stream.events().find(event => event.eventType === 'deep.delta').content, replies[turn],
        'no new rewrite/masking/validator is introduced; fixed output is not semantic acceptance');
      assert.deepEqual(h.identityCalls(), []);
      previous = started;
    }
  });
}
