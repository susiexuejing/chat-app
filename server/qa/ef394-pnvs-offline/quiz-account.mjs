import { createHmac, randomBytes } from 'node:crypto';
import { createChallengeFlow } from './pnvs-challenge.mjs';

const HEX = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{32}$/;
const DIMENSIONS = ['EI', 'SN', 'TF', 'JP'];
const COUNTS = [24, 23, 23, 23];
const schemas = Object.freeze({offline:'ef_quiz_sms_qa',devAccount:'ef_quiz_account_dev'});
const ACTIVE = 'browser_digest=$1 AND token_digest=$2 AND expires_at > clock_timestamp()';
const digest = (key, domain, value) => createHmac('sha256', key).update(domain + '\0').update(value).digest('hex');
const report = (row) => ({ id: String(row.id), scores: row.scores });

// One SQL statement: failing to insert the session rolls back challenge and
// account changes. The token is generated server-side and never stored raw.
function queries(NS, versioned) {
  const OPEN = `WITH checked AS (
  UPDATE ${NS}.challenge SET state='verified'
  WHERE id=$1 AND run_id=$2 AND release_id=$3 AND subject_digest=$4 AND browser_digest=$5
    AND state='checking' AND expires_at > clock_timestamp()
    AND ${NS}.verified_run_active($2,$3,$4)
  RETURNING subject_digest,browser_digest
), identified AS (
  INSERT INTO ${NS}.account AS existing(subject_digest,consent_fixture) SELECT $8,$9 FROM checked
  ON CONFLICT (subject_digest) DO UPDATE SET subject_digest=EXCLUDED.subject_digest
  RETURNING id
)
INSERT INTO ${NS}.session(browser_digest,token_digest,account_id,expires_at)
SELECT checked.browser_digest,$6,identified.id,clock_timestamp()+$7::integer*interval '1 second'
FROM checked CROSS JOIN identified
ON CONFLICT (browser_digest) DO UPDATE SET token_digest=EXCLUDED.token_digest,
  account_id=EXCLUDED.account_id,expires_at=EXCLUDED.expires_at
RETURNING account_id`;

  const SAVE = `WITH owner AS (
  SELECT account_id FROM ${NS}.session WHERE ${ACTIVE} FOR UPDATE
), saved AS (
  INSERT INTO ${NS}.report AS saved(account_id,submission_id,answer_digest,scores${versioned ? ",bank_revision" : ""})
  SELECT account_id,$3,$4,$5::jsonb${versioned ? ",$6" : ""} FROM owner
  ON CONFLICT (account_id,submission_id) DO UPDATE SET submission_id=EXCLUDED.submission_id
  WHERE saved.answer_digest=EXCLUDED.answer_digest${versioned ? " AND saved.bank_revision=EXCLUDED.bank_revision" : ""}
  RETURNING id,scores
)
SELECT EXISTS (SELECT 1 FROM owner) AS authorized, (SELECT id FROM saved) AS id, (SELECT scores FROM saved) AS scores`;

  const READ = `SELECT s.account_id,r.id,r.scores FROM ${NS}.session s
LEFT JOIN LATERAL (
  SELECT id,scores FROM ${NS}.report WHERE account_id=s.account_id ORDER BY id DESC LIMIT 1
) r ON true
WHERE ${ACTIVE}`;

  return {OPEN,SAVE,READ};
}

