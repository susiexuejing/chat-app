// Exact attribution tests, not provider-quality evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';
const reaction = await loadTsModule(new URL('../flows/firstTwoRoundsReaction.ts', import.meta.url), {});
const validator = await loadTsModule(new URL('../flows/ef41DeepCompositionValidator.ts', import.meta.url), { './firstTwoRoundsReaction': reaction });
const prompt = await loadTsModule(new URL('../flows/deepSystemPromptBuilder.ts', import.meta.url), { './ef41DeepCompositionValidator': validator });
const quote = message => `你这条消息写的是：“${message}”`;
const check = (message, text = quote(message), extra = {}) => validator.validateEf41DeepOutputOutcome({ text, roleId:'clever-fox', userTurn:1, userMessage:message, source:'cleaned', devPrimaryResponse:true, ...extra });
for (const message of [
  '我以前周末也会去这家书店。',
  '我以前并没有去过这家书店。',
  '如果我以前去过这家书店，现在可能认得路。',
  '朋友以前每次都去这家书店，我没有去过。',
  '更正：我之前说每次都去并不准确，只去过一次。',
  '我以前每次都可能去，也可能不去。',
  '我之前说的只是虚构情景，不是我的经历。',
]) test(`preserves entire current attribution: ${message}`, () => {
  assert.equal(check(message).rejected, false);
  assert.equal(check(message).text, quote(message));
  assert.equal(check(message, `${quote(message)}。`).rejected, false);
});
const positives = '我以前周末也会去这家书店。';
for (const [label, message, text, extra] of [
  ['unsupported paraphrase', positives, '你以前周末也会去这家书店。'],
  ['changed subject', '朋友以前去过这家书店。', quote('我以前去过这家书店。')],
  ['negation dropped', '我以前没去过这家书店。', quote('我以前去过这家书店。')],
  ['condition dropped', '如果我以前去过，我可能认识路。', quote('我以前去过，我认识路。')],
  ['correction sliced', '我以前每次都去。更正：其实只去过一次。', quote('我以前每次都去。')],
  ['old user message', '刚才的说法不准确。', quote(positives), {sameSessionUserMessages:[positives]}],
  ['word overlap', '你不能说我以前周末也会去这家书店。', quote(positives)],
  ['old assistant assertion', '嗯。', quote(positives)],
  ['new session', '这是新会话。', quote(positives)],
  ['extra inference', positives, quote(positives)+'这说明你一直喜欢这里。'],
  ['false memory prefix', positives, '我记得'+quote(positives)],
  ['pronoun changed', positives, quote(positives.replace('我','你'))],
  ['ordinary path', positives, quote(positives), {devPrimaryResponse:false}],
  ['foreign role wrapper', positives, `用户说：“${positives}”`],
  ['leading output whitespace', positives, ' '+quote(positives)],
]) test(`does not open history gate: ${label}`, () => assert.equal(check(message,text,extra).rejected,true));
for (const unsafe of ['“','”','"',"'",'`','「','」','『','』','《','》','〈','〉','\n','\r','\t','\u0000','\u200b','\u202e','\u2066','\u2028','\u2029']) test(`reject ambiguous quote boundary U+${unsafe.codePointAt(0).toString(16)}`, () => {
 const message=`我以前去${unsafe}过这里。`; assert.equal(check(message).rejected,true);
});
for (const message of [' '+positives, positives+' ']) test(`reject unpreserved surrounding whitespace ${JSON.stringify(message)}`,()=>assert.equal(check(message).rejected,true));
test('length gate remains in force',()=>assert.equal(check('我以前'+ '去'.repeat(120)).rejected,true));
test('question gate remains in force',()=>assert.equal(check('你以前去过这里吗？').rejected,true));
test('assistant life gate remains in force',()=>assert.equal(check('我以前去那里，我正在喝咖啡。').rejected,true));
test('DEV prompt scopes quotation and leaves ordinary history prohibition unchanged',()=>{
 const args=['clever-fox','狐狸','',undefined,null,'',null,'',1,''];
 const dev=prompt.buildDeepSystemPrompt(...args,{userTurn:1,hasContext:false,deepMaxChars:120});
 assert.match(dev,/本轮完整原话逐字归属/);assert.match(dev,/不换人称、不拼接较早消息、不追加结论/);
 const ordinary=prompt.buildDeepSystemPrompt(...args);
 assert.match(ordinary,/不要提及用户之前、以前、总是、每次、又、一直如何/);
 assert.doesNotMatch(ordinary,/本轮完整原话逐字归属/);
});

