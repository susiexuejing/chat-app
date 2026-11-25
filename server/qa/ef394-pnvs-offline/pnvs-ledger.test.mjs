import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createPreflight, phoneDigest } from './pnvs-preflight.mjs';
import { postgresReservation } from './pnvs-ledger.mjs';

test('budget is durable across database restart; the app cannot edit the ledger; revocation works', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ef-quiz-sms-offline-'));
  let db;
  try {
    db = new PGlite(dir);
    await db.exec(await readFile(new URL('./pnvs-ledger.sql', import.meta.url), 'utf8'));
    await db.exec(`CREATE ROLE qa_fixture; GRANT USAGE ON SCHEMA ef_quiz_sms_qa TO qa_fixture;
      GRANT EXECUTE ON FUNCTION ef_quiz_sms_qa.reserve_run_budget(text,text,text,text,bigint,bigint,smallint) TO qa_fixture;`);
    const now = Date.now();
    const phoneKey = Buffer.alloc(32, 3), phone = '+8613000000000';
    const digest = phoneDigest(phoneKey, phone);
    const plan = { enabled: true, environment: 'development', origin: 'https://dev.douhaoyu.cn',
      prefix: '/ceshi/', runId: 'dev-qa-fixture', release: 'c'.repeat(64), from: now - 1000, until: now + 300000,
      subjects: [{ digest, limit: 2 }] };
    const seed = 'INSERT INTO ef_quiz_sms_qa.run_budget(run_id,release_id,subject_digest,operation,starts_ms,ends_ms,max_calls) VALUES ($1,$2,$3,$4,$5,$6,2)';
    for (const op of ['send', 'verify']) await db.query(seed, [plan.runId, plan.release, digest, op, plan.from, plan.until]);
    const use = async () => {
      await db.exec('SET ROLE qa_fixture');
      return createPreflight({ plan, phoneKey, reserve: postgresReservation(db) });
    };
    const req = { origin: plan.origin, prefix: plan.prefix, releaseId: plan.release, phone, operation: 'send' };
    let gate = await use();
    await assert.rejects(db.exec('UPDATE ef_quiz_sms_qa.run_budget SET spent=0'), /permission denied/);
    assert.equal(await gate(req), true);
    await db.close();
    db = new PGlite(dir);
    gate = await use();
    assert.deepEqual(await Promise.all([gate(req), gate(req), gate(req)]), [true,false,false]);
    await db.exec('RESET ROLE; UPDATE ef_quiz_sms_qa.run_budget SET revoked=true');
    gate = await use();
    assert.equal(await gate({ ...req, operation: 'verify' }), false);
    await db.exec('RESET ROLE');
    const r = await db.query('SELECT operation, spent FROM ef_quiz_sms_qa.run_budget ORDER BY operation');
    assert.deepEqual(r.rows, [{ operation: 'send', spent: 2 }, { operation: 'verify', spent: 0 }]);
  } finally {
    if (db) await db.close();
    await rm(dir, {recursive: true, force: true});
  }
});
