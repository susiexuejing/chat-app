import assert from 'node:assert/strict';
import test from 'node:test';
import { body, harness, providerResponse, settle, START, STREAM } from './devEphemeralHarness.mjs';
const message='很多事情让我脑子很乱，我看了三遍清单，请给我一个小练习。';
const reply='我听到了。';
const value={contract:'dev-reply-practice-v1',reply,practiceCandidate:{ifCue:'准备再看清单时',thenAction:'暂停片刻，自行决定是否继续。',evidence:{permissionQuote:'请给我一个小练习',anchorQuote:'我看了三遍清单',naturalClosing:false,smallChoiceFits:true,currentUserRequest:true,continuingExpression:true,correctionOrRefusalOrExit:false,topicChanged:false}}};
async function run(v, msg=message){
 const h=await harness({realValidator:true,provider:async()=>providerResponse({text:JSON.stringify(v)})});
 const r=await h.request('POST',START,{input:body({message:msg}),accept:'application/json; dev-reply-contract=dev-reply-practice-v1'});await settle();
 const s=await h.request('GET',STREAM,{query:{sessionId:r.res.body.sessionId}});h.tick(100);await settle();
 return {h,events:s.events(),final:s.events().find(e=>e.eventType==='turn.completed')};
}
test('actual non-retry handler withholds candidate when rejected fallback equals original reply',async()=>{
 const {h,events,final}=await run(value);assert.ok(final);assert.equal(final.practiceReply.reply,reply);assert.equal(final.practiceReply.practiceCandidate,null);
 assert.equal(h.providerRequests.length,1);assert.equal(events.filter(e=>e.eventType==='deep.delta').map(e=>e.content).join(''),reply);
});
test('same literal accepted by validator outside overload keeps eligible candidate',async()=>{
 const {h,final}=await run(value,'我看了三遍清单，请给我一个小练习。');assert.ok(final);assert.equal(final.practiceReply.practiceCandidate.thenAction,value.practiceCandidate.thenAction);assert.equal(h.providerRequests.length,1);
});
test('legitimate ordinary null remains successful without extra request',async()=>{
 const {h,final}=await run({...value,practiceCandidate:null},'我看了三遍清单，请给我一个小练习。');assert.ok(final);assert.equal(final.practiceReply.practiceCandidate,null);assert.equal(h.providerRequests.length,1);
});
for (const overload of [true,false]) test(`non-retry v2 retains rejection provenance, overload=${overload}`,async()=>{
 const msg=overload?message:'我看了三遍清单，请给我一个小练习。';
 const v={contract:'dev-reply-practice-v2',narrative:reply,practiceCandidate:null};
 const h=await harness({realValidator:true,practiceV2Enabled:'1',provider:async()=>providerResponse({text:JSON.stringify(v)})});
 const r=await h.request('POST',START,{input:body({message:msg}),accept:'application/json; dev-reply-contract=dev-reply-practice-v2'});await settle();
 assert.equal(r.res.body.devReplyContract,'dev-reply-practice-v2');
 const s=await h.request('GET',STREAM,{query:{sessionId:r.res.body.sessionId}});h.tick(100);await settle();
 const events=s.events();
 if(overload) assert.ok(!events.some(e=>e.eventType==='turn.completed'||e.eventType==='deep.delta'));
 else {const final=events.find(e=>e.eventType==='turn.completed');assert.ok(final);assert.equal(final.practiceReply.practiceCandidate,null);}
 assert.equal(h.providerRequests.length,1);
});
