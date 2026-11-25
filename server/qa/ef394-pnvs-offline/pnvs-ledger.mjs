const schemas = Object.freeze({offline:'ef_quiz_sms_qa',devAccount:'ef_quiz_account_dev'});
export function postgresReservation(db, storage = 'offline') {
  const schema = Object.hasOwn(schemas,storage) ? schemas[storage] : null;
  if (!schema || typeof db?.query !== 'function') throw new TypeError('database query client required');
  const RESERVE = `SELECT ${schema}.reserve_run_budget($1,$2,$3,$4,$5,$6,$7) AS reserved`;
  return async ({ runId, release, subjectDigest, operation, from, until, limit }) => {
    const { rows } = await db.query(RESERVE, [runId, release, subjectDigest, operation, from, until, limit]);
    return Array.isArray(rows) && rows.length === 1 && rows[0].reserved === true;
  };
}
