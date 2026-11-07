'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDemoRepository, STORAGE_KEY, DEMO_NUMBER, CANDIDATE, PRACTICE_TEXT } = require('../../client/features/synthetic-demo/repository.js');
function fixture() {
  const map = new Map(); let fails = false, writes = 0, clock = 1000000;
  const storage = { getItem:k=>map.get(k) ?? null, setItem(k,v) { if (fails) throw Error('quota'); writes++; map.set(k,v); } };
  const options = {now:()=>clock, random:()=>0.123456};
  const repo = createDemoRepository(storage,options);
  return {repo,storage,options,map,fail:v=>{fails=v;},advance:n=>{clock+=n;},writes:()=>writes};
}
function login(f) { f.repo.login(f.repo.requestCode(DEMO_NUMBER)); }
function ready(f) { login(f); f.repo.confirmPattern(CANDIDATE); f.repo.savePractice({ifCue:'听到自责时',thenAction:PRACTICE_TEXT},0); }
const payload = {occurred:true,action:'other',feeling:'not_recorded',note:'合成记录'};
test('request, preview, skip and detached snapshot never save domain drafts',()=>{
 const f=fixture(); assert.equal(f.repo.snapshot().pattern,null); const code=f.repo.requestCode(DEMO_NUMBER); assert.equal(f.writes(),0);
 f.repo.login(code); const before=f.map.get(STORAGE_KEY); const snap=f.repo.snapshot(); snap.records.push({});
 assert.equal(f.repo.snapshot().records.length,0); assert.equal(f.repo.snapshot().pattern,null); assert.equal(f.map.get(STORAGE_KEY),before);
});
test('only fixed synthetic number; wrong, expired and reused codes rejected',()=>{
 const f=fixture(); assert.throws(()=>f.repo.requestCode('13800000000')); const code=f.repo.requestCode(DEMO_NUMBER);
 assert.throws(()=>f.repo.login('bad')); assert.equal(f.writes(),0); f.advance(300000); assert.throws(()=>f.repo.login(code),/过期/);
 const next=f.repo.requestCode(DEMO_NUMBER); assert.notEqual(next,code); f.repo.login(next); assert.throws(()=>f.repo.login(next),/失效/);
});
test('five incorrect attempts exhaust challenge and refresh drops it',()=>{
 const f=fixture(); const c=f.repo.requestCode(DEMO_NUMBER); for(let i=0;i<5;i++)assert.throws(()=>f.repo.login('bad')); assert.throws(()=>f.repo.login(c),/失效/);
 const next=f.repo.requestCode(DEMO_NUMBER); assert.throws(()=>createDemoRepository(f.storage,f.options).login(next),/失效/);
});
test('login storage failure retains usable challenge and no session',()=>{
 const f=fixture();const code=f.repo.requestCode(DEMO_NUMBER); f.fail(true);assert.throws(()=>f.repo.login(code),/未保存/);assert.equal(f.repo.snapshot().session,null);
 f.fail(false);assert.ok(f.repo.login(code).session);
});
test('one same-browser account survives logout/login and data is hidden logged out',()=>{
 const f=fixture();ready(f);const before=f.repo.snapshot(); const out=f.repo.logout();assert.equal(out.session,null);assert.equal(out.pattern,null);assert.equal(out.practice,null);assert.deepEqual(out.path,[]);
 assert.throws(()=>f.repo.confirmPattern('x')); login(f);assert.equal(f.repo.snapshot().accountId,before.accountId);assert.deepEqual(f.repo.snapshot().pattern,before.pattern);
});
test('failed logout leaves session and saved state intact',()=>{
 const f=fixture();ready(f);const before=f.repo.snapshot();f.fail(true);assert.throws(()=>f.repo.logout());assert.deepEqual(f.repo.snapshot(),before);
});
test('explicit confirmation creates exactly one fixed pattern and event',()=>{
 const f=fixture();login(f);f.repo.confirmPattern(CANDIDATE);const s=f.repo.snapshot();assert.equal(s.pattern.decision,'confirmed');assert.equal(s.path.length,1);assert.equal(s.path[0].type,'event');
 f.repo.confirmPattern(CANDIDATE);assert.equal(f.repo.snapshot().path.length,1);
});
test('understanding and correction history are one atomic write',()=>{
 const f=fixture();ready(f);const before=f.repo.snapshot(), count=f.writes();f.fail(true);
 assert.throws(()=>f.repo.updatePattern({currentUnderstanding:'修正理解'},1));assert.deepEqual(f.repo.snapshot(),before);
 f.fail(false);const next=f.repo.updatePattern({currentUnderstanding:'修正理解'},1);assert.equal(f.writes(),count+1);assert.equal(next.pattern.version,2);assert.equal(next.path[1].oldUnderstanding,CANDIDATE);assert.equal(next.path[1].currentUnderstanding,'修正理解');
});
test('later chat confirmation also writes correction atomically',()=>{
 const f=fixture();ready(f);f.repo.confirmPattern('重新确认');assert.equal(f.repo.snapshot().path[1].type,'correction');assert.equal(f.repo.snapshot().pattern.version,2);
});
test('invalid pattern patches, exception creation, and version conflicts write nothing',()=>{
 const f=fixture();ready(f);const before=f.map.get(STORAGE_KEY);
 for(const patch of [{name:''},{name:'x'.repeat(81)},{decision:'fake'},{clues:[{kind:'exception'}]},{version:9},{__proto__:null,name:'x'}])assert.throws(()=>f.repo.updatePattern(patch,1));
 assert.throws(()=>f.repo.updatePattern({name:'new'},0),/版本/);assert.equal(f.map.get(STORAGE_KEY),before);
});
test('stale second repository reads current versions before writing',()=>{
 const f=fixture();ready(f);const other=createDemoRepository(f.storage,f.options);const old=other.snapshot();f.repo.updatePattern({name:'最新'},1);
 assert.throws(()=>other.updatePattern({name:'过期'},old.pattern.version),/版本/);assert.equal(other.snapshot().pattern.name,'最新');
});
test('practice save requires confirmed pattern and valid complete trigger/action',()=>{
 const f=fixture();login(f);assert.throws(()=>f.repo.savePractice({ifCue:'x',thenAction:'y'},0));f.repo.confirmPattern(CANDIDATE);
 assert.throws(()=>f.repo.savePractice({ifCue:'',thenAction:'y'},0));assert.throws(()=>f.repo.savePractice({ifCue:'x',thenAction:'y'.repeat(201)},0));
 f.repo.updatePattern({decision:'uncertain'},1);assert.throws(()=>f.repo.savePractice({ifCue:'x',thenAction:'y'},0));
});
test('practice save and pause have version checks and failed writes preserve snapshot',()=>{
 const f=fixture();ready(f);const before=f.repo.snapshot();f.fail(true);assert.throws(()=>f.repo.savePractice({ifCue:'new',thenAction:'new'},1));assert.throws(()=>f.repo.pausePractice(1));assert.deepEqual(f.repo.snapshot(),before);f.fail(false);
 f.repo.savePractice({ifCue:'new',thenAction:'new'},1);assert.throws(()=>f.repo.pausePractice(1),/版本/);f.repo.pausePractice(2);assert.throws(()=>f.repo.saveRecord(payload,3,'paused'));assert.equal(f.repo.snapshot().records.length,0);
});
for(const [name,p] of Object.entries({notOccurred:{occurred:false,action:null,feeling:null},none:{occurred:true,action:'none',feeling:null},agreed:{occurred:true,action:'agreed',feeling:'helped'},other:payload,worse:{occurred:true,action:'other',feeling:'worse'}}))test('record branch '+name+' saves facts and path atomically',()=>{
 const f=fixture();ready(f);const n=f.writes();const s=f.repo.saveRecord(p,1,'op');assert.equal(f.writes(),n+1);assert.equal(s.records.length,1);assert.equal(s.path.length,2);assert.equal(s.path[1].recordId,s.records[0].recordId);assert.equal(s.records[0].feeling,p.feeling);
});
test('inconsistent branch data and stale practice version are rejected without writes',()=>{
 const f=fixture();ready(f);const before=f.map.get(STORAGE_KEY);
 for(const p of [{occurred:false,action:'other',feeling:'helped'},{occurred:true,action:null,feeling:null},{occurred:true,action:'other',feeling:null},{occurred:true,action:'none',feeling:'helped'},{...payload,note:'x'.repeat(201)}])assert.throws(()=>f.repo.saveRecord(p,1,'op'));
 assert.throws(()=>f.repo.saveRecord(payload,0,'op'),/版本/);assert.equal(f.map.get(STORAGE_KEY),before);
});
test('record retry is idempotent; reused operation with different content rejected',()=>{
 const f=fixture();ready(f);const s=f.repo.saveRecord(payload,1,'op'), n=f.writes();assert.deepEqual(f.repo.saveRecord(payload,1,'op'),s);assert.equal(f.writes(),n);
 assert.throws(()=>f.repo.saveRecord({...payload,note:'different'},1,'op'));assert.equal(f.repo.snapshot().records.length,1);
});
test('failed record+path save leaves both absent and retry adds each once',()=>{
 const f=fixture();ready(f);const before=f.repo.snapshot();f.fail(true);assert.throws(()=>f.repo.saveRecord(payload,1,'retry'));assert.deepEqual(f.repo.snapshot(),before);f.fail(false);
 f.repo.saveRecord(payload,1,'retry');f.repo.saveRecord(payload,1,'retry');assert.equal(f.repo.snapshot().records.length,1);assert.equal(f.repo.snapshot().path.length,2);
});
test('path annotations and unlink do not rewrite record facts; failure and conflict safe',()=>{
 const f=fixture();ready(f);const s=f.repo.saveRecord(payload,1,'op'), row=s.path[1];f.fail(true);assert.throws(()=>f.repo.updatePath(row.entryId,{linked:false},1));assert.deepEqual(f.repo.snapshot(),s);f.fail(false);
 f.repo.updatePath(row.entryId,{linked:false,explanation:'新的理解',feeling:'新的感受'},1);assert.deepEqual(f.repo.snapshot().records,s.records);assert.equal(f.repo.snapshot().path[1].linked,false);
 assert.throws(()=>f.repo.updatePath(row.entryId,{linked:true},1),/版本/);assert.throws(()=>f.repo.updatePath(row.entryId,{fact:'rewrite'},2));
});
test('refresh restores saved data only and namespace isolates preexisting app/demo keys',()=>{
 const f=fixture();f.map.set('emotionflow.ef377.integrated.v1','untouched');f.map.set('auth_token','production sentinel');ready(f);f.repo.saveRecord(payload,1,'op');
 const fresh=createDemoRepository(f.storage,f.options);assert.deepEqual(fresh.snapshot(),f.repo.snapshot());assert.equal(f.map.get('auth_token'),'production sentinel');assert.equal(f.map.get('emotionflow.ef377.integrated.v1'),'untouched');assert.equal(f.map.size,3);
});
test('corrupt persisted structures fail closed without overwrite',()=>{
 for(const raw of ['{','null','[]',JSON.stringify({...fixture().repo.snapshot(),revision:-1}),JSON.stringify({...fixture().repo.snapshot(),accountId:'foreign',session:'foreign'})]) {
  const f=fixture();f.map.set(STORAGE_KEY,raw);assert.throws(()=>f.repo.snapshot(),/无法读取/);assert.throws(()=>f.repo.requestCode(DEMO_NUMBER));assert.equal(f.map.get(STORAGE_KEY),raw);
 }
 const f=fixture();ready(f);f.repo.saveRecord(payload,1,'op');const d=JSON.parse(f.map.get(STORAGE_KEY));d.path.pop();f.map.set(STORAGE_KEY,JSON.stringify(d));assert.throws(()=>f.repo.snapshot(),/无法读取/);
});
test('foreign owner and duplicate path entries fail closed',()=>{
 for(const corrupt of [d=>{d.pattern.accountId='foreign';},d=>{d.path.push(d.path[0]);},d=>{d.practice.version=0;},d=>{d.path[0].type='unknown';}]) {
 const f=fixture();ready(f);const d=JSON.parse(f.map.get(STORAGE_KEY));corrupt(d);f.map.set(STORAGE_KEY,JSON.stringify(d));assert.throws(()=>f.repo.snapshot());assert.equal(f.writes(),3);
 }
});

