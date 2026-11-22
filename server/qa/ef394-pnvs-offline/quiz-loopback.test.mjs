import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeLoopback} from './quiz-loopback.mjs';
import {questions} from './approved-quiz93.mjs';

test('loopback serves only /ceshi and the bounded synthetic API, with no automatic calls',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'ef395-loopback-'));
  let app;
  t.after(async()=>{try{if(app)await app.close();}finally{await rm(dir,{recursive:true,force:true});}});
  await writeFile(join(dir,'index.html'),'<!doctype html><title>test fixture</title>');
  app=await makeLoopback(dir);
  const root=new URL(app.url).origin;
  assert.equal((await fetch(root)).status,404);
  assert.match(await (await fetch(app.url)).text(),/test fixture/);
  const result=await fetch(app.url+'api/v1/quiz-account/result');
  assert.equal(result.status,401);
  assert.equal(result.headers.get('cache-control'),'no-store');
  const intended={method:'POST',headers:{'Content-Type':'application/json',Origin:root},body:JSON.stringify({phone:'+8613000000000',requestId:'e'.repeat(32)})};
  const challenge=app.url+'api/v1/quiz-account/challenge';
  assert.equal((await fetch(challenge,{...intended,headers:{...intended.headers,Origin:'https://elsewhere.example'}})).status,403);
  assert.deepEqual(app.counts(),{send:0,verify:0});
  const sent=await fetch(challenge,intended);
  assert.equal(sent.status,200);
  assert.match(sent.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Strict/);
  assert.equal((await fetch(challenge,intended)).status,422);
  assert.deepEqual(app.counts(),{send:1,verify:0});

  const getCookie=r=>r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const post=(route,body,cookie)=>fetch(app.url+'api/v1/quiz-account/'+route,{
    method:'POST',headers:{'Content-Type':'application/json',Origin:root,cookie},body:JSON.stringify(body),
  });
  const phone='+8613000000000';
  const {challengeId}=await sent.json();
  const declined=await post('verify',{phone,code:'000000',challengeId,consent:false},getCookie(sent));
  assert.equal(declined.status,400);
  assert.deepEqual(await declined.json(),{status:'consent-required'});
  assert.equal(declined.headers.getSetCookie().length,0);
  assert.deepEqual(app.counts(),{send:1,verify:0});
  const verified=await post('verify',{phone,code:'000000',challengeId,consent:true},getCookie(sent));
  assert.equal(verified.status,200);
  assert.deepEqual(await verified.json(),{status:'verified'});
  const both=getCookie(verified);
  const choices=questions.map(({id})=>({id,option:'A'}));
  const saved=await post('result',{submissionId:'1'.repeat(32),choices},both);
  assert.equal(saved.status,200);
  const report=(await saved.json()).report;
  assert.equal(report.type,'ESTJ');
  const retake=await post('result',{submissionId:'2'.repeat(32),choices:choices.slice(1)},both);
  assert.equal(retake.status,400);
  const read=()=>fetch(app.url+'api/v1/quiz-account/result',{headers:{cookie:both}});
  assert.deepEqual((await (await read()).json()).report,report);
  assert.equal((await post('logout',{},both)).status,200);
  assert.equal((await read()).status,401);
  assert.deepEqual(app.counts(),{send:1,verify:1});
});
