import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule, deferred } from './moduleHarness.mjs';
const api=await loadTsModule(new URL('../../../screens/chat/api/cozeApi.ts',import.meta.url),{
 'expo-constants':{default:{expoConfig:{extra:{EXPO_PUBLIC_BACKEND_BASE_URL:'https://offline.invalid'}}}},'react-native':{Platform:{OS:'web'}},
 zod:{z:{iso:{datetime:()=>({safeParse:()=>({success:true})})}}},'../utils/ef77Diagnostics':{emitEf77Trace(){},getEf77ErrorType(){return 'unknown'},isEf77DiagnosticEnabled:()=>false},'../stores/anonymousSession':{getAnonymousRequestOptions:async()=>({})},
},{process:{env:{EXPO_PUBLIC_APP_ENV:'DEV'}}});
const envelope=(eventType,payload)=>JSON.stringify({schemaVersion:1,sequence:1,timestamp:'2026-11-15T00:00:00.000Z',eventType,payload});
for(const eventType of ['turn.completed','error'])test('strict negotiated enumeration '+eventType,()=>{
 const base=eventType==='error'?{code:'DEEP_RESPONSE_FAILED',message:'failed',recoverable:true,recoveryAction:'retry_turn'}:{status:'completed'};
 for(const stage of ['model_null','candidate_filtered','candidate_ready','reply_rejected','provider_incomplete','unavailable']){
  const wire=envelope(eventType,{...base,candidateDiagnostic:stage});assert.equal(api.parseVersionedStreamEvent(wire).kind,'rejected');const p=api.parseVersionedStreamEvent(wire,true);assert.equal(p.kind,'known');assert.equal(JSON.parse(p.serialized).payload.candidateDiagnostic,stage);
 }
 for(const value of ['SENTINEL_PRIVATE','constructor','candidate_ready ',null,{},[],2]) assert.equal(api.parseVersionedStreamEvent(envelope(eventType,{...base,candidateDiagnostic:value}),true).kind,'rejected');
 assert.equal(api.parseVersionedStreamEvent(envelope(eventType,{...base,candidateDiagnostic:'model_null',secret:'SENTINEL_PRIVATE'}),true).kind,'rejected');
 assert.equal(api.parseVersionedStreamEvent(envelope(eventType,base)).kind,'known');
});
test('diagnostic illegal on nonterminal event',()=>assert.equal(api.parseVersionedStreamEvent(envelope('deep.delta',{content:'SENTINEL_PRIVATE',candidateDiagnostic:'model_null'}),true).kind,'rejected'));
const c=await loadTsModule(new URL('../realRequestController.ts',import.meta.url),{});
const D='dev-candidate-diagnostic-v1',P='dev-reply-practice-v1';
function setup({allow,negotiate=true,wait,fail=false,throws=false}={}){
 const sent=[],observed=[];let seq=0;const controller=c.createDevRealRequestController({enabled:true,allowCandidateDiagnostics:allow,createRequestId:()=>`r${++seq}`,onCandidateDiagnostic:v=>{observed.push(JSON.parse(JSON.stringify(v)));if(throws)throw Error('observer failure')},transport:{
  start:async input=>{sent.push(input);return {sessionId:'s',devConversationId:'c',expiresAt:Date.now()+600000,remainingLifetimeMs:600000,devReplyContract:P,devRetryContract:'dev-manual-retry-v1',...(negotiate&&input.candidateDiagnostic?{devCandidateDiagnostic:D}:{})}},
  stream:async(s,callbacks,signal,expected)=>{if(wait)await wait.promise;if(fail){callbacks.onError('retry_turn','reply_rejected');return} callbacks.onDeepChunk('SENTINEL_REPLY');callbacks.onDone({contract:P,reply:'SENTINEL_REPLY',practiceCandidate:null,source:{sessionId:'s',devConversationId:'c',requestId:expected.requestId}},'model_null')},end:async()=>{},
 }});return{controller,sent,observed};
}
for(const [allow,request]of[[undefined,true],[false,true],[true,false]])test(`controller requires explicit allow=${allow} request=${request}`,async()=>{const h=setup({allow});assert.equal(await h.controller.send('SENTINEL_INPUT',request),true);assert.equal(h.sent[0].candidateDiagnostic,undefined);assert.deepEqual(h.observed,[]);h.controller.dispose()});
test('single explicit send only exposes fixed fields, next send not inherited',async()=>{const h=setup({allow:true});assert.equal(await h.controller.send('SENTINEL_INPUT',true),true);assert.deepEqual(h.observed.at(-1),{server:'model_null',transport:'no_candidate'});assert.ok(!JSON.stringify(h.observed).includes('SENTINEL'));const count=h.observed.length;await h.controller.send('next');assert.equal(h.sent[1].candidateDiagnostic,undefined);assert.equal(h.observed.length,count);h.controller.dispose()});
test('requested but not negotiated is not inferred model absence',async()=>{const h=setup({allow:true,negotiate:false});await h.controller.send('SENTINEL_INPUT',true);assert.deepEqual(h.observed.at(-1),{server:'not_negotiated',transport:'no_candidate'});h.controller.dispose()});
test('observer throws cannot fail valid response',async()=>{const h=setup({allow:true,throws:true});assert.equal(await h.controller.send('SENTINEL_INPUT',true),true);assert.equal(h.controller.getSnapshot().status,'success');h.controller.dispose()});
test('stale post-stop response cannot publish new diagnosis',async()=>{const wait=deferred(),h=setup({allow:true,wait});const promise=h.controller.send('SENTINEL_INPUT',true);for(let i=0;i<10;i++)await Promise.resolve();h.controller.stop();const count=h.observed.length;wait.resolve();await promise;assert.equal(h.observed.length,count);assert.equal(h.controller.getSnapshot().status,'stopped');h.controller.dispose()});
test('manual retry never inherits diagnostic opt-in',async()=>{const h=setup({allow:true,fail:true});assert.equal(await h.controller.send('SENTINEL_INPUT',true),false);const count=h.observed.length;await h.controller.retry();assert.equal(h.sent[1].candidateDiagnostic,undefined);assert.equal(h.observed.length,count);h.controller.dispose()});
test('expiry clears diagnostic observer and throwing cleanup cannot retain active session',async()=>{
 for(const throwCleanup of [false,true]){
  let now=100000,id=0,cleared=0;const timers=new Map();
  const RealDate=Date;class FakeDate extends RealDate { static now(){return now} }
  const mod=await loadTsModule(new URL('../realRequestController.ts',import.meta.url),{}, {Date:FakeDate,setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id},clearTimeout:id=>timers.delete(id)});
  const controller=mod.createDevRealRequestController({enabled:true,allowCandidateDiagnostics:true,createRequestId:()=> 'expiry_r',onCandidateDiagnosticExpiry:()=>{cleared++;if(throwCleanup)throw Error('cleanup')},transport:{
   start:async()=>({sessionId:'s',devConversationId:'c',expiresAt:100100,remainingLifetimeMs:100,devReplyContract:P,devRetryContract:'dev-manual-retry-v1',devCandidateDiagnostic:D}),
   stream:async(s,callbacks)=>{callbacks.onDeepChunk('reply');callbacks.onDone({contract:P,reply:'reply',practiceCandidate:null,source:{sessionId:'s',devConversationId:'c',requestId:'expiry_r'}},'model_null')},end:async()=>{},
  }});
  assert.equal(await controller.send('fictional',true),true);assert.equal(cleared,0);const expiry=[...timers.values()].find(x=>x.ms===100);assert.ok(expiry);now=100101;expiry.fn();assert.equal(cleared,1);assert.equal(controller.getSnapshot().status,'failed');assert.equal(controller.getSnapshot().canSend,false);controller.dispose();
 }
});
