-- Candidate only. Dedicated DEV database and migration role, never a shared database.
BEGIN;
CREATE SCHEMA ef_quiz_account_dev;
REVOKE ALL ON SCHEMA ef_quiz_account_dev FROM PUBLIC;
CREATE TABLE ef_quiz_account_dev.run_budget (
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
REVOKE ALL ON ef_quiz_account_dev.run_budget FROM PUBLIC;
CREATE FUNCTION ef_quiz_account_dev.reserve_run_budget(
  p_run text, p_release text, p_subject text, p_operation text, p_from bigint, p_until bigint, p_limit smallint
) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog, pg_temp
AS $$
  WITH reserved AS (
    UPDATE ef_quiz_account_dev.run_budget
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
REVOKE ALL ON FUNCTION ef_quiz_account_dev.reserve_run_budget(text,text,text,text,bigint,bigint,smallint) FROM PUBLIC;


CREATE TABLE ef_quiz_account_dev.challenge (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{32}$'),
  request_id text NOT NULL CHECK (request_id ~ '^[0-9a-f]{32}$'),
  run_id text NOT NULL CHECK (run_id ~ '^[a-z0-9-]{8,64}$'),
  release_id text NOT NULL CHECK (release_id ~ '^[a-f0-9]{64}$'),
  subject_digest text NOT NULL CHECK (subject_digest ~ '^[a-f0-9]{64}$'),
  browser_digest text NOT NULL CHECK (browser_digest ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('sending','pending','checking','unusable','verified')),
  UNIQUE (run_id,release_id,request_id)
);
REVOKE ALL ON ef_quiz_account_dev.challenge FROM PUBLIC;


CREATE TABLE ef_quiz_account_dev.account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_digest text NOT NULL UNIQUE CHECK (subject_digest ~ '^[a-f0-9]{64}$'),
  consent_fixture text NOT NULL CHECK (consent_fixture ~ '^dev-qa-[a-z0-9-]{3,50}$'),
  consented_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE ef_quiz_account_dev.session (
  browser_digest text PRIMARY KEY CHECK (browser_digest ~ '^[a-f0-9]{64}$'),
  token_digest text NOT NULL UNIQUE CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  account_id uuid NOT NULL REFERENCES ef_quiz_account_dev.account(id),
  expires_at timestamptz NOT NULL
);
CREATE TABLE ef_quiz_account_dev.report (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES ef_quiz_account_dev.account(id),
  submission_id text NOT NULL CHECK (submission_id ~ '^[a-f0-9]{32}$'),
  answer_digest text NOT NULL CHECK (answer_digest ~ '^[a-f0-9]{64}$'),
  scores jsonb NOT NULL,
  UNIQUE (account_id, submission_id)
);
REVOKE ALL ON ef_quiz_account_dev.account, ef_quiz_account_dev.session, ef_quiz_account_dev.report FROM PUBLIC;

-- Serialize the final issuance decision with ledger revocation, without
-- granting direct ledger access to any future caller of this helper.
CREATE FUNCTION ef_quiz_account_dev.verified_run_active(p_run text,p_release text,p_subject text)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM ef_quiz_account_dev.run_budget
    WHERE run_id=p_run AND release_id=p_release AND subject_digest=p_subject AND operation='verify'
      AND spent>0 AND NOT revoked
      AND clock_timestamp() >= to_timestamp(starts_ms/1000.0)
      AND clock_timestamp() < to_timestamp(ends_ms/1000.0)
    FOR SHARE)
$$;
REVOKE ALL ON FUNCTION ef_quiz_account_dev.verified_run_active(text,text,text) FROM PUBLIC;

-- Bound durable challenge rows before insertion. Serialize per budget
-- subject so a publicly reachable signup path cannot fill the table by
-- posting new intent IDs for approved numbers after the budget is spent.
CREATE FUNCTION ef_quiz_account_dev.admit_challenge() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog, pg_temp
AS $$
DECLARE allowance smallint;
BEGIN
  SELECT max_calls INTO allowance FROM ef_quiz_account_dev.run_budget
  WHERE run_id=NEW.run_id AND release_id=NEW.release_id
    AND subject_digest=NEW.subject_digest AND operation='send'
    AND NOT revoked AND spent<max_calls
    AND clock_timestamp() >= to_timestamp(starts_ms/1000.0)
    AND clock_timestamp() < to_timestamp(ends_ms/1000.0)
  FOR UPDATE;
  IF NOT FOUND OR (
    SELECT count(*) FROM ef_quiz_account_dev.challenge
    WHERE run_id=NEW.run_id AND release_id=NEW.release_id AND subject_digest=NEW.subject_digest
  ) >= allowance THEN RETURN NULL;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION ef_quiz_account_dev.admit_challenge() FROM PUBLIC;
CREATE TRIGGER admit_qa_challenge BEFORE INSERT ON ef_quiz_account_dev.challenge
FOR EACH ROW EXECUTE FUNCTION ef_quiz_account_dev.admit_challenge();

-- Runtime role must already exist, use exclusive local peer and not own objects.
GRANT USAGE ON SCHEMA ef_quiz_account_dev TO ef_quiz_account_qa_runtime;
GRANT SELECT, INSERT, UPDATE ON ef_quiz_account_dev.challenge, ef_quiz_account_dev.account, ef_quiz_account_dev.report TO ef_quiz_account_qa_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ef_quiz_account_dev.session TO ef_quiz_account_qa_runtime;
GRANT USAGE ON SEQUENCE ef_quiz_account_dev.report_id_seq TO ef_quiz_account_qa_runtime;
GRANT EXECUTE ON FUNCTION ef_quiz_account_dev.reserve_run_budget(text,text,text,text,bigint,bigint,smallint),
  ef_quiz_account_dev.verified_run_active(text,text,text) TO ef_quiz_account_qa_runtime;
COMMIT;
