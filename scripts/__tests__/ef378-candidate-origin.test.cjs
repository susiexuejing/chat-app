'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDemoRepository, DEMO_NUMBER, STORAGE_KEY, LEGACY_STORAGE_KEY } = require('../../client/features/synthetic-demo/repository.js');
const old = require('../__fixtures__/ef384-single-pattern-v1.json');
const origin = {kind:'ai-suggestion',sessionId:'session-candidate',devConversationId:'conversation-candidate',requestId:'request-candidate'};
function setup(legacy) {
 const values=new Map(legacy ? [[LEGACY_STORAGE_KEY,JSON.stringify(legacy)]] : []);
 const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 const repo=createDemoRepository(storage); const account=repo.login(repo.requestCode(DEMO_NUMBER)).session;
 const created=repo.confirmDevUnderstanding(account,{text:'虚构确认理解',input:'虚构旧输入',requestId:'understanding-request',relation:'create-new'},0);
 const id=created.patterns.at(-1).pattern.patternId;
 return {repo,account,id,values,storage};
}
test('candidate source remains independent of pattern origin and adds no path event',()=>{
 const {repo,account,id}=setup(),before=repo.getPattern(account,id);
 const content={ifCue:'新线索',thenAction:'新动作',candidateOrigin:{...origin}};
 repo.savePractice(account,id,content,0);content.candidateOrigin.requestId='mutated';
 const after=repo.getPattern(account,id);
 assert.deepEqual(after.pattern,before.pattern);assert.deepEqual(after.path,before.path);
 assert.deepEqual(after.practice.candidateOrigin,origin);assert.equal(after.practice.origin.requestId,'understanding-request');
 assert.equal(after.practice.paused,true);assert.equal(repo.snapshot().activePracticePatternId,null);
});
test('candidate source survives fresh repository reads and pause, but manual rewrite clears it',()=>{
 const f=setup(); f.repo.savePractice(f.account,f.id,{ifCue:'线索',thenAction:'动作',candidateOrigin:origin},0);
 const fresh=createDemoRepository(f.storage);assert.deepEqual(fresh.getPattern(f.account,f.id).practice.candidateOrigin,origin);
 fresh.pausePractice(f.account,f.id,1);assert.deepEqual(fresh.getPattern(f.account,f.id).practice.candidateOrigin,origin);
 fresh.savePractice(f.account,f.id,{ifCue:'手填线索',thenAction:'手填动作'},2);
 assert.equal(fresh.getPattern(f.account,f.id).practice.candidateOrigin,undefined);
 assert.equal(fresh.getPattern(f.account,f.id).practice.origin.requestId,'understanding-request');
});
test('invalid candidate provenance fails without writes; corrupt persisted attribution fails closed',()=>{
 const f=setup(),before=f.values.get(STORAGE_KEY);
 for(const invalid of [null,{}, {...origin,kind:'user-fact'}, {...origin,requestId:'contains space'}, {...origin,sessionId:'x'.repeat(101)}, {...origin,diagnostic:'not permitted'}]) {
  assert.throws(()=>f.repo.savePractice(f.account,f.id,{ifCue:'线索',thenAction:'动作',candidateOrigin:invalid},0));assert.equal(f.values.get(STORAGE_KEY),before);
 }
 f.repo.savePractice(f.account,f.id,{ifCue:'线索',thenAction:'动作',candidateOrigin:origin},0);
 const bad=JSON.parse(f.values.get(STORAGE_KEY));bad.patterns.at(-1).practice.candidateOrigin.requestId=null;f.values.set(STORAGE_KEY,JSON.stringify(bad));
 assert.throws(()=>f.repo.snapshot());
});
test('legacy v1 practices retain exact data with no invented candidate provenance',()=>{
 const f=setup(old); const original=f.repo.snapshot().patterns.find(x=>x.pattern.patternId===old.pattern.patternId);
 assert.deepEqual(original.practice,old.practice);assert.equal(original.practice.candidateOrigin,undefined);
 assert.equal(f.values.get(LEGACY_STORAGE_KEY),JSON.stringify(old));
 f.repo.savePractice(f.account,f.id,{ifCue:'新线索',thenAction:'新动作',candidateOrigin:origin},0);
 const fresh=createDemoRepository(f.storage);
 assert.deepEqual(fresh.getPattern(f.account,old.pattern.patternId).practice,old.practice);
});
