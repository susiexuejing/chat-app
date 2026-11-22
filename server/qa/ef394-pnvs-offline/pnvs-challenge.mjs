import { createHmac, randomBytes } from 'node:crypto';
import { phoneDigest } from './pnvs-preflight.mjs';

const ID = /^[a-f0-9]{32}$/;
const HEX = /^[a-f0-9]{64}$/;
const COLS = 'id,run_id,release_id,subject_digest,browser_digest';
const WHERE = 'id=$1 AND run_id=$2 AND release_id=$3 AND subject_digest=$4 AND browser_digest=$5';
const TABLE = 'ef_quiz_sms_qa.challenge';
const ACTIVE = 'AND expires_at > clock_timestamp()';

// Fixed SQL state transitions. A crash after claiming an operation strands it
// instead of calling a provider twice. Raw phone, binding and OTP never go to DB.
export function createChallengeFlow({ db, preflight, provider, runId, releaseId, phoneKey, browserKey, ttlSeconds = 300, finishVerified }) {
  if (typeof db?.query !== 'function' || typeof preflight !== 'function' ||
      typeof provider?.send !== 'function' || typeof provider?.verify !== 'function' ||
      (finishVerified !== undefined && typeof finishVerified !== 'function') ||
      !/^[a-z0-9-]{8,64}$/.test(runId ?? '') || !HEX.test(releaseId ?? '') ||
      !Buffer.isBuffer(phoneKey) || phoneKey.length < 32 || !Buffer.isBuffer(browserKey) ||
      browserKey.length < 32 || phoneKey.equals(browserKey) ||
      !Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 300) throw new TypeError('invalid challenge configuration');

  const subjectKey = Buffer.from(phoneKey), bindingKey = Buffer.from(browserKey);
  const denied = () => ({ status: 'not-verified' });
  const scope = ({ id, bind, phone }) => {
    if (typeof id !== 'string' || !ID.test(id) || typeof bind !== 'string' || !HEX.test(bind)) throw new Error('invalid challenge');
    return [id, runId, releaseId, phoneDigest(subjectKey, phone),
      createHmac('sha256', bindingKey).update('ef-quiz-dev-browser\0').update(bind).digest('hex')];
  };
  const change = async (values, from, to, needsTime = true) => {
    const r = await db.query(`UPDATE ${TABLE} SET state=$7 WHERE ${WHERE} AND state=$6 ${needsTime ? ACTIVE : ''} RETURNING id`,
      [...values, from, to]);
    return r.rows?.length === 1 && r.rows[0].id === values[0];
  };
  const invalidate = async (values, from) => {
    try { await change(values, from, 'unusable', false); } catch { /* stranded state also prevents retry */ }
  };
  const validIngress = (req) => req?.origin === 'https://dev.douhaoyu.cn' && req?.prefix === '/ceshi/';
  const existing = async ([, run, release, subject, browser], requestId) => {
    const {rows:[row]} = await db.query(`SELECT id FROM ${TABLE}
      WHERE run_id=$1 AND release_id=$2 AND subject_digest=$3 AND browser_digest=$4 AND request_id=$5
        AND state='pending' ${ACTIVE}`, [run,release,subject,browser,requestId]);
    return row ? {status:'pending',challengeId:row.id} : denied();
  };
  const gate = (req, operation) => preflight({ origin: req.origin, prefix: req.prefix, releaseId, phone: req.phone, operation });

  return {
    async send(req) {
      if (!validIngress(req) || typeof req.requestId !== 'string' || !ID.test(req.requestId)) return denied();
      let values;
      try {
        const id = randomBytes(16).toString('hex');
        values = scope({ ...req, id });
        const inserted = await db.query(`INSERT INTO ${TABLE} (${COLS},expires_at,state,request_id)
          VALUES ($1,$2,$3,$4,$5,clock_timestamp()+$6::integer*interval '1 second','sending',$7)
          ON CONFLICT (run_id,release_id,request_id) DO NOTHING RETURNING id`, [...values, ttlSeconds, req.requestId]);
        if (inserted.rows?.length !== 1 || inserted.rows[0].id !== id) return await existing(values, req.requestId);
        if (await gate(req, 'send') === true) {
          const reply = await provider.send({ phone: req.phone, outId: id, ttlSeconds });
          if (reply?.status === 'accepted' && reply.outId === id &&
              await change(values, 'sending', 'pending')) return { status: 'pending', challengeId: id };
        }
      } catch { /* fail closed; no retries or upstream details */ }
      if (values) await invalidate(values, 'sending');
      return denied();
    },
    async verify(req) {
      if (!validIngress(req)) return denied();
      let values;
      let claimed = false;
      try {
        if (typeof req?.code !== 'string' || !/^\d{6}$/.test(req.code)) return denied();
        values = scope({ id: req.challengeId, bind: req.bind, phone: req.phone });
        claimed = await change(values, 'pending', 'checking');
        if (!claimed) return denied();
        if (await gate(req, 'verify') === true) {
          const reply = await provider.verify({ phone: req.phone, code: req.code, outId: values[0] });
          if (reply?.status === 'pass' && reply.outId === values[0]) {
            if (finishVerified) {
              const session = await finishVerified(values, req.phone);
              if (session) return session;
            } else if (await change(values, 'checking', 'verified')) return { status: 'verified' };
          }
        }
      } catch { /* fail closed; no retries or upstream details */ }
      if (claimed) await invalidate(values, 'checking');
      return denied();
    },
  };
}
