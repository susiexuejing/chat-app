const RESERVE = 'SELECT ef_quiz_sms_qa.reserve_run_budget($1,$2,$3,$4,$5,$6,$7) AS reserved';
export function postgresReservation(db) {
  if (typeof db?.query !== 'function') throw new TypeError('database query client required');
  return async ({ runId, release, subjectDigest, operation, from, until, limit }) => {
    const { rows } = await db.query(RESERVE, [runId, release, subjectDigest, operation, from, until, limit]);
    return Array.isArray(rows) && rows.length === 1 && rows[0].reserved === true;
  };
}
