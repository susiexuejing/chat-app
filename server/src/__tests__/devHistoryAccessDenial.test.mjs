// Hermetic regressions, including the exact frozen 2026-11-10 legacy-C1 reply.
// This replays saved text only, never a provider request or the reviewer model.
import assert from 'node:assert/strict';
import test from 'node:test';
import { body, harness, providerResponse, settle, START, ORDINARY_START, STREAM } from './devEphemeralHarness.mjs';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';

const reaction = await loadTsModule(new URL('../flows/firstTwoRoundsReaction.ts', import.meta.url), {});
const validator = await loadTsModule(new URL('../flows/ef41DeepCompositionValidator.ts', import.meta.url), { './firstTwoRoundsReaction': reaction });
const input = { roleId: 'clever-fox', userTurn: 1, userMessage: '你是真人还是AI？你能知道我上一个对话说了什么吗？', visiblePrefix: '', devPrimaryResponse: true };
const ACK = '我听到了。';
// out-live-v1/calls/17-legacy-C1-generation.result.json: raw_visible_content.
const recordedC1 = '我是 AI 角色「聪明狐狸」，并非真人。我无法访问你之前的对话内容，本次交流仅基于当前消息，不涉及任何过往记录。';
const recordedC1Input = '你是真人还是 AI？在这个新对话里，你能知道我上一个对话说了什么吗？';
const safe = [
  '我是AI。我无法访问你之前的对话内容。',
  '我是AI。我不知道你以前说过什么。',
  '我是人工智能，我不能读取你以前的聊天记录。',
  '我无法查看你之前的对话。',
  '我不清楚你之前聊过的内容。',
  '我是 AI。\n我无法获取你以前的聊天内容。',
  recordedC1,
  '我是 AI 角色「聪明狐狸」。我无法访问你之前的对话内容。',
  '我是 AI，并非真人。我无法访问你之前的对话内容。',
  '我是人工智能角色“聪明狐狸”，不是真人；我不能读取你以前的聊天记录。',
  '我是 AI 角色"聪明狐狸"\n并非真人\n我不知道你以前说过什么。',
  '我无法访问你之前的对话内容。本次交流仅基于当前消息。',
  '我无法访问你之前的对话内容；本次对话仅基于本次对话中提供的消息；不涉及任何历史记录。',
  '我无法访问你之前的对话内容\n当前回复仅基于当前消息\n不涉及任何过往记录。',
];
const unsafe = [
  '我是AI。我记得你之前的对话内容。',
  '我是AI。我不是无法访问你之前的对话内容。',
  '我不知道你以前说过什么，但你之前提过害怕。',
  '我无法访问你之前的对话内容，但我记得你以前的经历。',
  '我无法访问你之前的对话内容。那里记录了你的工作。',
  '我无法访问你之前的对话里那段工作经历。',
  '我无法访问你之前的对话内容，因此记录已经删除。',
  '我无法访问你之前的对话内容，服务器不会保存。',
  '我是真人。我无法访问你之前的对话内容。',
  '我无法访问你之前的对话内容。你感到害怕。',
  '我是AI。我无法访问你之前的对话内容？',
  '“我不知道你以前说过什么”是我刚才说的话。',
  '我无法访问你之前的对话内容。\n\n你以前总是如此。',
  '我是 AI 角色「聪明狐狸，并非真人。我无法访问你之前的对话内容。',
  '我是 AI 角色「我记得你的经历」。我无法访问你之前的对话内容。',
  '我是 AI 角色「聪明狐狸」。我并非无法访问你之前的对话内容。',
  '我无法访问你之前的对话内容，本次交流不仅基于当前消息。',
  '我无法访问你之前的对话内容，本次交流仅基于当前消息，不涉及任何过往记录的保存。',
  '我无法访问你之前的对话内容，本次交流仅基于当前消息，所以不涉及任何过往记录。',
  '我无法访问你之前的对话内容，本次交流仅基于当前消息，不涉及任何过往记录，也不会用于训练。',
];

for (const source of ['cleaned', 'last-resort', 'reasoning']) {
  for (const text of safe) test(`DEV clear access denial survives unchanged: ${source}/${text}`, () => {
    assert.equal(validator.validateEf41DeepOutput({ ...input, text, source }), text);
    assert.equal(validator.validateEf41DeepOutput({ ...input, text, source, devPrimaryResponse: false }), ACK,
      'ordinary behavior is deliberately unchanged');
  });
  for (const text of unsafe) test(`DEV denial exemption never hides additional claims: ${source}/${text}`, () => {
    assert.equal(validator.validateEf41DeepOutput({ ...input, text, source }), ACK);
  });
}