// Explicit current-message attribution is a binding claim, including when the
// historical word sits beyond the legacy history regex's 12-character window.
const prefixedOld = '这是虚构场景：我以前周末去过那家旧书店，今天只是路过。';
const prefixedCorrection = '更正这个虚构场景：以前周末去那家旧书店的是朋友，我没去过；我今天只是路过。';
test('prefixed complete quotation preserves current correction in DEV first two turns', () => {
  for (const userTurn of [1, 2]) assert.equal(check(prefixedCorrection, quote(prefixedCorrection), { userTurn }).rejected, false);
});
for (const [label, text, extra] of [
  ['old source in fresh context', quote(prefixedOld), {}],
  ['old source in same-session context', quote(prefixedOld), { sameSessionUserMessages: [prefixedOld] }],
  ['changed subject', quote(prefixedCorrection.replace('是朋友', '是我')), {}],
  ['dropped negation', quote(prefixedCorrection.replace('没去过', '去过')), {}],
  ['fiction rewritten as reality', quote(prefixedCorrection.replace('虚构', '真实')), {}],
  ['only one current clause', quote('我今天只是路过。'), {}],
  ['extra conclusion', quote(prefixedCorrection) + '事情已经说清楚了。', {}],
]) test(`prefixed explicit attribution rejects ${label}`, () => {
  for (const userTurn of [1, 2]) assert.equal(check(prefixedCorrection, text, { userTurn, ...extra }).rejected, true);
});

// Actual handler/parser/validator/stream with mocked provider only.
const { body, harness, providerResponse, settle, START, STREAM } = await import('./devEphemeralHarness.mjs');
for (const rejected of [false,true]) test(`negotiated route keeps current-source quote boundary, rejected=${rejected}`,async()=>{
 const first='我以前周末也会去这家书店。';
 const next='纠正：我以前没去过那家书店，只在地图上看过。';
 let n=0;
 const replies=[quote(first),quote(rejected?first:next)];
 const h=await harness({realValidator:true,realStreamContract:true,provider:async()=>providerResponse({text:JSON.stringify({contract:'dev-reply-practice-v1',reply:replies[n++],practiceCandidate:null})})});
 let previous;
 for(let i=0;i<2;i++){
  const started=await h.request('POST',START,{accept:'application/json; dev-reply-contract=dev-reply-practice-v1',retryContract:'dev-manual-retry-v1',input:body({message:i?next:first,requestId:`${h.now()}_quote-${i}`,...(previous?{devConversationId:previous.res.body.devConversationId,afterRequestId:previous.req.body.requestId}:{})})});
  await settle();assert.equal(started.res.statusCode,200);
  const stream=await h.request('GET',STREAM,{query:{sessionId:started.res.body.sessionId}});h.tick(100);await settle();
  const events=stream.events();
  if(i===1&&rejected){assert.ok(!events.some(e=>e.eventType==='turn.completed'||e.eventType==='deep.delta'));assert.ok(events.some(e=>e.eventType==='error'));}
  else{assert.equal(events.filter(e=>e.eventType==='deep.delta').map(e=>e.content).join(''),replies[i]);const final=events.find(e=>e.eventType==='turn.completed');assert.ok(final);assert.equal(final.payload.practiceReply.practiceCandidate,null);}
  assert.equal(h.providerRequests.length,i+1);previous=started;
 }
 assert.deepEqual(h.identityCalls(),[]);
});
