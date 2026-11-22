import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPreflight, phoneDigest } from './pnvs-preflight.mjs';
import { postgresReservation } from './pnvs-ledger.mjs';
import { createOfflineQuizAccount } from './quiz-account.mjs';
import { approvedScore, questions } from './approved-quiz93.mjs';
import { createOfflineQuizTransport } from './quiz-http-offline.mjs';

const A = '+8613000000000', B = '+8613900000000';
const browser = 'a'.repeat(64), otherBrowser = 'b'.repeat(64);
const origin = 'https://dev.douhaoyu.cn', prefix = '/ceshi/';
const releaseId = 'd'.repeat(64), runId = 'dev-quiz-fixture';
const code = '000000', submissionId = 'e'.repeat(32), answers = Array(93).fill('A');
const allA = { EI:[24,0], SN:[23,0], TF:[23,0], JP:[23,0] };

async function fixture(t, scorer) {
  const db = new PGlite();
  t.after(() => db.close());
  for (const name of ['pnvs-ledger.sql','pnvs-challenge.sql','quiz-account.sql']) {
    await db.exec(await readFile(new URL(name, import.meta.url), 'utf8'));
  }
  const phoneKey = Buffer.alloc(32, 1), browserKey = Buffer.alloc(32, 2);
  const accountKey = Buffer.alloc(32, 3), sessionKey = Buffer.alloc(32, 4);
  const from = Date.now() - 1000, until = from + 60000;
  const subjects = [{digest:phoneDigest(phoneKey,A),limit:2}, {digest:phoneDigest(phoneKey,B),limit:1}];
  for (const {digest,limit} of subjects) {
    for (const op of ['send','verify']) await db.query(
      'INSERT INTO ef_quiz_sms_qa.run_budget(run_id,release_id,subject_digest,operation,starts_ms,ends_ms,max_calls) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [runId, releaseId, digest, op, from, until,limit]);
  }
  const plan = { enabled:true, environment:'development', origin, prefix, runId, release:releaseId, from, until, subjects };
  const calls = { send:0, verify:0 };
  const provider = {
    send: async ({outId}) => {calls.send++; return {status:'accepted',outId};},
    verify: async ({outId}) => {
      calls.verify++;
      if (interrupt === 'revoke') await db.exec("UPDATE ef_quiz_sms_qa.run_budget SET revoked=true WHERE operation='verify'");
      return {status:'pass',outId};
    },
  };
  const score = answers => {
    const counts = [24,23,23,23];
    const results = {};
    let j=0;
    for (const [i,dim] of ['EI','SN','TF','JP'].entries()) {
      // Synthetic scorer only: no claim about approved per-question mapping.
      const a = answers.slice(j,j+counts[i]).filter(x => x === 'A').length;
      results[dim] = [a,counts[i]-a];
      j += counts[i];
    }
    return results;
  };
  let interrupt = null;
  const driver = { async query(sql, params) {
    if (interrupt === 'read' && sql.startsWith('SELECT s.account_id')) {
      interrupt = null; throw new Error('injected read interruption');
    }
    const result = await db.query(sql,params);
    if (interrupt === 'save-response' && sql.startsWith('WITH owner')) {
      interrupt = null; throw new Error('injected lost response after save');
    }
    return result;
  }};
  const app = createOfflineQuizAccount({ db:driver, provider, runId, releaseId, phoneKey, browserKey, accountKey, sessionKey, score: scorer ?? score,
    preflight:createPreflight({ plan, phoneKey, reserve:postgresReservation(db) }) });
  const login = async (phone, bind) => {
    const req = { origin,prefix,phone,bind };
    const sent = await app.send({...req,requestId:randomBytes(16).toString('hex')});
    assert.equal(sent.status,'pending');
    return app.verify({...req,challengeId:sent.challengeId,code,consent:true});
  };
  return {db,app,login,calls,stopNext: (mode) => { interrupt=mode; }};
}

test('save response loss, same-number return and a second account remain independent', async t => {
  const {db,app,login,calls,stopNext} = await fixture(t);
  const a = await login(A,browser);
  assert.equal(a.status,'verified');
  const same = {bind:browser,session:a.session};
  assert.deepEqual(await app.read(same),{status:'signed-in',report:null});
  assert.deepEqual(await app.read({...same,bind:otherBrowser}),{status:'login-required'});
  const submit = {...same,submissionId,answers};
  stopNext('save-response');
  assert.deepEqual(await app.save(submit),{status:'try-again'});
  const saved = await app.save(submit);
  assert.deepEqual(saved,{status:'saved',report:{id:saved.report.id,scores:allA}});
  assert.deepEqual(await app.save({...submit,answers:['B',...answers.slice(1)]}),{status:'submission-conflict'});
  assert.equal((await db.query('SELECT count(*)::int AS n FROM ef_quiz_sms_qa.report')).rows[0].n,1);
  stopNext('read');
  assert.deepEqual(await app.read(same),{status:'try-again'});
  assert.deepEqual(await app.read(same),{status:'signed-in',report:saved.report});
  assert.deepEqual(calls,{send:1,verify:1});
  assert.deepEqual(await app.logout(same),{status:'signed-out'});
  assert.deepEqual(await app.read(same),{status:'login-required'});
  assert.deepEqual(await app.save(submit),{status:'login-required'});
  const back = await login(A,otherBrowser);
  assert.equal(back.status,'verified');
  assert.notEqual(a.session,back.session);
  assert.deepEqual(await app.read({bind:otherBrowser,session:back.session}),{status:'signed-in',report:saved.report});
  const b = await login(B,otherBrowser);
  assert.equal(b.status,'verified');
  assert.deepEqual(await app.read({bind:otherBrowser,session:back.session}),{status:'login-required'});
  assert.deepEqual(await app.read({bind:otherBrowser,session:b.session}),{status:'signed-in',report:null});
  assert.deepEqual(calls,{send:3,verify:3});
  const accountRows = (await db.query('SELECT * FROM ef_quiz_sms_qa.account')).rows;
  assert.equal(accountRows.length,2);
  const sessionRow = (await db.query('SELECT * FROM ef_quiz_sms_qa.session')).rows[0];
  assert.notEqual(sessionRow.token_digest,b.session);
  assert.deepEqual(Object.keys((await db.query('SELECT * FROM ef_quiz_sms_qa.report')).rows[0]).sort(),
    ['account_id','answer_digest','id','scores','submission_id']);
});

test('session write failure rolls back account and verified transition and emits no token', async t => {
  const {db,app,calls} = await fixture(t);
  await db.exec('ALTER TABLE ef_quiz_sms_qa.session ADD CONSTRAINT force_test_failure CHECK (false)');
  const req = {origin,prefix,phone:A,bind:browser};
  const {challengeId} = await app.send({...req,requestId:randomBytes(16).toString('hex')});
  const verify = {...req,code,challengeId,consent:true};
  assert.deepEqual(await app.verify(verify),{status:'not-verified'});
  assert.deepEqual(await app.verify(verify),{status:'not-verified'});
  assert.equal(calls.verify,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM ef_quiz_sms_qa.account')).rows[0].n,0);
  assert.equal((await db.query('SELECT state FROM ef_quiz_sms_qa.challenge')).rows[0].state,'unusable');
});

test('revocation while waiting for the fake provider blocks session issuance', async t => {
  const {db,app,calls,stopNext} = await fixture(t);
  const req = {origin,prefix,phone:A,bind:browser};
  const {challengeId} = await app.send({...req,requestId:randomBytes(16).toString('hex')});
  stopNext('revoke');
  assert.deepEqual(await app.verify({...req,challengeId,code,consent:true}),{status:'not-verified'});
  assert.deepEqual(calls,{send:1,verify:1});
  assert.equal((await db.query('SELECT count(*)::int AS n FROM ef_quiz_sms_qa.session')).rows[0].n,0);
});

test('transport keeps credential cookies private and round-trips an approved scored report', async t => {
  const {app,calls,stopNext} = await fixture(t, approvedScore);
  const transport = createOfflineQuizTransport({service:app,enabled:true});
  const defaultOff = createOfflineQuizTransport({service:app});
  const path = name => '/ceshi/api/v1/quiz-account/' + name;
  const headers = {host:'dev.douhaoyu.cn',origin,'content-type':'application/json'};
  const req = (name,body,creds) => ({
    method:body===undefined?'GET':'POST',path:path(name),
    headers:{...headers,...(creds?{cookie:creds}:{})},rawBody:JSON.stringify(body),
  });
  const send = req('challenge',{phone:A,requestId:'1'.repeat(32)});
  assert.equal((await defaultOff(send,true)).http,404);
  assert.equal((await transport(send)).http,404);
  assert.equal((await transport({...send,path:path('challenge?x=1')},true)).http,404);
  assert.equal((await transport({...send,headers:{...headers,origin:'https://other.example'}},true)).http,403);
  assert.deepEqual(calls,{send:0,verify:0});
  const sent = await transport(send,true);
  assert.equal(sent.http,200);
  const header = r => r.headers['Set-Cookie'].map(v=>v.split(';')[0]).join('; ');
  const binding = header(sent);
  // Discarding the first HTTP response also loses its cookie: the same
  // intent is blocked rather than leaking a challenge into a new binding.
  assert.equal((await transport(send,true)).http,422);
  const replay = await transport(req('challenge',{phone:A,requestId:'1'.repeat(32)},binding),true);
  assert.equal(replay.http,200);
  assert.deepEqual(replay.body,sent.body);
  assert.deepEqual(calls,{send:1,verify:0});
  const check = req('verify',{phone:A,challengeId:sent.body.challengeId,code,consent:true},binding);
  const login = await transport(check,true);
  assert.equal(login.http,200);
  assert.deepEqual(login.body,{status:'verified'});
  const jar = header(login);
  for (const c of login.headers['Set-Cookie']) {
    assert.match(c,/; Path=\/ceshi\/; Secure; HttpOnly; SameSite=Strict$/);
    assert.doesNotMatch(c,/Domain=/);
  }
  assert.equal((await transport({...check,headers:{...headers,cookie:binding+'; '+binding}},true)).http,400);
  assert.equal((await transport(check,true)).http,422);
  assert.equal((await transport(req('result'),true)).http,401);
  const choices = questions.map(({id},i)=>({id,option:i%3===0||i%7===0?'B':'A'})).reverse();
  stopNext('save-response');
  const submission = req('result',{submissionId,choices},jar);
  assert.equal((await transport(submission,true)).http,503);
  const saved = await transport(submission,true);
  assert.equal(saved.http,200);
  assert.deepEqual(saved.body.report.sides.map(s=>s.scores),[[15,9],[12,11],[14,9],[12,11]]);
  stopNext('read');
  assert.equal((await transport(req('result',undefined,jar),true)).http,503);
  assert.deepEqual((await transport(req('result',undefined,jar),true)).body.report,saved.body.report);
  const logout = await transport(req('logout',{},jar),true);
  assert.equal(logout.http,200);
  assert.ok(logout.headers['Set-Cookie'].every(x=>x.includes('Max-Age=0')));
  assert.equal((await transport(req('result',undefined,jar),true)).http,401);
  assert.deepEqual(calls,{send:1,verify:1});
});

test('declined or missing assent uses no verification budget and cannot create an account', async t => {
  const {db,app,calls} = await fixture(t);
  const req={origin,prefix,phone:A,bind:browser};
  const sent=await app.send({...req,requestId:randomBytes(16).toString('hex')});
  assert.equal(sent.status,'pending');
  const verify={...req,challengeId:sent.challengeId,code};
  for(const invalid of [undefined,false,'true',1,null]) {
    assert.deepEqual(await app.verify({...verify,consent:invalid}),{status:'consent-required'});
  }
  assert.deepEqual(calls,{send:1,verify:0});
  for (const table of ['account','session','report']) {
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM ef_quiz_sms_qa.${table}`)).rows[0].n,0);
  }
  const successful=await app.verify({...verify,consent:true});
  assert.equal(successful.status,'verified');
  const existing=await db.query('SELECT id,consent_fixture,consented_at FROM ef_quiz_sms_qa.account');
  assert.equal(existing.rows.length,1);
  assert.equal(existing.rows[0].consent_fixture,'local-offline-v1');
  const again=await app.send({...req,requestId:randomBytes(16).toString('hex')});
  assert.equal(again.status,sent.status);
  assert.deepEqual(Object.keys(again).sort(),Object.keys(sent).sort());
  assert.equal((await app.verify({...verify,challengeId:again.challengeId,consent:true})).status,'verified');
  assert.deepEqual((await db.query('SELECT id,consent_fixture,consented_at FROM ef_quiz_sms_qa.account')).rows,existing.rows);
  assert.deepEqual(calls,{send:2,verify:2});
});