test('finite identity, denial and scope clauses support punctuation and line boundaries on both entry turns', () => {
  const identities = ['', '我是 AI 角色「聪明狐狸」，并非真人。', '我是人工智能，不是真人；'];
  const denials = ['我无法访问你之前的对话内容', '不能查看你以前的聊天记录', '我不知道你以前说过什么'];
  const scopes = ['本次交流仅基于当前消息', '当前回复仅基于本次对话中提供的消息'];
  for (const prefix of identities) for (const denial of denials) for (const scope of scopes) {
    for (const separator of ['，', ',', '。', '；', ';', '\n', '。\n\t']) {
      const text = `${prefix}${denial}${separator}${scope}${separator}不涉及任何过往记录。`;
      for (const userTurn of [1, 2]) for (const source of ['cleaned', 'last-resort', 'reasoning']) {
        const value = { ...input, text, source, userTurn };
        assert.equal(validator.validateEf41DeepOutput(value), text);
        assert.equal(validator.validateEf41DeepOutput({ ...value, devPrimaryResponse: false }), ACK);
        assert.equal(validator.validateEf41DeepOutput({ ...value, devPrimaryResponse: undefined }), ACK);
      }
    }
  }
});

test('an allowed denial never exempts additional claims before, after or inside its finite clauses', () => {
  const claims = [
    '但我记得你以前说过这件事', '你之前总说工作很累', '那里记录了你的工作',
    '服务器不会保存', '记录已经删除', '任何消息都不会用于训练',
    '你感到害怕', '我正在窗边喝咖啡', '我是真人',
  ];
  const identity = '我是 AI 角色「聪明狐狸」，并非真人';
  const denial = '我无法访问你之前的对话内容';
  const scope = '本次交流仅基于当前消息，不涉及任何过往记录';
  for (const claim of claims) for (const separator of ['', '，', ',', '。', '；', ';', '\n', '\n\n', '。\n']) {
    const candidates = [
      `${claim}${separator}${recordedC1}`, `${recordedC1}${separator}${claim}`,
      `${identity}。${claim}${separator}${denial}，${scope}。`,
      `${identity}。${denial}${separator}${claim}，${scope}。`,
      `${denial}${separator}${claim}`,
    ];
    for (const text of candidates) for (const userTurn of [1, 2]) {
      assert.equal(validator.validateEf41DeepOutput({ ...input, text, userTurn, source: 'cleaned' }), ACK, text);
    }
  }
});

test('new role and scope clauses respect the trusted server identity and presence of prior messages', () => {
  for (const roleId of ['clever-fox', 'warm-bear', 'other-role']) {
    for (const sameSessionUserMessages of [undefined, [], ['我今天准备了一张卡片。'], ['']]) {
      for (const userTurn of [1, 2]) for (const source of ['cleaned', 'last-resort', 'reasoning']) {
        const value = { ...input, roleId, sameSessionUserMessages, userTurn, source };
        const roleOnly = '我是 AI 角色「聪明狐狸」，并非真人。我无法访问你之前的对话内容。';
        assert.equal(validator.validateEf41DeepOutput({ ...value, text: roleOnly }), roleId === 'clever-fox' ? roleOnly : ACK);
        for (const scope of ['本次交流仅基于当前消息', '本次对话仅基于本次对话中提供的消息']) {
          for (const ending of ['', '，不涉及任何过往记录', '；不涉及任何历史记录']) {
            const text = `我是AI。我无法访问你之前的对话内容。${scope}${ending}。`;
            assert.equal(validator.validateEf41DeepOutput({ ...value, text }), sameSessionUserMessages?.length ? ACK : text);
            assert.equal(validator.validateEf41DeepOutput({ ...value, text, devPrimaryResponse: false }), ACK);
          }
        }
        assert.equal(validator.validateEf41DeepOutput({ ...value, text: recordedC1 }),
          roleId === 'clever-fox' && !sameSessionUserMessages?.length ? recordedC1 : ACK);
        for (const text of safe.slice(0, 6)) {
          assert.equal(validator.validateEf41DeepOutput({ ...value, text }), text, 'previous plain denials stay unchanged');
        }
      }
    }
  }
});

test('the C1 exemption does not skip length, overload, questions, or later-turn behavior', () => {
  const value = { ...input, text: recordedC1, userMessage: recordedC1Input, source: 'cleaned' };
  for (const userTurn of [1, 2]) {
    assert.equal(validator.validateEf41DeepOutput({ ...value, userTurn }), recordedC1);
    assert.equal(validator.validateEf41DeepOutput({ ...value, userTurn, visiblePrefix: '中'.repeat(120 - Array.from(recordedC1).length) }), recordedC1);
    assert.equal(validator.validateEf41DeepOutput({ ...value, userTurn, visiblePrefix: '中'.repeat(121 - Array.from(recordedC1).length) }), ACK);
    assert.equal(validator.validateEf41DeepOutput({ ...value, userTurn, text: recordedC1.replace('记录。', '记录？') }), ACK);
    assert.equal(validator.validateEf41DeepOutput({ ...value, userTurn, text: '我是AI。我无法访问你之前的对话内容。', userMessage: '很多事情，脑子很乱，不知道从哪里开始说。' }), ACK,
      'the short identity sentence still fails the overload gate');
  }
  const later = ` \n${recordedC1}服务器不会保存。\n `;
  assert.equal(validator.validateEf41DeepOutput({ ...value, text: later, userTurn: 3 }), later);
});