test('invalid code request cancels an earlier challenge without storage writes',()=>{
 const f=fixture();const code=f.repo.requestCode(DEMO_NUMBER);
 assert.throws(()=>f.repo.requestCode('not-the-demo-number'));
 assert.throws(()=>f.repo.login(code),/失效/);assert.equal(f.writes(),0);
});
test('cancelCode invalidates pending challenge and never writes or changes saved state',()=>{
 const f=fixture();ready(f);const before=f.repo.snapshot(),count=f.writes();const code=f.repo.requestCode(DEMO_NUMBER);
 f.repo.cancelCode();f.repo.cancelCode();assert.throws(()=>f.repo.login(code),/失效/);
 assert.equal(f.writes(),count);assert.deepEqual(f.repo.snapshot(),before);
 const next=f.repo.requestCode(DEMO_NUMBER);assert.ok(f.repo.login(next).session);
});
test('correctly scoped explicit synthetic exception can be read and annotated, never auto-created',()=>{
 const f=fixture();ready(f);const d=JSON.parse(f.map.get(STORAGE_KEY));assert.equal(d.path.some(e=>e.type==='exception'),false);
 const exception={...d.path[0],entryId:'synthetic-exception-fixture',type:'exception',fact:'合成例外：这一次没有先责备自己。',source:'用户明确确认的合成例外'};
 d.path.push(exception);f.map.set(STORAGE_KEY,JSON.stringify(d));const count=f.writes();
 assert.deepEqual(f.repo.snapshot().path[1],exception);assert.equal(f.writes(),count);
 f.repo.updatePath(exception.entryId,{explanation:'用户补充的理解'},1);assert.equal(f.repo.snapshot().path[1].type,'exception');
 assert.equal(f.repo.snapshot().path[1].fact,exception.fact);
});
test('exception fixtures with foreign ownership or missing synthetic confirmation fail closed',()=>{
 for(const corrupt of [e=>{e.accountId='foreign';},e=>{e.patternId='foreign';},e=>{e.demoSource='real';},e=>{e.userConfirmed=false;}]){
  const f=fixture();ready(f);const d=JSON.parse(f.map.get(STORAGE_KEY));const e={...d.path[0],entryId:'exception-fixture',type:'exception'};corrupt(e);d.path.push(e);
  const raw=JSON.stringify(d);f.map.set(STORAGE_KEY,raw);assert.throws(()=>f.repo.snapshot(),/无法读取/);assert.equal(f.map.get(STORAGE_KEY),raw);
 }
});
