import assert from 'node:assert/strict';
import test from 'node:test';
import { body, harness, providerResponse, settle, START, STREAM, ORDINARY_START, plain } from './devEphemeralHarness.mjs';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';
const D='dev-candidate-diagnostic-v1';
const R='dev-manual-retry-v1';
const accept='application/json; dev-reply-contract=dev-reply-practice-v1';
const message='虚构输入_SENTINEL_INPUT：今天开会时我低头看稿。请给我一个很小的下一步建议。';
const reply='虚构回复_SENTINEL_REPLY：你说的是今天开会时低头看稿。';
const output=()=>({contract:'dev-reply-practice-v1',reply,practiceCandidate:{ifCue:'下次开会低头看稿时',thenAction:'可以先抬头说一句，再决定是否继续。',evidence:{permissionQuote:'请给我一个很小的下一步建议',anchorQuote:'今天开会时我低头看稿',naturalClosing:false,smallChoiceFits:true,currentUserRequest:true,continuingExpression:true,correctionOrRefusalOrExit:false,topicChanged:false}}});
async function run(options={}) {
 const {value=output(),owner,provider}=options;
 const enabled=Object.hasOwn(options,'enabled')?options.enabled:'1'; const header=Object.hasOwn(options,'header')?options.header:D; const retry=Object.hasOwn(options,'retry')?options.retry:R; const nodeEnv=Object.hasOwn(options,'nodeEnv')?options.nodeEnv:'development';
 const h=await harness({candidateDiagnosticEnabled:enabled,nodeEnv,realStreamContract:true,provider:provider??(async()=>providerResponse({text:JSON.stringify(value)}))});
 const r=await h.request('POST',START,{input:body({message}),accept,retryContract:retry,candidateDiagnostic:header,...(owner!==undefined?{owner}:{})});
 await settle();
 if(r.res.statusCode!==200)return {h,r};
 const stream=await h.request('GET',STREAM,{query:{sessionId:r.res.body.sessionId}});h.tick(100);await settle();
 return {h,r,stream,events:stream.events()};
}
for(const [name,opts] of [['default disabled',{enabled:undefined}],['client not requested',{header:undefined}],['incorrect header',{header:D+'-unknown'}],['retry not negotiated',{retry:undefined}]]) test(name+' emits no diagnostics',async()=>{
 const x=await run(opts);assert.equal(x.r.res.body.devCandidateDiagnostic,undefined);assert.ok(!JSON.stringify(x.events).includes('candidateDiagnostic'));assert.equal(x.h.providerRequests.length,1);
});
for(const nodeEnv of ['production','test',undefined])test('route denied outside development '+nodeEnv,async()=>{const x=await run({nodeEnv});assert.equal(x.r.res.statusCode,404);assert.equal(x.h.providerRequests.length,0);assert.ok(!JSON.stringify(x.r.res.body).includes(D));});
test('unauthenticated start never negotiates',async()=>{const x=await run({owner:null});assert.notEqual(x.r.res.statusCode,200);assert.equal(x.h.providerRequests.length,0);assert.ok(!JSON.stringify(x.r.res.body).includes(D));});
for(const [stage,mutate] of [['model_null',v=>{v.practiceCandidate=null}],['candidate_ready',()=>{}],['candidate_filtered',v=>{v.practiceCandidate.evidence.currentUserRequest=false}],['reply_rejected',v=>{v.practiceCandidate.extra='not allowed'}]])test('actual handler '+stage,async()=>{
 const value=output();mutate(value);const x=await run({value});assert.equal(x.r.res.body.devCandidateDiagnostic,D);
 const terminal=x.events.find(e=>['turn.completed','error'].includes(e.eventType));assert.ok(terminal,JSON.stringify(x.events));assert.equal(terminal.payload.candidateDiagnostic,stage);
 assert.ok(!JSON.stringify(x.h.logs).includes('SENTINEL'));assert.ok(!JSON.stringify({candidateDiagnostic:terminal.payload.candidateDiagnostic}).includes('SENTINEL'));
 const outsider=await x.h.request('GET',STREAM,{query:{sessionId:x.r.res.body.sessionId},owner:'other'});assert.notEqual(outsider.res.statusCode,200);assert.ok(!JSON.stringify(outsider.res).includes('candidateDiagnostic'));
});
test('diagnostic on/off has identical successful protocol except negotiated fields',async()=>{
 const on=await run();const off=await run({enabled:undefined});const strip=o=>JSON.parse(JSON.stringify(o),(k,v)=>['candidateDiagnostic','devCandidateDiagnostic','timestamp'].includes(k)?undefined:v);
 assert.deepEqual(strip(on.r.res.body),strip(off.r.res.body));assert.deepEqual(strip(on.events),strip(off.events));
});
test('parser observational callback cannot rewrite result or bubble thrown errors',async()=>{
 const c=await loadTsModule(new URL('../contracts/devPracticeCandidate.ts',import.meta.url),{});
 const raw=JSON.stringify(output());const options={latestUserMessage:message,providerCompleted:true,source:{sessionId:'secret_session',devConversationId:'secret_conversation',requestId:'secret_request'},replyMaxChars:120,rejectRewrittenReply:true,validateReply:s=>({text:s,rejected:false})};
 const baseline=c.parseDevPracticeReply(raw,options);const observed=[];assert.deepEqual(plain(c.parseDevPracticeReply(raw,{...options,candidateDiagnostic:s=>observed.push(s)})),plain(baseline));assert.deepEqual(observed,['candidate_ready']);
 assert.deepEqual(plain(c.parseDevPracticeReply(raw,{...options,candidateDiagnostic:()=>{throw Error('observer failure')}})),plain(baseline));
});
test('incomplete provider stream reports provider_incomplete not model_null',async()=>{
 let read=false;
 const provider=async()=>({ok:true,status:200,body:{getReader:()=>({read:async()=>{
   if(read)return{done:true}; read=true;
   return {done:false,value:new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(output())}}]})+'\n\n')};
 }})}});
 const x=await run({provider});
 const terminal=x.events.find(e=>e.eventType==='error');assert.ok(terminal);assert.equal(terminal.payload.candidateDiagnostic,'provider_incomplete');assert.equal(x.h.providerRequests.length,1);
});
test('negotiated diagnostic expires with owner-bound session',async()=>{
 const h=await harness({candidateDiagnosticEnabled:'1',realStreamContract:true,provider:async()=>providerResponse({text:JSON.stringify(output())})});
 const r=await h.request('POST',START,{input:body({message}),accept,retryContract:R,candidateDiagnostic:D});await settle();h.tick(600001);await settle();
 const stream=await h.request('GET',STREAM,{query:{sessionId:r.res.body.sessionId}});assert.notEqual(stream.res.statusCode,200);assert.ok(!JSON.stringify(stream.res).includes('candidateDiagnostic'));
});
