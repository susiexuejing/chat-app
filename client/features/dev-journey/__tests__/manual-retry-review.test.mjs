import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTsModule, deferred } from './moduleHarness.mjs';
const file = new URL('../realRequestController.ts', import.meta.url);
const USER1 = '虚构场景：图书馆约在周四，预约还没有确认。';
const USER2 = '虚构场景：我今天只是把名单抄在了纸上。';
const REPLY = '预约还没有确认，是否去图书馆还没有定下来。';
const flush = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
const plain = x => JSON.parse(JSON.stringify(x));
async function setup(options={}) {
 let now=100000, seq=0, timerid=0; const starts=[], ends=[], streams=[], timers=new Map(), states=[];
 const mod=await loadTsModule(file,{}, {
   Date:class extends Date {static now(){return now;}},
   setTimeout:(fn,ms)=>{const id=++timerid;timers.set(id,{fn,due:now+ms});return id;},clearTimeout:id=>timers.delete(id),
 });
 const c=mod.createDevRealRequestController({enabled:true,createRequestId:()=>`${now}_independent_${++seq}`,transport:{
  start:async(input,signal)=>{
   starts.push({input:plain(input),signal});
   if(options.start) return options.start(input,signal,starts.length);
   return {sessionId:`s-${starts.length}`,devConversationId:'review-conversation',expiresAt:700000,remainingLifetimeMs:700000-now,
    devReplyContract:'dev-reply-practice-v1',devRetryContract: options.legacy ? undefined : 'dev-manual-retry-v1',reactionText:'',companionText:''};
  },
  stream:async(id,callbacks,signal,expected)=>{
   streams.push({id,callbacks,signal,expected:plain(expected)});
   if(options.stream) return options.stream(id,callbacks,signal,expected,streams.length);
   callbacks.onError('retry_turn');
  },end:async(id)=>ends.push(id),
 }});
 c.subscribe(()=>states.push(plain(c.getSnapshot())));
 return {c,starts,ends,streams,timers,states,advance(ms){const target=now+ms;for(;;){const t=[...timers].filter(([,v])=>v.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!t)break;const[id,v]=t;now=v.due;timers.delete(id);v.fn();}now=target;}};
}
function succeed(id,cb,ex,text=REPLY){cb.onDeepChunk(text);cb.onDone({contract:'dev-reply-practice-v1',reply:text,practiceCandidate:null,source:{sessionId:id,devConversationId:ex.devConversationId,requestId:ex.requestId}});}

test('fresh: recoverable second-turn failure retains one user + prior pair, suppresses partial and candidate, and retries once',async t=>{
 const gate=deferred();const x=await setup({stream:async(id,cb,signal,ex,n)=>{if(n===1)succeed(id,cb,ex);else if(n===2){cb.onDeepChunk('PRIVATE_REJECTED_OUTPUT');cb.onError('retry_turn');}else{await gate.promise;succeed(id,cb,ex,'你今天只是把名单抄在了纸上。');}}});t.after(()=>x.c.dispose());
 assert.equal(await x.c.send(USER1),true);assert.equal(await x.c.send(USER2),false);
 const s=x.c.getSnapshot();assert.equal(s.status,'recoverable');assert.equal(s.error,'刚才的回复没有完成，可以重试');assert.equal(s.inputText,USER2);assert.equal(s.deepText,'');assert.equal(s.completedTurns.length,1);assert.equal(s.canRetry,true);assert.equal(x.starts.length,2);assert.equal(x.ends.length,0);
 const logical=s.logicalRequestId;const p=x.c.retry();assert.equal(await x.c.retry(),false);assert.equal(await x.c.send('另一个输入'),false);assert.equal(x.starts.length,3);assert.equal(x.starts[2].input.retryOfRequestId,x.starts[1].input.requestId);assert.equal(x.starts[2].input.message,USER2);assert.ok(!('devConversationId' in x.starts[2].input));gate.resolve();assert.equal(await p,true);assert.equal(x.c.getSnapshot().logicalRequestId,logical);assert.equal(x.c.getSnapshot().completedTurns.length,1);assert.equal(JSON.stringify(x.states).includes('PRIVATE_REJECTED_OUTPUT'),false);
});

