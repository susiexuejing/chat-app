'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDemoRepository, STORAGE_KEY, LEGACY_STORAGE_KEY, DEMO_NUMBER, PATTERN_ID, PRACTICE_ID } = require('../../client/features/synthetic-demo/repository.js');
const legacyFixture = require('../__fixtures__/ef384-single-pattern-v1.json');
const clone = x => JSON.parse(JSON.stringify(x));
const input = {occurred:true,action:'agreed',feeling:'helped',note:'明确虚构的练习记录'};
function fixture(legacy) {
 const map=new Map();if(legacy!==undefined)map.set(LEGACY_STORAGE_KEY,typeof legacy==='string'?legacy:JSON.stringify(legacy));
 let fail=false,writes=0,hook=null;
 const storage={getItem(k){const value=map.get(k)??null;if(hook)hook(k);return value;},setItem(k,v){if(fail)throw Error('quota');writes++;map.set(k,v);}};
 const options={now:()=>1000000,random:()=>0.1};const repo=createDemoRepository(storage,options);
 return {repo,map,storage,options,fail:v=>{fail=v;},writes:()=>writes,hook:v=>{hook=v;}};
}
function login(f){return f.repo.login(f.repo.requestCode(DEMO_NUMBER));}
function account(f){return f.repo.snapshot().accountId;}
function create(f,text){const s=f.repo.createPattern(account(f),text);return s.patterns.at(-1).pattern.patternId;}
function get(f,id){return f.repo.getPattern(account(f),id);}
function call(f,id,method,...args){return f.repo[method](account(f),id,...args);}
function readyPair(){const f=fixture();login(f);const a=create(f,'虚构理解 A'),b=create(f,'虚构理解 B');return {...f,a,b};}
function legacyState(old){return {pattern:old.pattern,practice:old.practice,records:old.records,path:old.path};}
function richLegacy(){
 const old=clone(legacyFixture),at='1970-01-01T00:16:40.001Z',origin={input:'旧版虚构输入',requestId:'legacy-dev-turn'};
 old.pattern={...old.pattern,demoSource:'dev-api-test',origin,currentUnderstanding:'旧版明确修正的理解',version:2,updatedAt:at};
 old.path.push({...old.path[0],demoSource:'dev-api-test',origin,entryId:'correction-5',type:'correction',fact:'用户明确保存的理解修正。',source:'用户确认修改',oldUnderstanding:legacyFixture.pattern.currentUnderstanding,currentUnderstanding:old.pattern.currentUnderstanding,createdAt:at,version:3,linked:false,explanation:'原有说明',feeling:'原有感受'});
 old.path.push({...old.path[0],entryId:'exception-original',type:'exception',fact:'旧版明确保存的虚构例外',source:'明确确认的例外',linked:false,version:2,explanation:'保留例外说明'});
 old.revision=8;return old;
}
test('empty account and login have no phantom patterns, clues, practices, records or events',()=>{
 const f=fixture();assert.deepEqual(f.repo.snapshot().patterns,[]);assert.equal(f.writes(),0);login(f);assert.deepEqual(f.repo.snapshot().patterns,[]);
 const a=create(f,'只有用户明确输入的虚构理解');const s=get(f,a);assert.deepEqual(s.pattern.clues,[]);assert.equal(s.practice,null);assert.deepEqual(s.records,[]);assert.equal(s.path.length,1);assert.equal(s.path[0].type,'event');assert.doesNotMatch(JSON.stringify(s),/累时|儿子|自责/);
});
test('explicit create retains two independently stable IDs with fixed clock/random and does not overwrite A',()=>{
 const f=fixture();login(f);const a=create(f,'虚构 A'),before=get(f,a),b=create(f,'虚构 B');assert.notEqual(a,b);assert.notEqual(a,PATTERN_ID);assert.deepEqual(get(f,a),before);
 const fresh=createDemoRepository(f.storage,f.options);assert.deepEqual(fresh.snapshot(),f.repo.snapshot());assert.equal(fresh.getPattern(account(f),b).pattern.currentUnderstanding,'虚构 B');
});
test('pattern name/understanding/decision history updates touch only selected aggregate',()=>{
 const f=readyPair(),bBefore=get(f,f.b);call(f,f.a,'updatePattern',{name:'明确命名 A',currentUnderstanding:'修正虚构 A',decision:'confirmed'},1);
 assert.deepEqual(get(f,f.b),bBefore);assert.equal(get(f,f.a).pattern.version,2);assert.equal(get(f,f.a).path[1].oldUnderstanding,'虚构理解 A');assert.equal(get(f,f.a).path[1].currentUnderstanding,'修正虚构 A');
});
test('practice save/edit never activates B or modifies active A, with explicit non-switching activation',()=>{
 const f=readyPair();call(f,f.a,'savePractice',{ifCue:'A 的情境',thenAction:'A 的动作'},0);
 assert.equal(get(f,f.a).practice.paused,true);assert.equal(f.repo.snapshot().activePracticePatternId,null);assert.throws(()=>call(f,f.a,'saveRecord',input,1,'inactive'));
 call(f,f.a,'activatePractice',1);const aBefore=get(f,f.a);call(f,f.b,'savePractice',{ifCue:'B 的情境',thenAction:'B 的动作'},0);call(f,f.b,'savePractice',{ifCue:'B 的新情境',thenAction:'B 的新动作'},1);
 assert.deepEqual(get(f,f.a),aBefore);assert.equal(get(f,f.b).practice.paused,true);assert.equal(f.repo.snapshot().activePracticePatternId,f.a);
 const before=f.map.get(STORAGE_KEY);assert.throws(()=>call(f,f.b,'activatePractice',2),/另一条模式/);assert.equal(f.map.get(STORAGE_KEY),before);
 call(f,f.b,'pausePractice',2);assert.deepEqual(get(f,f.a),aBefore);assert.equal(f.repo.snapshot().activePracticePatternId,f.a);
 call(f,f.a,'pausePractice',2);call(f,f.b,'activatePractice',3);assert.equal(f.repo.snapshot().activePracticePatternId,f.b);assert.equal(get(f,f.a).practice.paused,true);
});
test('failed activation and stale activation preserve both patterns and active pointer',()=>{
 const f=readyPair();call(f,f.a,'savePractice',{ifCue:'A',thenAction:'A'},0);const before=f.repo.snapshot();f.fail(true);
 assert.throws(()=>call(f,f.a,'activatePractice',1),/未保存/);assert.deepEqual(f.repo.snapshot(),before);f.fail(false);
 call(f,f.a,'savePractice',{ifCue:'new A',thenAction:'new A'},1);assert.throws(()=>call(f,f.a,'activatePractice',1),/版本/);assert.equal(f.repo.snapshot().activePracticePatternId,null);
});
test('saving records/annotations/unlink and overlapping local entry IDs stay pattern-scoped',()=>{
 const f=readyPair();for(const id of [f.a,f.b])call(f,id,'savePractice',{ifCue:'虚构情境 '+id,thenAction:'虚构动作 '+id},0);
 call(f,f.a,'activatePractice',1);call(f,f.a,'saveRecord',input,2,'same-operation');call(f,f.a,'pausePractice',2);
 call(f,f.b,'activatePractice',1);call(f,f.b,'saveRecord',{...input,note:'不同的 B 记录'},2,'same-operation');
 const aBefore=get(f,f.a),bBefore=get(f,f.b);assert.equal(aBefore.records[0].recordId,bBefore.records[0].recordId);
 call(f,f.a,'updatePath',aBefore.records[0].recordId,{linked:false,explanation:'仅 A 说明',feeling:'仅 A 感受'},1);
 assert.deepEqual(get(f,f.b),bBefore);assert.deepEqual(get(f,f.a).records,aBefore.records);assert.equal(get(f,f.a).path[1].linked,false);
 assert.deepEqual(call(f,f.a,'saveRecord',input,2,'same-operation'),f.repo.snapshot());
});
test('every detail read/mutation rejects foreign account and missing pattern without changing saved bytes',()=>{
 const f=readyPair(),before=f.map.get(STORAGE_KEY),owner=account(f);
 const operations=[(a,p)=>f.repo.getPattern(a,p),(a,p)=>f.repo.updatePattern(a,p,{name:'no'},1),(a,p)=>f.repo.savePractice(a,p,{ifCue:'no',thenAction:'no'},0),(a,p)=>f.repo.pausePractice(a,p,1),(a,p)=>f.repo.activatePractice(a,p,1),(a,p)=>f.repo.saveRecord(a,p,input,1,'no'),(a,p)=>f.repo.updatePath(a,p,'evt-1',{linked:false},1),(a,p)=>f.repo.confirmDevUnderstanding(a,{text:'no',input:'no',requestId:'no',relation:'correct-current'},1,p)];
 for(const operation of operations){assert.throws(()=>operation('foreign',f.a),/无权/);assert.throws(()=>operation(owner,'absent'),/找不到/);assert.throws(()=>operation(owner,undefined),/内容无效|选择|找不到/);}
 assert.throws(()=>f.repo.createPattern('foreign','no'),/无权/);assert.equal(f.map.get(STORAGE_KEY),before);
});
test('no compatibility mutation can implicitly select or overwrite the first pattern',()=>{
 const f=readyPair(),before=f.map.get(STORAGE_KEY);assert.equal(f.repo.confirmPattern,undefined);
 assert.throws(()=>f.repo.updatePattern({name:'implicit'},1));assert.throws(()=>f.repo.savePractice({ifCue:'implicit',thenAction:'implicit'},0));
 assert.throws(()=>f.repo.confirmDevUnderstanding({text:'implicit',input:'implicit',requestId:'implicit'},0));assert.equal(f.map.get(STORAGE_KEY),before);
});
test('DEV response requires explicit create/correct relation and corrections cannot target another pattern implicitly',()=>{
 const f=readyPair(),owner=account(f),base={text:'明确 DEV 回复',input:'虚构本次输入',requestId:'explicit-dev'},before=f.repo.snapshot();
 for(const args of [[owner,base,0],[owner,{...base,relation:'create-new'},0,f.a],[owner,{...base,relation:'correct-current'},1]])assert.throws(()=>f.repo.confirmDevUnderstanding(...args));
 assert.deepEqual(f.repo.snapshot(),before);f.repo.confirmDevUnderstanding(owner,{...base,relation:'correct-current'},1,f.b);assert.deepEqual(get(f,f.a),before.patterns[0]);assert.equal(get(f,f.b).pattern.currentUnderstanding,base.text);
});
test('DEV new turn is idempotent across refresh and cannot be copied into a different pattern',()=>{
 const f=readyPair(),owner=account(f),p={text:'虚构新 DEV 理解',input:'虚构新输入',requestId:'create-dev',relation:'create-new'};
 f.repo.confirmDevUnderstanding(owner,p,0);const before=f.repo.snapshot(),writes=f.writes();assert.equal(before.patterns.length,3);f.repo.confirmDevUnderstanding(owner,p,0);assert.equal(f.writes(),writes);
 const fresh=createDemoRepository(f.storage,f.options);assert.deepEqual(fresh.confirmDevUnderstanding(owner,p,0),before);assert.throws(()=>fresh.confirmDevUnderstanding(owner,{...p,relation:'correct-current'},1,f.a),/另一条模式/);assert.deepEqual(fresh.snapshot(),before);
});
test('failed new-pattern save never creates partial B or changes A, retry adds B exactly once',()=>{
 const f=fixture();login(f);const a=create(f,'虚构 A'),before=f.repo.snapshot();f.fail(true);assert.throws(()=>create(f,'虚构 B'),/未保存/);assert.deepEqual(f.repo.snapshot(),before);f.fail(false);
 const b=create(f,'虚构 B');assert.notEqual(a,b);assert.equal(f.repo.snapshot().patterns.length,2);assert.deepEqual(get(f,a),before.patterns[0]);
});
test('logout and same-account login/refresh recover all patterns with no private checkpoint in public views',()=>{
 const f=readyPair();call(f,f.a,'savePractice',{ifCue:'A',thenAction:'A'},0);call(f,f.a,'activatePractice',1);call(f,f.a,'saveRecord',input,2,'a-record');call(f,f.b,'updatePath','evt-1',{explanation:'B 的说明'},1);
 const before=f.repo.snapshot(),owner=account(f);f.repo.logout();const out=f.repo.snapshot();assert.deepEqual(Object.keys(out).sort(),['accountId','activePracticePatternId','patterns','revision','schemaVersion','session'].sort());assert.deepEqual(out.patterns,[]);assert.equal(out.activePracticePatternId,null);assert.throws(()=>f.repo.getPattern(owner,f.a),/登录/);
 const fresh=createDemoRepository(f.storage,f.options);fresh.login(fresh.requestCode(DEMO_NUMBER));assert.deepEqual(fresh.snapshot().patterns,before.patterns);assert.equal(fresh.snapshot().activePracticePatternId,f.a);assert.equal('legacySource' in fresh.snapshot(),false);
});
test('v1 conversion is read-only, lossless, single-pattern, and preserves old active practice',()=>{
 const old=richLegacy(),raw=JSON.stringify(old,null,3),f=fixture(raw),s=f.repo.snapshot();
 assert.equal(f.writes(),0);assert.equal(f.map.get(LEGACY_STORAGE_KEY),raw);assert.equal(f.map.has(STORAGE_KEY),false);assert.equal(s.patterns.length,1);assert.deepEqual(s.patterns[0],legacyState(old));assert.equal(s.activePracticePatternId,PATTERN_ID);assert.equal(s.revision,old.revision);
 assert.equal('legacySource' in s,false);assert.deepEqual(get(f,PATTERN_ID),legacyState(old));assert.equal(f.writes(),0);
});
test('first explicit successful migration write is atomic and retains exact v1 bytes without duplicating history',()=>{
 const old=richLegacy(),raw=JSON.stringify(old,null,3),f=fixture(raw);f.repo.snapshot();const b=create(f,'新增虚构 B');
 assert.equal(f.writes(),1);assert.equal(f.map.get(LEGACY_STORAGE_KEY),raw);assert.equal(f.repo.snapshot().patterns.length,2);assert.deepEqual(get(f,PATTERN_ID),legacyState(old));assert.equal(get(f,PATTERN_ID).practice.practiceId,PRACTICE_ID);
 const fresh=createDemoRepository(f.storage,f.options);assert.equal(fresh.snapshot().patterns.length,2);assert.deepEqual(fresh.getPattern(old.accountId,PATTERN_ID),legacyState(old));assert.equal(fresh.getPattern(old.accountId,b).pattern.currentUnderstanding,'新增虚构 B');assert.equal(f.writes(),1);
});
test('failed migration write preserves original bytes and all values, retry converts once',()=>{
 const old=richLegacy(),raw=JSON.stringify(old),f=fixture(raw),before=f.repo.snapshot();f.fail(true);
 assert.throws(()=>create(f,'新虚构 B'),/未保存/);assert.equal(f.map.get(LEGACY_STORAGE_KEY),raw);assert.equal(f.map.has(STORAGE_KEY),false);assert.deepEqual(f.repo.snapshot(),before);assert.equal(f.writes(),0);
 f.fail(false);create(f,'新虚构 B');assert.equal(f.writes(),1);assert.equal(f.repo.snapshot().patterns.length,2);assert.deepEqual(get(f,PATTERN_ID),legacyState(old));
});
test('migrated logged-out data remains hidden without losing data or persisting on reads',()=>{
 const old=richLegacy();old.session=null;const f=fixture(old),out=f.repo.snapshot();assert.deepEqual(out.patterns,[]);assert.equal(out.activePracticePatternId,null);assert.equal(JSON.stringify(out).includes('旧版'),false);assert.equal(f.writes(),0);
 assert.throws(()=>f.repo.getPattern(old.accountId,PATTERN_ID),/登录/);login(f);assert.deepEqual(get(f,PATTERN_ID),legacyState(old));assert.equal(f.repo.snapshot().activePracticePatternId,PATTERN_ID);
});
test('legacy no-pattern and no-practice variants migrate without phantom examples',()=>{
 for(const old of [{...clone(legacyFixture),pattern:null,practice:null,records:[],path:[]},{...clone(legacyFixture),practice:null,records:[],path:[clone(legacyFixture.path[0])]}]){
  const f=fixture(old),s=f.repo.snapshot();assert.equal(s.patterns.length,old.pattern ? 1 : 0);assert.equal(s.activePracticePatternId,null);assert.equal(f.writes(),0);assert.equal(f.map.has(STORAGE_KEY),false);
  f.repo.logout();login(f);assert.equal(f.repo.snapshot().patterns.length,old.pattern ? 1 : 0);
 }
});
test('corrupt legacy data fails closed; no v2 write and no destruction of original',()=>{
 const bad=richLegacy();bad.records[0].patternId='foreign';
 for(const raw of ['{','null','[]',JSON.stringify(bad),JSON.stringify({...richLegacy(),revision:-1})]){
  const f=fixture(raw);assert.throws(()=>f.repo.snapshot(),/无法读取/);assert.throws(()=>f.repo.requestCode(DEMO_NUMBER),/无法读取/);assert.equal(f.map.get(LEGACY_STORAGE_KEY),raw);assert.equal(f.map.has(STORAGE_KEY),false);assert.equal(f.writes(),0);
 }
});
test('corrupt v2 never falls back to valid v1, including new instances',()=>{
 const f=fixture(legacyFixture);create(f,'虚构新 B');const raw='{';f.map.set(STORAGE_KEY,raw);const fresh=createDemoRepository(f.storage,f.options);
 assert.throws(()=>fresh.snapshot(),/无法读取/);assert.throws(()=>fresh.requestCode(DEMO_NUMBER),/无法读取/);assert.equal(f.map.get(STORAGE_KEY),raw);assert.equal(f.map.get(LEGACY_STORAGE_KEY),JSON.stringify(legacyFixture));
});
test('legacy writes after migration fail closed after reload instead of silently reconciling or losing v2',()=>{
 const f=fixture(legacyFixture);create(f,'虚构新 B');const v2=f.map.get(STORAGE_KEY),changed=clone(legacyFixture);changed.revision++;changed.pattern.name='旧页面改名';f.map.set(LEGACY_STORAGE_KEY,JSON.stringify(changed));
 assert.throws(()=>f.repo.snapshot(),/旧版或其他页面/);assert.throws(()=>createDemoRepository(f.storage,f.options).snapshot(),/旧版或其他页面/);assert.equal(f.map.get(STORAGE_KEY),v2);assert.equal(f.writes(),1);
});
test('legacy changes before first successful migration are detected once observed, and writes during commit are rejected',()=>{
 const f=fixture(legacyFixture);f.repo.snapshot();const changed=clone(legacyFixture);changed.revision++;f.map.set(LEGACY_STORAGE_KEY,JSON.stringify(changed));assert.throws(()=>f.repo.snapshot(),/旧版或其他页面/);assert.equal(f.writes(),0);
 const g=fixture(legacyFixture);g.repo.snapshot();let reads=0;g.hook(k=>{if(k===LEGACY_STORAGE_KEY && ++reads===2){g.map.set(LEGACY_STORAGE_KEY,JSON.stringify(changed));}});
 // account() reads once, authorized() reads again; the commit recheck sees the external mutation.
 assert.throws(()=>create(g,'虚构新 B'),/版本已变化/);assert.equal(g.map.has(STORAGE_KEY),false);assert.equal(g.writes(),0);
});
test('v2 changes between a mutation read and commit reject the write and preserve the intervening content',()=>{
 const f=readyPair(),owner=account(f);let reads=0,external;
 f.hook(k=>{if(k===LEGACY_STORAGE_KEY && ++reads===1){const d=JSON.parse(f.map.get(STORAGE_KEY));d.revision++;d.patterns[1].pattern.name='另一个标签页';external=JSON.stringify(d);f.map.set(STORAGE_KEY,external);}});
 assert.throws(()=>f.repo.updatePattern(owner,f.a,{name:'不能覆盖'},1),/版本已变化/);assert.equal(f.map.get(STORAGE_KEY),external);
});
test('new legacy key appearing after empty-account v2 creation and v2 removal are blocked in active instance',()=>{
 const f=readyPair();const before=f.map.get(STORAGE_KEY);f.map.set(LEGACY_STORAGE_KEY,JSON.stringify(legacyFixture));assert.throws(()=>f.repo.snapshot(),/旧版或其他页面/);assert.equal(f.map.get(STORAGE_KEY),before);
 const g=fixture(legacyFixture);create(g,'虚构新 B');g.map.delete(STORAGE_KEY);assert.throws(()=>g.repo.snapshot(),/旧版或其他页面/);assert.equal(g.map.has(STORAGE_KEY),false);
});
test('foreign pattern-owned records/path/practice/clues and multiple active practices fail closed',()=>{
 const corruptions=[d=>{d.patterns[0].pattern.accountId='foreign';},d=>{d.patterns[0].path[0].patternId=d.patterns[1].pattern.patternId;},d=>{d.patterns[0].practice.patternId=d.patterns[1].pattern.patternId;},d=>{d.patterns[1].practice.paused=false;},d=>{d.activePracticePatternId=d.patterns[1].pattern.patternId;},d=>{d.patterns.push(clone(d.patterns[0]));},d=>{d.patterns[0].records[0].patternId=d.patterns[1].pattern.patternId;}];
 for(const corrupt of corruptions){const f=readyPair();for(const id of [f.a,f.b])call(f,id,'savePractice',{ifCue:'虚构情境',thenAction:'虚构动作'},0);call(f,f.a,'activatePractice',1);call(f,f.a,'saveRecord',input,2,'fixture-record');const d=JSON.parse(f.map.get(STORAGE_KEY));corrupt(d);const raw=JSON.stringify(d);f.map.set(STORAGE_KEY,raw);assert.throws(()=>f.repo.snapshot(),/无法读取/);assert.equal(f.map.get(STORAGE_KEY),raw);}
});
test('validated factual clues read separately with their source and confirmation, never generated or edited implicitly',()=>{
 const f=readyPair(),d=JSON.parse(f.map.get(STORAGE_KEY));for(const [index,s] of d.patterns.entries())s.pattern.clues=[{schemaVersion:1,demoSource:'synthetic',accountId:d.accountId,patternId:s.pattern.patternId,clueId:'same-local-clue',kind:index ? 'exception':'situation',fact:'明确虚构的已有事实 '+index,source:'明确标注的合成夹具',userConfirmed:index===0}];f.map.set(STORAGE_KEY,JSON.stringify(d));
 const a=get(f,f.a),b=get(f,f.b),writes=f.writes();assert.notDeepEqual(a.pattern.clues,b.pattern.clues);assert.equal(f.writes(),writes);call(f,f.a,'updatePattern',{name:'A 新名称'},1);assert.deepEqual(get(f,f.a).pattern.clues,a.pattern.clues);assert.deepEqual(get(f,f.b),b);
 const detached=get(f,f.a);detached.pattern.clues[0].fact='不能写入';assert.deepEqual(get(f,f.a).pattern.clues,a.pattern.clues);
});
test('invalid or foreign factual clues fail closed instead of surfacing guessed or unscoped facts',()=>{
 const malformed=[c=>{c.source=12;},c=>{c.patternId='foreign';},c=>{c.accountId='foreign';},c=>{c.kind='diagnosis';},c=>{c.userConfirmed='yes';},c=>{c.fact='';},c=>{c.origin={input:'invalid',requestId:'bad'};}];
 for(const corrupt of malformed){const f=readyPair(),d=JSON.parse(f.map.get(STORAGE_KEY)),s=d.patterns[0],c={schemaVersion:1,demoSource:'synthetic',accountId:d.accountId,patternId:s.pattern.patternId,clueId:'clue',kind:'situation',fact:'虚构事实',source:'合成夹具',userConfirmed:true};corrupt(c);s.pattern.clues=[c];const raw=JSON.stringify(d);f.map.set(STORAGE_KEY,raw);assert.throws(()=>f.repo.snapshot(),/无法读取/);assert.equal(f.map.get(STORAGE_KEY),raw);}
});
test('boundary-length confirmed synthetic understanding saves without inventing a longer fact',()=>{
 const f=fixture();login(f);const id=create(f,'文'.repeat(2000));assert.equal(get(f,id).pattern.currentUnderstanding.length,2000);assert.throws(()=>create(f,'文'.repeat(2001)));
});

test('missing/null clue source or confirmation remains unknown instead of fabricated metadata',()=>{
 const f=readyPair(),d=JSON.parse(f.map.get(STORAGE_KEY)),s=d.patterns[0];
 const base={schemaVersion:1,demoSource:'synthetic',accountId:d.accountId,patternId:s.pattern.patternId,kind:'thought',fact:'虚构但已有的想法'};
 s.pattern.clues=[{...base,clueId:'missing'},{...base,clueId:'null',source:null,userConfirmed:null},{...base,clueId:'blank-source',source:'',userConfirmed:false}];
 f.map.set(STORAGE_KEY,JSON.stringify(d));const before=f.map.get(STORAGE_KEY),actual=get(f,f.a).pattern.clues;assert.deepEqual(actual,s.pattern.clues);assert.equal('source' in actual[0],false);assert.equal('userConfirmed' in actual[0],false);assert.equal(actual[1].source,null);assert.equal(actual[1].userConfirmed,null);assert.equal(f.map.get(STORAGE_KEY),before);
});
