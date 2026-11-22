import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreflight, phoneDigest } from './pnvs-preflight.mjs';

// Invented values used in memory only. This suite contains no provider client.
const A = '+8613000000000', B = '+8613100000000', C = '+8613200000000';
const phoneKey = Buffer.alloc(32, 9);
const subject = (phone, limit) => ({ digest: phoneDigest(phoneKey, phone), limit });
const plan = {
  enabled: true, environment: 'development', origin: 'https://dev.douhaoyu.cn',
  prefix: '/ceshi/', runId: 'dev-qa-test-1', release: 'a'.repeat(64),
  from: 1000, until: 901000, subjects: [subject(A, 2), subject(B, 1)],
};
const valid = { origin: plan.origin, prefix: plan.prefix, releaseId: plan.release, phone: A, operation: 'send' };
const mk = (reserve, now = () => 1000, p = plan) => createPreflight({ plan: p, phoneKey, reserve, now });

test('disabled, wrong host, production, and a longer window are refused at startup', () => {
  for (const p of [
    { ...plan, enabled: false }, { ...plan, environment: 'production' },
    { ...plan, origin: 'https://douhaoyu.cn' }, { ...plan, until: plan.until + 1 },
    { ...plan, subjects: [subject(A, 2), subject(A, 1)] },
    { ...plan, subjects: [subject(A, 2), subject(B, 2)] },
  ]) assert.throws(() => mk(() => true, undefined, p));
});

test('wrong release, operation, phone, host or path cannot even reserve', async () => {
  let touched = 0;
  const gate = mk(() => { touched++; return true; });
  for (const x of [
    { prefix: '/' }, { origin: 'https://douhaoyu.cn' }, { releaseId: 'b'.repeat(64) },
    { operation: 'resend' }, { phone: C }, { phone: '13000000000' },
  ]) assert.equal(await gate({ ...valid, ...x }), false);
  assert.equal(touched, 0);
});

test('ledger sees only digests, and simulated counters are shared between instances', async () => {
  const ledger = new Map();
  const reserve = ({ runId, release, operation, subjectDigest, limit }) => {
    assert.match(subjectDigest, /^[a-f0-9]{64}$/);
    assert.equal(release, plan.release);
    const k = [runId, operation, subjectDigest].join('/');
    const count = ledger.get(k) ?? 0;
    if (count >= limit) return false;
    ledger.set(k, count + 1);
    return true;
  };
  const [a, b] = [mk(reserve), mk(reserve)];
  assert.deepEqual(await Promise.all([a(valid), b(valid), a(valid)]), [true, true, false]);
  assert.equal(await b({ ...valid, operation: 'verify' }), true);
  assert.equal(await a({ ...valid, phone: B }), true);
  assert.equal(await b({ ...valid, phone: B }), false);
});

test('before window and at expiry deny; expiry during reservation stays spent', async () => {
  let calls = 0, t = plan.from - 1;
  const gate = mk(() => { calls++; t = plan.until; return true; }, () => t);
  assert.equal(await gate(valid), false);
  t = plan.from;
  assert.equal(await gate(valid), false);
  assert.equal(await gate(valid), false);
  assert.equal(calls, 1);
});

test('ambiguous or thrown reservation denies without retry', async () => {
  let errors = 0;
  assert.equal(await mk(() => 'true')(valid), false);
  assert.equal(await mk(async () => { errors++; throw new Error('DB timeout'); })(valid), false);
  assert.equal(errors, 1);
});