test('fresh: terminal callback followed by rejected stream is never exposed as retryable',async t=>{
 const x=await setup({stream:async(_id,cb)=>{cb.onError('terminal');throw new Error('HTTP 403');}});t.after(()=>x.c.dispose());
 assert.equal(await x.c.send(USER1),false);assert.equal(x.c.getSnapshot().canRetry,false);assert.equal(x.c.getSnapshot().status,'failed');assert.equal(await x.c.retry(),false);assert.equal(x.starts.length,1);
});

test('fresh: pending409 keeps original server lineage, no scheduled automatic retry, next explicit retry uses original anchor',async t=>{
 const x=await setup({start:async(input,_signal,n)=>{if(n===2)throw Object.assign(new Error('pending'),{code:'dev_retry_pending'});return {sessionId:`s-${n}`,devConversationId:'review-conversation',expiresAt:700000,remainingLifetimeMs:600000,devReplyContract:'dev-reply-practice-v1',devRetryContract:'dev-manual-retry-v1',reactionText:'',companionText:''};}});t.after(()=>x.c.dispose());
 assert.equal(await x.c.send(USER1),false);assert.equal(await x.c.retry(),false);assert.equal(x.c.getSnapshot().status,'recoverable');x.advance(1000);await flush();assert.equal(x.starts.length,2);assert.equal(await x.c.retry(),false);assert.equal(x.starts[2].input.retryOfRequestId,x.starts[0].input.requestId);assert.equal(x.c.getSnapshot().inputText,USER1);assert.equal(x.ends.length,0);
});

for(const action of ['stop','reset','dispose'])test(`fresh: ${action} during manual retry revokes pending callbacks and clears local retained content`,async t=>{
 const gate=deferred();const x=await setup({stream:async(id,cb,signal,ex,n)=>{if(n===1){cb.onError('retry_turn');return;}await gate.promise;succeed(id,cb,ex);}});t.after(()=>x.c.dispose());
 await x.c.send(USER1);const p=x.c.retry();await flush();x.c[action]();assert.equal(await p,false);gate.resolve();await flush();const s=x.c.getSnapshot();assert.equal(s.inputText,'');assert.equal(s.deepText,'');assert.equal(s.completedTurns.length,0);assert.equal(s.canRetry,false);assert.ok(x.ends.length>=1);
});

test('fresh: recovered success advances continuation to successful retry ID and never duplicates current user in completed history',async t=>{
 const x=await setup({stream:async(id,cb,signal,ex,n)=>{if(n===1)cb.onError('transport');else succeed(id,cb,ex);}});t.after(()=>x.c.dispose());
 await x.c.send(USER1);assert.equal(await x.c.retry(),true);const successful=x.starts[1].input.requestId;assert.equal(await x.c.send(USER2),true);assert.equal(x.starts[2].input.afterRequestId,successful);assert.equal(x.c.getSnapshot().completedTurns.length,1);assert.equal(x.c.getSnapshot().completedTurns[0].inputText,USER1);
});

test('fresh: retry does not extend original expiry; expiration erases retained error and retry control',async t=>{
 const x=await setup();t.after(()=>x.c.dispose());await x.c.send(USER1);x.advance(599000);await x.c.retry();assert.equal(x.c.getSnapshot().status,'recoverable');x.advance(1000);assert.equal(x.c.getSnapshot().status,'failed');assert.equal(x.c.getSnapshot().inputText,'');assert.equal(x.c.getSnapshot().canRetry,false);assert.equal(await x.c.retry(),false);assert.equal(x.starts.length,2);
});

test('fresh: legacy non-negotiating failure remains terminal with no fabricated retry',async t=>{
 const x=await setup({legacy:true});t.after(()=>x.c.dispose());await x.c.send(USER1);assert.equal(x.c.getSnapshot().status,'failed');assert.equal(x.c.getSnapshot().canRetry,false);assert.equal(await x.c.retry(),false);assert.equal(x.starts.length,1);
});

test('fresh: controller timeout after negotiated receipt preserves transcript but late completion cannot publish',async t=>{
 const gate=deferred();const x=await setup({stream:async(id,cb,signal,ex)=>{await gate.promise;succeed(id,cb,ex);}});t.after(()=>x.c.dispose());const p=x.c.send(USER1);await flush();x.advance(165000);assert.equal(await p,false);assert.equal(x.c.getSnapshot().status,'recoverable');gate.resolve();await flush();assert.equal(x.c.getSnapshot().status,'recoverable');assert.equal(x.c.getSnapshot().deepText,'');assert.equal(x.starts.length,1);
});
