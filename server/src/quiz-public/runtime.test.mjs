import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {PGlite} from '../../qa/ef394-pnvs-offline/node_modules/@electric-sql/pglite/dist/index.js';
import {questions} from '../../qa/ef394-pnvs-offline/approved-quiz93.mjs';
import {phoneDigest} from '../../qa/ef394-pnvs-offline/pnvs-preflight.mjs';
import {createPublicQuizRuntime} from './runtime.mjs';
import {createAliyunPnvs} from './pnvs.mjs';

const origin='https://dev.douhaoyu.cn', prefix='/ceshi/api/auth/v1/';
const fixturePhone='+8613000000000', otherFixture='+8613900000000', neverAllowed='+8613100000000';
const hex=()=>randomBytes(16).toString('hex');
function envAt(t) {
  const derive=(label)=>createHash('sha256').update('offline-test-key-material:'+label).digest('hex');
  const plan={runId:'qa-local-run',release:derive('release'),from:t-1000,until:t+60000,subjects:[
    {digest:phoneDigest(Buffer.from(derive('PHONE'),'hex'),fixturePhone),limit:2},
    {digest:phoneDigest(Buffer.from(derive('PHONE'),'hex'),otherFixture),limit:1},
  ]};
  return {
    EF_QUIZ_ACCOUNT_MODE:'qa-live-dev',EF_QUIZ_DEV_QA_PLAN:JSON.stringify(plan),
    EF_QUIZ_CONSENT_VERSION:'dev-qa-fixture-review',
    EF_QUIZ_PHONE_HMAC:derive('PHONE'),EF_QUIZ_BROWSER_HMAC:derive('BROWSER'),
    EF_QUIZ_ACCOUNT_HMAC:derive('ACCOUNT'),EF_QUIZ_SESSION_HMAC:derive('SESSION'),
    EF_QUIZ_PNVS_STS_ID:'fixture-value-only'.replaceAll('-',''),
    EF_QUIZ_PNVS_STS_SECRET:derive('stub-config-a'),EF_QUIZ_PNVS_STS_TOKEN:derive('stub-config-b'),
    EF_QUIZ_PNVS_SCHEME:'fixture',EF_QUIZ_PNVS_SIGN:'fixture',EF_QUIZ_PNVS_TEMPLATE:'fixture',
  };
}
const req=(endpoint,body,cookie,extra={})=>({
  method:body===undefined?'GET':'POST',path:prefix+endpoint,
  headers:{host:'dev.douhaoyu.cn',origin,'sec-fetch-site':'same-origin','content-type':'application/json',cookie,...extra},
  rawBody:body===undefined?'':JSON.stringify(body),
});
const cookies=r=>r.headers['Set-Cookie'].map(item=>item.split(';')[0]).join('; ');

test('off, malformed, expired and failed DB peer proof do not load vendor',async()=>{
  const switches=[{}, {EF_QUIZ_ACCOUNT_MODE:'qa-live-dev'},envAt(Date.now()-61000)];
  for(const env of switches) {
    const r=await createPublicQuizRuntime({env,connect(){assert.fail('db needlessly opened');},providerFactory(){assert.fail('vendor loaded');}});
    assert.equal(r.enabled,false);
    assert.equal((await r.dispatch(req('result'),true)).http,404);
  }
  let closed=0;
  const r=await createPublicQuizRuntime({env:envAt(Date.now()),connect:async()=>({
    query:async()=>({rows:[{ready:false}]}),end:async()=>{closed++;},
  }),providerFactory(){assert.fail('vendor loaded');}});
  assert.equal(r.enabled,false);
  assert.equal(closed,1);
});

test('default PNVS scheme must be intentionally configured; missing and invalid values stay off',async()=>{
  const now=Date.now();
  const missing=envAt(now);
  delete missing.EF_QUIZ_PNVS_SCHEME;
  let opened=0;
  const seen=[];
  const options={now:()=>now,
    connect:async()=>{opened++;return {query:async()=>({rows:[{ready:true}]}),end:async()=>{}};},
    providerFactory:cfg=>{seen.push(cfg.scheme);return {send:async()=>null,verify:async()=>null};},
  };
  for(const env of [missing,{...missing,EF_QUIZ_PNVS_SCHEME:undefined},{...missing,EF_QUIZ_PNVS_SCHEME:' '},
    {...missing,EF_QUIZ_PNVS_SCHEME:'line\nbreak'},{...missing,EF_QUIZ_PNVS_SCHEME:'fixture\n'},{...missing,EF_QUIZ_PNVS_SCHEME:'x'.repeat(21)}]) {
    const r=await createPublicQuizRuntime({...options,env});
    assert.equal(r.enabled,false);
    assert.equal((await r.dispatch(req('result'),true)).http,404);
  }
  assert.equal(opened,0);
  assert.deepEqual(seen,[]);
  for(const scheme of ['','fixture']) {
    const r=await createPublicQuizRuntime({...options,env:{...missing,EF_QUIZ_PNVS_SCHEME:scheme}});
    assert.equal(r.enabled,true);
    await r.close();
  }
  assert.equal(opened,2);
  assert.deepEqual(seen,['','fixture']);
});

