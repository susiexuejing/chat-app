import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPreflight, phoneDigest } from './pnvs-preflight.mjs';
import { postgresReservation } from './pnvs-ledger.mjs';
import { createChallengeFlow } from './pnvs-challenge.mjs';

const phone = '+8613000000000', code = '000000', bind = 'a'.repeat(64);
const origin = 'https://dev.douhaoyu.cn', prefix = '/ceshi/';
const releaseId = 'd'.repeat(64), runId = 'dev-quiz-fixture';
const no = { status: 'not-verified' };
async function fixture(t, override = {}) {
  const db = new PGlite();
  t.after(() => db.close());
  for (const name of ['pnvs-ledger.sql','pnvs-challenge.sql']) {
    await db.exec(await readFile(new URL(name, import.meta.url), 'utf8'));
  }
  const phoneKey = Buffer.alloc(32, 1), browserKey = Buffer.alloc(32, 2);
  const from = Date.now() - 1000, until = from + 60000, digest = phoneDigest(phoneKey, phone);
  for (const op of ['send', 'verify']) await db.query(
    'INSERT INTO ef_quiz_sms_qa.run_budget(run_id,release_id,subject_digest,operation,starts_ms,ends_ms,max_calls) VALUES ($1,$2,$3,$4,$5,$6,2)',
    [runId, releaseId, digest, op, from, until]);
  const plan = { enabled: true, environment: 'development', origin, prefix, runId,
    release: releaseId, from, until, subjects: [{ digest, limit: 2 }] };
  const provider = {
    send: async ({outId}) => { calls.send++; return {status:'accepted', outId}; },
    verify: async ({outId}) => { calls.verify++; return {status:'pass',outId}; }, ...override,
  };
  const calls = { send: 0, verify: 0 };
  const options = { db, provider, runId, releaseId, phoneKey, browserKey,
    preflight: createPreflight({ plan, phoneKey, reserve: postgresReservation(db) }) };
  return { db, flow: createChallengeFlow(options), calls, options,
    request: { origin, prefix, phone, bind, requestId: randomBytes(16).toString('hex') } };
}

test('only the matching phone, browser, release and run can claim a one-time check', async t => {
  const { db, flow, calls, options, request } = await fixture(t);
  assert.deepEqual(await flow.send({...request, prefix: '/'}), no);
  const pending = await flow.send(request);
  assert.equal(pending.status, 'pending');
  const v = {...request, challengeId: pending.challengeId, code};
  assert.deepEqual(await flow.verify({...v, origin: 'https://other.example'}), no);
  assert.deepEqual(await flow.verify({...v, bind: 'b'.repeat(64)}), no);
  assert.deepEqual(await flow.verify({...v, phone: '+8613900000000'}), no);
  assert.deepEqual(await flow.verify({...v, code: '123'}), no);
  assert.deepEqual(await createChallengeFlow({...options,runId:'different-run'}).verify(v), no);
  assert.deepEqual(await createChallengeFlow({...options,releaseId:'e'.repeat(64)}).verify(v), no);
  assert.equal(calls.verify, 0);
  const results = await Promise.all([flow.verify(v), flow.verify(v), flow.verify(v)]);
  assert.equal(results.filter(x => x.status === 'verified').length, 1);
  assert.deepEqual(await flow.verify(v), no);
  assert.deepEqual(calls, {send: 1, verify: 1});
  const persisted = (await db.query('SELECT * FROM ef_quiz_sms_qa.challenge')).rows[0];
  assert.ok(!Object.values(persisted).includes(phone));
  assert.ok(!Object.values(persisted).includes(bind));
  assert.ok(!Object.values(persisted).includes(code));
  assert.equal(persisted.state, 'verified');
});
test('wrong upstream correlation and a timeout stay unusable without retries', async t => {
  let sends = 0, checks = 0;
  const {db, flow, request} = await fixture(t, {
    send: async ({outId}) => ++sends === 1 ? {status:'accepted'} : {status:'accepted',outId},
    verify: async () => { checks++; throw new Error('ambiguous timeout'); },
  });
  assert.deepEqual(await flow.send(request), no);
  const p = await flow.send({...request,requestId:'b'.repeat(32)});
  assert.equal(p.status, 'pending');
  const v = {...request, code, challengeId:p.challengeId};
  assert.deepEqual(await flow.verify(v), no);
  assert.deepEqual(await flow.verify(v), no);
  assert.deepEqual(await flow.send({...request,requestId:'c'.repeat(32)}), no);
  assert.equal(sends, 2);
  assert.equal(checks, 1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM ef_quiz_sms_qa.challenge WHERE state='pending'")).rows[0].n, 0);
});
test('a mismatched verify OutId cannot succeed or be checked again', async t => {
  let checks = 0;
  const {flow, request} = await fixture(t, {verify: async () => { checks++; return {status:'pass',outId:'f'.repeat(32)}; }});
  const p = await flow.send(request);
  assert.equal(p.status, 'pending');
  const v = {...request, code, challengeId:p.challengeId};
  assert.deepEqual(await flow.verify(v), no);
  assert.deepEqual(await flow.verify(v), no);
  assert.equal(checks, 1);
});
test('expired challenge never reaches the fake provider', async t => {
  const {db, flow, calls, request} = await fixture(t);
  const p = await flow.send(request);
  assert.equal(p.status, 'pending');
  await db.query("UPDATE ef_quiz_sms_qa.challenge SET expires_at=clock_timestamp()-interval '1 second'");
  assert.deepEqual(await flow.verify({...request, code, challengeId:p.challengeId}), no);
  assert.equal(calls.verify, 0);
});

test('concurrent duplicate intent dispatches once; exact pending replay cannot leak to another binding', async t => {
  const {db,flow,request,calls} = await fixture(t);
  const replies = await Promise.all([flow.send(request),flow.send(request),flow.send(request)]);
  const first = replies.find(x=>x.status === 'pending');
  assert.ok(first);
  for (const pending of replies.filter(x=>x.status==='pending')) assert.deepEqual(pending,first);
  assert.deepEqual(await flow.send(request),first);
  assert.deepEqual(await flow.send({...request,bind:'f'.repeat(64)}),no);
  assert.deepEqual(await flow.send({...request,phone:'+8613900000000'}),no);
  assert.deepEqual(calls,{send:1,verify:0});
  assert.equal((await db.query("SELECT spent FROM ef_quiz_sms_qa.run_budget WHERE operation='send'")).rows[0].spent,1);
});

test('provider accept with response lost cannot dispatch a second time, even after fresh service and binding', async t => {
  const ids = [];
  const {db,flow,request,options} = await fixture(t,{send:async ({outId})=>{
    ids.push(outId); // This process records the remote accepted dispatch before its response is lost.
    throw new Error('lost response');
  }});
  assert.deepEqual(await flow.send(request),no);
  const fresh = createChallengeFlow(options);
  assert.deepEqual(await fresh.send(request),no);
  assert.deepEqual(await fresh.send({...request,bind:'f'.repeat(64)}),no);
  const rows = (await db.query('SELECT id,state FROM ef_quiz_sms_qa.challenge')).rows;
  assert.deepEqual(rows,[{id:ids[0],state:'unusable'}]);
  assert.equal(ids.length,1);
  assert.equal((await db.query("SELECT spent FROM ef_quiz_sms_qa.run_budget WHERE operation='send'")).rows[0].spent,1);
});
