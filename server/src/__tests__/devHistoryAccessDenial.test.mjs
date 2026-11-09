// Hermetic regression of a confirmed validator false positive. This does not
// identify the unknown provider text behind any particular live ACK.
import assert from 'node:assert/strict';
import test from 'node:test';
import { body, harness, providerResponse, settle, START, STREAM } from './devEphemeralHarness.mjs';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';

const reaction = await loadTsModule(new URL('../flows/firstTwoRoundsReaction.ts', import.meta.url), {});
const validator = await loadTsModule(new URL('../flows/ef41DeepCompositionValidator.ts', import.meta.url), { './firstTwoRoundsReaction': reaction });
const input = { roleId: 'clever-fox', userTurn: 1, userMessage: '你是真人还是AI？你能知道我上一个对话说了什么吗？', visiblePrefix: '', devPrimaryResponse: true };
const ACK = '我听到了。';
const safe = [
  '我是AI。我无法访问你之前的对话内容。',
  '我是AI。我不知道你以前说过什么。',
  '我是人工智能，我不能读取你以前的聊天记录。',
  '我无法查看你之前的对话。',
  '我不清楚你之前聊过的内容。',
  '我是 AI。\n我无法获取你以前的聊天内容。',
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
];

for (const source of ['cleaned', 'last-resort']) {
  for (const text of safe) test(`DEV clear access denial survives unchanged: ${source}/${text}`, () => {
    assert.equal(validator.validateEf41DeepOutput({ ...input, text, source }), text);
    assert.equal(validator.validateEf41DeepOutput({ ...input, text, source, devPrimaryResponse: false }), ACK,
      'ordinary behavior is deliberately unchanged');
  });
  for (const text of unsafe) test(`DEV denial exemption never hides additional claims: ${source}/${text}`, () => {
    assert.equal(validator.validateEf41DeepOutput({ ...input, text, source }), ACK);
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