test('the staged client displays the exact approved server prompts and choice order', async()=>{
  const clientBank=JSON.parse(await readFile(new URL(
    '../../../client/screens/tests-account-offline/approved-quiz93-prompts.json',import.meta.url
  ),'utf8'));
  assert.deepEqual(clientBank,questions);
});

test('new scope, durable replay, report metadata and account ownership on local PGlite',async(t)=>{
  const db=new PGlite();
  t.after(async()=>db.close());
  const sql=await readFile(new URL('./migration.candidate.sql',import.meta.url),'utf8');
  await db.exec('CREATE ROLE ef_quiz_account_qa_runtime;');
  await db.exec(sql);
  let now=Date.now();
  const env=envAt(now);
  const plan=JSON.parse(env.EF_QUIZ_DEV_QA_PLAN);
  for(const s of plan.subjects) for(const operation of ['send','verify']) {
    await db.query('INSERT INTO ef_quiz_account_dev.run_budget (run_id,release_id,subject_digest,operation,starts_ms,ends_ms,max_calls) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [plan.runId,plan.release,s.digest,operation,plan.from,plan.until,s.limit]);
  }
  await db.exec('SET ROLE ef_quiz_account_qa_runtime;');
  await assert.rejects(db.query('UPDATE ef_quiz_account_dev.run_budget SET spent=0'),/permission denied/);
  let sent=0,checked=0,queries=0;
  const r=await createPublicQuizRuntime({env,now:()=>now,connect:async target=>{
    assert.equal(target.host,'/run/ef-quiz-postgres-dev');
    assert.equal(target.user,'ef_quiz_account_qa_runtime');
    return {query:(s,args)=>{queries++;return s.includes('current_database()')?Promise.resolve({rows:[{ready:true}]}):db.query(s,args);},end:async()=>{}};
  },providerFactory:()=>({
    send:async({outId})=>{sent++;return {status:'accepted',outId};},
    verify:async({outId})=>{checked++;return {status:'pass',outId};},
  })});
  assert.equal(r.enabled,true);
  assert.equal((await r.dispatch(req('result'),false)).http,404);
  assert.equal((await r.dispatch(req('challenge',{phone:fixturePhone,requestId:hex(),consent:true},undefined,{origin:'https://other.invalid'}),true)).http,403);
  assert.equal((await r.dispatch({...req('result'),path:'/ceshi/api/v1/quiz-account/result'},true)).http,404);
  assert.equal((await r.dispatch(req('challenge',{phone:neverAllowed,requestId:hex(),consent:true}),true)).http,422);
  for (const consent of [undefined,false,'true']) assert.deepEqual((await r.dispatch(
    req('challenge',{phone:fixturePhone,requestId:hex(),consent}),true)).body,{status:'consent-required'});
  assert.equal(queries,1);
  const login=async phone=>{
    const requestId=hex();
    const sr=await r.dispatch(req('challenge',{phone,requestId,consent:true}),true);
    assert.equal(sr.http,200);
    const bind=cookies(sr);
    assert.match(bind,/^__Secure-ef_ceshi_real_bind=/);
    assert.equal((await r.dispatch(req('challenge',{phone,requestId,consent:true},bind),true)).body.challengeId,sr.body.challengeId);
    const form={phone,challengeId:sr.body.challengeId,code:'123456',consent:true};
    assert.equal((await r.dispatch(req('verify',{...form,consent:false},bind),true)).http,400);
    const vr=await r.dispatch(req('verify',form,bind),true);
    assert.equal(vr.http,200);
    assert.deepEqual(vr.body,{status:'verified'});
    assert.equal((await r.dispatch(req('verify',form,bind),true)).http,422);
    assert(vr.headers['Set-Cookie'].every(c=>/Path=\/ceshi\/; Secure; HttpOnly; SameSite=Strict/.test(c)));
    return cookies(vr);
  };
  const a=await login(fixturePhone);
  assert.equal((await r.dispatch(req('result'),true)).http,401);
  const payload={submissionId:hex(),choices:Array.from({length:93},(_,i)=>({id:'q'+String(i+1).padStart(2,'0'),option:'A'}))};
  const save=await r.dispatch(req('result',payload,a),true);
  assert.equal(save.http,200,JSON.stringify(save.body));
  assert.equal(save.body.report.type,'ESTJ');
  const storedMeta=async()=>(await db.query(`SELECT bank_revision, first_saved_at::text,
    first_saved_at <= clock_timestamp() AS not_future
    FROM ef_quiz_account_dev.report`)).rows;
  const before=await storedMeta();
  assert.equal(before.length,1);
  const source=JSON.parse(await readFile(new URL('../../qa/ef394-pnvs-offline/approved-quiz93.json',import.meta.url),'utf8'));
  const expectedRevision=createHash('sha256').update(JSON.stringify(source.map(q=>[
    q.id,q.prompt,q.options.A,q.options.B,q.awards.A,q.awards.B,
  ]))).digest('hex');
  assert.equal(before[0].bank_revision,expectedRevision);
  assert.equal(before[0].not_future,true);
  assert.ok(Number.isFinite(Date.parse(before[0].first_saved_at)));
  assert.equal(Object.hasOwn(save.body.report,'bankRevision'),false);
  assert.equal(Object.hasOwn(save.body.report,'firstSavedAt'),false);
  assert.deepEqual(Object.keys((await db.query('SELECT * FROM ef_quiz_account_dev.report')).rows[0]).sort(),
    ['account_id','answer_digest','bank_revision','first_saved_at','id','scores','submission_id']);
  await assert.rejects(db.query("UPDATE ef_quiz_account_dev.report SET bank_revision=repeat('f',64)"),/permission denied/);
  await assert.rejects(db.query("UPDATE ef_quiz_account_dev.report SET first_saved_at=clock_timestamp()"),/permission denied/);
  await db.query('SELECT pg_sleep(0.02)');
  const read=await r.dispatch(req('result',undefined,a),true);
  assert.deepEqual(read.body.report,save.body.report);
  assert.deepEqual((await r.dispatch(req('result',payload,a),true)).body,save.body);
  assert.deepEqual(await storedMeta(),before);
  const b=await login(otherFixture);
  assert.equal((await r.dispatch(req('result',undefined,b),true)).body.report,null);
  assert.deepEqual((await r.dispatch(req('logout',{},a),true)).body,{status:'signed-out'});
  assert.equal((await r.dispatch(req('result',undefined,a),true)).http,401);
  const again=await login(fixturePhone);
  assert.deepEqual((await r.dispatch(req('result',undefined,again),true)).body.report,save.body.report);
  assert.deepEqual(await storedMeta(),before);
  for(let tries=0;tries<5;tries++)assert.equal((await r.dispatch(req('challenge',
    {phone:otherFixture,requestId:hex(),consent:true}),true)).http,422);
  assert.equal((await db.query('SELECT count(*)::integer AS n FROM ef_quiz_account_dev.challenge')).rows[0].n,3);
  assert.deepEqual([sent,checked],[3,3]);
  now=plan.until;
  assert.equal((await r.dispatch(req('result',undefined,b),true)).http,404);
  await r.close();
});

test('PNVS provider sends fixed request controls and matches correlation without vendor I/O',async()=>{
  const opts=[],reqs=[];
  class Model {constructor(obj){Object.assign(this,obj);}}
  const id='a'.repeat(32);
  let status='PASS',outId=id,exposure;
  const r=()=>({statusCode:200,body:{success:true,code:'OK',model:{outId,verifyResult:status,verifyCode:exposure}}});
  const sdk={Config:Model,RuntimeOptions:Model,RetryOptions:Model,SendSmsVerifyCodeRequest:Model,CheckSmsVerifyCodeRequest:Model,
    default:class {
      constructor(o){assert.equal(o.type,'sts');assert.equal(o.endpoint,'dypnsapi.aliyuncs.com');assert.equal(o.retryOptions.retryable,false);}
      async sendSmsVerifyCodeWithOptions(req,opt){opts.push(opt);reqs.push(req);return r();}
      async checkSmsVerifyCodeWithOptions(req,opt){opts.push(opt);reqs.push(req);return r();}
    }};
  let active=true;
  const {send,verify}=createAliyunPnvs({scheme:'fixture',active:()=>active},()=>sdk);
  assert.deepEqual(await send({phone:fixturePhone,outId:id,ttlSeconds:300}),{status:'accepted',outId:id});
  assert.equal(reqs[0].returnVerifyCode,false);
  assert.equal(reqs[0].autoRetry,0);
  assert.equal(opts[0].autoretry,false);
  assert.equal(opts[0].maxAttempts,1);
  assert.equal(reqs[0].phoneNumber,fixturePhone.slice(3));
  assert.deepEqual(await verify({phone:fixturePhone,outId:id,code:'123456'}),{status:'pass',outId:id});
  status='UNKNOWN'; assert.equal(await verify({phone:fixturePhone,outId:id,code:'123456'}),null);
  status='PASS';outId='b'.repeat(32); assert.equal(await verify({phone:fixturePhone,outId:id,code:'123456'}),null);
  outId=id;exposure='123456'; assert.equal(await send({phone:fixturePhone,outId:id,ttlSeconds:300}),null);
  active=false; assert.equal(await send({phone:fixturePhone,outId:id,ttlSeconds:300}),null);
  assert.equal(reqs.length,5);
});
