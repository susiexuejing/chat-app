-- Offline rebuild migration. Requires a dedicated admin/owner; do not run against shared databases.
BEGIN;
CREATE SCHEMA ef_quiz_sms_qa;
REVOKE ALL ON SCHEMA ef_quiz_sms_qa FROM PUBLIC;
CREATE TABLE ef_quiz_sms_qa.run_budget (
  run_id text NOT NULL,
  release_id text NOT NULL CHECK (release_id ~ '^[a-f0-9]{64}$'),
  subject_digest text NOT NULL CHECK (subject_digest ~ '^[a-f0-9]{64}$'),
  operation text NOT NULL CHECK (operation IN ('send','verify')),
  starts_ms bigint NOT NULL,
  ends_ms bigint NOT NULL CHECK (ends_ms > starts_ms AND ends_ms - starts_ms <= 900000),
  max_calls smallint NOT NULL CHECK (max_calls BETWEEN 1 AND 2),
  spent smallint NOT NULL DEFAULT 0 CHECK (spent BETWEEN 0 AND max_calls),
  revoked boolean NOT NULL DEFAULT false,
  PRIMARY KEY (run_id, operation, subject_digest)
);
REVOKE ALL ON ef_quiz_sms_qa.run_budget FROM PUBLIC;
CREATE FUNCTION ef_quiz_sms_qa.reserve_run_budget(
  p_run text, p_release text, p_subject text, p_operation text, p_from bigint, p_until bigint, p_limit smallint
) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog, pg_temp
AS $$
  WITH reserved AS (
    UPDATE ef_quiz_sms_qa.run_budget
       SET spent = spent + 1
     WHERE run_id = p_run
       AND release_id = p_release
       AND subject_digest = p_subject
       AND operation = p_operation
       AND starts_ms = p_from AND ends_ms = p_until AND max_calls = p_limit
       AND clock_timestamp() >= to_timestamp(starts_ms / 1000.0)
       AND clock_timestamp() < to_timestamp(ends_ms / 1000.0)
       AND NOT revoked AND spent < max_calls
     RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM reserved)
$$;
REVOKE ALL ON FUNCTION ef_quiz_sms_qa.reserve_run_budget(text,text,text,text,bigint,bigint,smallint) FROM PUBLIC;
COMMIT;
