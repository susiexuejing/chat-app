import { createHmac, timingSafeEqual } from 'node:crypto';

// Offline-rehearsal seam. The actual runtime must pass a durable atomic
// reserve implementation scoped to the verified DEV database and run ID.
const DEV_ORIGIN = 'https://dev.douhaoyu.cn';
const DEV_PREFIX = '/ceshi/';
const MAX_WINDOW_MS = 15 * 60 * 1000;
const DIGEST = /^[a-f0-9]{64}$/;

export function phoneDigest(secret, phone) {
  if (!Buffer.isBuffer(secret) || secret.length < 32 || typeof phone !== 'string' || !/^\+861[3-9]\d{9}$/.test(phone)) {
    throw new Error('invalid test phone configuration');
  }
  return createHmac('sha256', secret).update('ef-quiz-dev-phone\0').update(phone).digest('hex');
}

export function createPreflight({ plan, phoneKey, reserve, now = Date.now }) {
  if (!plan || plan.enabled !== true || plan.environment !== 'development' ||
      plan.origin !== DEV_ORIGIN || plan.prefix !== DEV_PREFIX ||
      typeof plan.runId !== 'string' || !/^[a-z0-9-]{8,64}$/.test(plan.runId) ||
      typeof plan.release !== 'string' || !DIGEST.test(plan.release) || !Number.isSafeInteger(plan.from) ||
      !Number.isSafeInteger(plan.until) || plan.until <= plan.from ||
      plan.until - plan.from > MAX_WINDOW_MS || typeof reserve !== 'function' ||
      !Buffer.isBuffer(phoneKey) || phoneKey.length < 32 ||
      !Array.isArray(plan.subjects) || plan.subjects.length < 1 || plan.subjects.length > 2) {
    throw new Error('invalid DEV QA plan');
  }
  const { from, until, runId, release } = plan;
  const subjects = plan.subjects.map(({ digest, limit }) => {
    if (typeof digest !== 'string' || !DIGEST.test(digest) || ![1, 2].includes(limit)) {
      throw new Error('invalid DEV QA subject');
    }
    return { digest: Buffer.from(digest, 'hex'), limit };
  });
  if (subjects.length === 2 && (subjects[0].digest.equals(subjects[1].digest) ||
      subjects[0].limit + subjects[1].limit > 3)) throw new Error('invalid total DEV QA budget');
  const key = Buffer.from(phoneKey);
  const active = () => {
    const t = now();
    return Number.isSafeInteger(t) && t >= from && t < until;
  };

  return async function preflight({ origin, prefix, releaseId, phone, operation }) {
    if (!active() || origin !== DEV_ORIGIN || prefix !== DEV_PREFIX || releaseId !== release ||
        !['send', 'verify'].includes(operation)) return false;
    let digest;
    try {
      digest = Buffer.from(phoneDigest(key, phone), 'hex');
    } catch {
      return false;
    }
    const subject = subjects.find((s) => timingSafeEqual(s.digest, digest));
    if (!subject) return false;
    try {
      // Only a positive explicit DB result permits one invocation. A spent
      // reservation is never refunded, including expiry or ambiguous failure.
      const reserved = await reserve({
        runId, release, from, until, operation, subjectDigest: digest.toString('hex'), limit: subject.limit,
      });
      return reserved === true && active();
    } catch {
      return false;
    }
  };
}