export function createOfflineQuizAccount({ sessionKey, accountKey, score, sessionTtlSeconds = 3600,
  storage = 'offline', bankRevision, consentVersion = 'local-offline-v1', ...challenge }) {
  const NS = Object.hasOwn(schemas,storage) ? schemas[storage] : null;
  if (!NS || (storage === 'offline' ? consentVersion !== 'local-offline-v1'
    : !/^dev-qa-[a-z0-9-]{3,50}$/.test(consentVersion))) throw new TypeError('invalid account storage');
  const versioned = storage === 'devAccount';
  if (versioned && (typeof bankRevision !== 'string' || !HEX.test(bankRevision))) {
    throw new TypeError('invalid question bank revision');
  }
  const {OPEN,SAVE,READ} = queries(NS, versioned);
  if (!Buffer.isBuffer(sessionKey) || sessionKey.length < 32 ||
      !Buffer.isBuffer(accountKey) || accountKey.length < 32 || accountKey.equals(sessionKey) ||
      [challenge.phoneKey, challenge.browserKey].some(key => Buffer.isBuffer(key) && (key.equals(sessionKey) || key.equals(accountKey))) ||
      typeof score !== 'function' || !Number.isInteger(sessionTtlSeconds) ||
      sessionTtlSeconds < 1 || sessionTtlSeconds > 3600) throw new TypeError('invalid account configuration');
  const key = Buffer.from(sessionKey), identityKey = Buffer.from(accountKey), bindKey = Buffer.from(challenge.browserKey);
  const db = challenge.db;
  const flow = createChallengeFlow({ ...challenge, storage, finishVerified: async (values, phone) => {
    const session = randomBytes(32).toString('hex');
    const r = await db.query(OPEN, [...values, digest(key, 'ef-quiz-session', session), sessionTtlSeconds,
      digest(identityKey, 'ef-quiz-account', phone), consentVersion]);
    return r.rows?.length === 1 ? { status: 'verified', session } : null;
  }});
  const credentials = ({bind, session} = {}) =>
    typeof bind === 'string' && HEX.test(bind) && typeof session === 'string' && HEX.test(session)
      ? [digest(bindKey, 'ef-quiz-dev-browser', bind), digest(key, 'ef-quiz-session', session)] : null;
  const anonymous = { status: 'login-required' };
  const unavailable = { status: 'try-again' };
  return {
    send:flow.send,
    async verify(req) {
      if (req?.consent !== true) return { status:'consent-required' };
      return flow.verify(req);
    },
    async save(req) {
      const args = credentials(req);
      if (!args) return anonymous;
      const { submissionId, answers } = req;
      if (typeof submissionId !== 'string' || !ID.test(submissionId) || !Array.isArray(answers) ||
          answers.length !== 93 || [...answers].some(a => a !== 'A' && a !== 'B')) return {status:'invalid-submission'};
      const canonical = [...answers];
      try {
        const scored = score(Object.freeze(canonical));
        const scores = Object.fromEntries(DIMENSIONS.map((dimension, i) => {
          const pair = scored?.[dimension];
          if (!Array.isArray(pair) || pair.length !== 2 || [...pair].some(n => !Number.isInteger(n) || n < 0) ||
              pair[0] + pair[1] !== COUNTS[i]) throw new Error('invalid score');
          return [dimension, [pair[0], pair[1]]];
        }));
        const fingerprint = digest(key, 'ef-quiz-result-v1', submissionId + ':' + canonical.join(''));
        const saveArgs = [...args, submissionId, fingerprint, JSON.stringify(scores)];
        if (versioned) saveArgs.push(bankRevision);
        const { rows: [row] } = await db.query(SAVE, saveArgs);
        if (!row.authorized) return anonymous;
        return row.id == null ? {status: 'submission-conflict'} : {status:'saved', report:report(row)};
      } catch { return unavailable; }
    },
    async read(req) {
      const args = credentials(req);
      if (!args) return anonymous;
      try {
        const {rows:[row]} = await db.query(READ, args);
        if (!row) return anonymous;
        return {status:'signed-in', report:row.id == null ? null : report(row)};
      } catch { return unavailable; }
    },
    async logout(req) {
      const args = credentials(req);
      if (!args) return {status:'signed-out'};
      try {
        await db.query(`DELETE FROM ${NS}.session WHERE browser_digest=$1 AND token_digest=$2`, args);
        return {status:'signed-out'};
      } catch { return unavailable; }
    },
  };
}