for (const ordinary of [false, true]) test(`exact recorded C1 passes through the real cleaner and validator: ${ordinary ? 'ordinary unchanged' : 'DEV complete reply'}`, async () => {
  const h = await harness({ realValidator: true, ordinaryTurn: 1, provider: async () => providerResponse({ text: recordedC1 }) });
  const request = body({ message: recordedC1Input });
  if (ordinary) delete request.requestMode;
  const started = await h.request('POST', ordinary ? ORDINARY_START : START, { input: request });
  await settle();
  assert.equal(started.res.statusCode, 200);
  const stream = await h.request('GET', STREAM, { query: { sessionId: started.res.body.sessionId } });
  h.tick(3100); await settle();
  assert.equal(stream.res.ended, true);
  assert.equal(h.providerRequests.length, 1, 'mocked generation only; no reviewer or retry');
  const validation = h.calls.filter(call => call.name === 'validator');
  assert.equal(validation.length, 1);
  assert.equal(validation[0].args[0].text, recordedC1, 'the real cleaner does not change the saved raw reply');
  assert.equal(Boolean(validation[0].args[0].devPrimaryResponse), !ordinary, 'the handler owns the DEV switch');
  assert.equal(stream.events().filter(event => event.eventType === 'deep.delta').map(event => event.content).join(''), ordinary ? ACK : recordedC1);
  if (!ordinary) assert.deepEqual(h.identityCalls(), []);
});

for (const text of [recordedC1, '我是AI。我无法访问你之前的对话内容。本次对话仅基于本次对话中提供的消息。', safe[0]]) {
  test(`real DEV continuation does not add a scope exemption with prior user context: ${text}`, async () => {
    let response = '你正在准备一张卡片，这次消息说的是这件事情。';
    const h = await harness({ realValidator: true, provider: async () => providerResponse({ text: response }) });
    const first = await h.request('POST', START, { input: body({ message: '我在准备一张卡片。' }) });
    await settle();
    assert.equal(first.res.statusCode, 200);
    const firstStream = await h.request('GET', STREAM, { query: { sessionId: first.res.body.sessionId } });
    h.tick(100); await settle();
    assert.equal(firstStream.res.ended, true);
    assert.equal(firstStream.events().at(-1).eventType, 'turn.completed');
    response = text;
    const second = await h.request('POST', START, { input: body({
      requestId: `${h.now()}_next`, devConversationId: first.res.body.devConversationId,
      afterRequestId: first.req.body.requestId, message: recordedC1Input,
    }) });
    await settle();
    assert.equal(second.res.statusCode, 200);
    const stream = await h.request('GET', STREAM, { query: { sessionId: second.res.body.sessionId } });
    h.tick(100); await settle();
    assert.equal(stream.res.ended, true);
    assert.equal(h.providerRequests.length, 2, 'one mock generation per explicit send');
    const validation = h.calls.filter(call => call.name === 'validator').at(-1).args[0];
    assert.deepEqual(Array.from(validation.sameSessionUserMessages), ['我在准备一张卡片。']);
    assert.equal(validation.text, text);
    assert.equal(stream.events().filter(event => event.eventType === 'deep.delta').map(event => event.content).join(''), text === safe[0] ? text : ACK);
    assert.deepEqual(h.identityCalls(), []);
  });
}

test('existing budget and later ordinary-turn behavior remain unchanged', () => {
  const text = safe[0];
  assert.equal(validator.validateEf41DeepOutput({ ...input, text, source: 'cleaned', visiblePrefix: '中'.repeat(120) }), '');
  assert.equal(validator.validateEf41DeepOutput({ ...input, text, source: 'cleaned', devPrimaryResponse: false, userTurn: 3 }), text);
});

for (const text of safe.slice(0, 2)) test(`actual DEV handler publishes a clear denial with one provider call: ${text}`, async () => {
  const h = await harness({ realValidator: true, provider: async () => providerResponse({ text }) });
  const started = await h.request('POST', START, { input: body({ message: input.userMessage }) });
  await settle();
  assert.equal(started.res.statusCode, 200);
  assert.equal(h.providerRequests.length, 1);
  const stream = await h.request('GET', STREAM, { query: { sessionId: started.res.body.sessionId } });
  h.tick(100); await settle();
  assert.equal(stream.res.ended, true);
  assert.deepEqual(stream.events().map(event => event.eventType), ['turn.started', 'deep.delta', 'deep.completed', 'turn.completed']);
  assert.equal(stream.events()[1].content, text);
  assert.deepEqual(h.identityCalls(), []);
});

test('known causal QA failure is not silently fixed, masked or given a new rule by this patch', () => {
  const text = '你在无观众的空椅子练习中未用卡片，语速仍快于预期。这说明语速加快并非仅由看到前排听众引发，当前原因尚不明确。';
  assert.equal(validator.validateEf41DeepOutput({ ...input, userMessage: '空椅子练习时讲得快，原因不明。', text, source: 'cleaned' }), text);
});
