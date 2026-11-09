// Normal registered-handler regression tests retained after EF-385 diagnostics.
// No observer, diagnostic factory, filesystem sink, host access or live provider.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import test from 'node:test';
import { body, harness, plain, providerResponse, settle, START, STREAM } from './devEphemeralHarness.mjs';

const ACK = '我听到了。';
const DEFAULT = '等这一团稍微松开，事情的轻重也许会慢慢显出来。';
const overload = '很多事情挤在一起，脑子很乱，不知道从哪里开始说。';
const wrap = text => `Here's a thinking process\n1. Check constraints\n${text}`;
function mixed(content, reasoning) {
  const frames = [{ content }, { reasoning_content: reasoning }];
  return { ok: true, status: 200, body: { getReader: () => ({ read: async () => frames.length
    ? { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: frames.shift() }] })}\n\n`) }
    : { done: true }, cancel: async () => {} }) } };
}
const cases = [
  ['discarded content allows reasoning', () => mixed(ACK, ACK), {}, [ACK], 'reasoning'],
  ['selected content beats reasoning', () => mixed('事'.repeat(10), ACK), {}, ['事'.repeat(10)], 'last-resort'],
  ['empty validated chunk still suppresses reasoning', () => mixed('事'.repeat(121), ACK), { prefix: '前'.repeat(116) }, [''], 'cleaned'],
  ['pure short acknowledgement still discarded', { text: ACK }, {}, [], null],
  ['whitespace acknowledgement still discarded', { text: ` ${ACK} ` }, {}, [], null],
  ['empty stream', { text: '' }, {}, [], null],
  ['non-Chinese content', { text: 'English only' }, {}, [], null],
  ['cleaner selects wrapped acknowledgement', { text: wrap(ACK) }, {}, [ACK], 'cleaned'],
  ['reasoning acknowledgement', { text: ACK, reasoning: true }, {}, [ACK], 'reasoning'],
  ['last resort ten Chinese characters', { text: '事'.repeat(10) }, {}, ['事'.repeat(10)], 'last-resort'],
  ['cleaned plain', { text: '这是眼前的一件事情，也是此刻想要说清楚的一部分。' }, {}, ['这是眼前的一件事情，也是此刻想要说清楚的一部分。'], 'cleaned'],
  ['reasoning plain', { text: '事情仍在眼前。', reasoning: true }, {}, ['事情仍在眼前。'], 'reasoning'],
  ['budget substitution', { text: '事'.repeat(121) }, {}, [ACK], 'cleaned'],
  ['budget fallback cannot fit', { text: '事'.repeat(121) }, { prefix: '前'.repeat(116) }, [''], 'cleaned'],
  ['raw fact substitution', { text: '我正在喝咖啡。', reasoning: true }, {}, [ACK], 'reasoning'],
  ['raw fact fallback cannot fit', { text: '我正在喝咖啡。', reasoning: true }, { prefix: '前'.repeat(116) }, [''], 'reasoning'],
  ['one uninvited question', { text: '现在想说什么？', reasoning: true }, {}, [ACK], 'reasoning'],
  ['two optional questions', { text: '如果你愿意，想说什么？还有什么？', reasoning: true }, {}, [ACK], 'reasoning'],
  ['one optional question accepted', { text: '如果你愿意，想说什么？', reasoning: true }, {}, ['如果你愿意，想说什么？'], 'reasoning'],
  ['EF41 sentence selection', { text: '眼前的事情暂时还没有清楚的顺序。', reasoning: true }, { message: overload }, ['眼前的事情暂时还没有清楚的顺序。'], 'reasoning'],
  ['EF41 default selection', { text: ACK, reasoning: true }, { message: overload }, [DEFAULT], 'reasoning'],
  ['post-selection fact rejection', { text: `你\`\`\`${'x'.repeat(30)}\`\`\`以前留下的材料仍然摆在眼前。`, reasoning: true }, { message: overload }, [ACK], 'reasoning'],
];
for (const [name, response, extra, expected, source] of cases) test(`unchanged Deep output: ${name}`, async () => {
  const h = await harness({ realValidator: true, provider: async () => typeof response === 'function' ? response() : providerResponse(response),
    ...(extra.prefix ? { reactionTimeline: [{ displayAt: 0, text: extra.prefix }], companionTimeline: [] } : {}),
  });
  const started = await h.request('POST', START, { input: body(extra.message ? { message: extra.message } : {}) });
  await settle(); assert.equal(started.res.statusCode, 200);
  assert.deepEqual(plain(h.sessions[0].deepChunks), expected);
  const validations = h.calls.filter(call => call.name === 'validator');
  assert.deepEqual(validations.map(call => call.args[0].source), source ? [source] : []);
  const stream = await h.request('GET', STREAM, { query: { sessionId: started.res.body.sessionId } });
  h.tick(3100); await settle();
  assert.deepEqual(stream.events().slice(-2).map(event => event.eventType), ['deep.completed', 'turn.completed']);
  assert.equal(stream.events().filter(event => event.eventType === 'deep.delta').map(event => event.content).join(''), expected.join(''));
  assert.equal(h.providerRequests.length, 1);
  const sent = JSON.parse(h.providerRequests[0].options.body);
  assert.deepEqual(Object.keys(sent).sort(), ['max_tokens', 'messages', 'model', 'stream', 'temperature']);
  assert.equal(sent.model, 'qwen3.6-plus'); assert.equal(sent.max_tokens, 1200); assert.equal(sent.temperature, 0.6); assert.equal(sent.stream, true);
  assert.equal(sent.messages.length, 2); assert.deepEqual(h.identityCalls(), []);
});

test('retired runtime/helper and temporary test sinks are absent', async () => {
  for (const path of ['../observability/ef385DevResultDiagnostic.ts', '../observability/ef385DevResultOperator.ts',
    './ef385DevResultDiagnostic.test.mjs', './ef385DevResultIntegration.test.mjs', './ef385DiagnosticHarness.mjs']) {
    await assert.rejects(access(new URL(path, import.meta.url)), { code: 'ENOENT' });
  }
  assert.doesNotMatch(await readFile(new URL('../index.ts', import.meta.url), 'utf8'), /ef385DevResultDiagnostic|ef385DevResultOperator/);
  assert.doesNotMatch(await readFile(new URL('../../build.js', import.meta.url), 'utf8'), /ef385DevResultOperator/);
});
