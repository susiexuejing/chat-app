-- Offline-only companion schema. No existing DEV tables are touched.
CREATE TABLE ef_quiz_sms_qa.account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_digest text NOT NULL UNIQUE CHECK (subject_digest ~ '^[a-f0-9]{64}$'),
  consent_fixture text NOT NULL CHECK (consent_fixture = 'local-offline-v1'),
  consented_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE ef_quiz_sms_qa.session (
  browser_digest text PRIMARY KEY CHECK (browser_digest ~ '^[a-f0-9]{64}$'),
  token_digest text NOT NULL UNIQUE CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  account_id uuid NOT NULL REFERENCES ef_quiz_sms_qa.account(id),
  expires_at timestamptz NOT NULL
);
CREATE TABLE ef_quiz_sms_qa.report (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES ef_quiz_sms_qa.account(id),
  submission_id text NOT NULL CHECK (submission_id ~ '^[a-f0-9]{32}$'),
  answer_digest text NOT NULL CHECK (answer_digest ~ '^[a-f0-9]{64}$'),
  scores jsonb NOT NULL,
  UNIQUE (account_id, submission_id)
);
REVOKE ALL ON ef_quiz_sms_qa.account, ef_quiz_sms_qa.session, ef_quiz_sms_qa.report FROM PUBLIC;

-- Serialize the final issuance decision with ledger revocation, without
-- granting direct ledger access to any future caller of this helper.
CREATE FUNCTION ef_quiz_sms_qa.verified_run_active(p_run text,p_release text,p_subject text)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO pg_catalog, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM ef_quiz_sms_qa.run_budget
    WHERE run_id=p_run AND release_id=p_release AND subject_digest=p_subject AND operation='verify'
      AND spent>0 AND NOT revoked
      AND clock_timestamp() >= to_timestamp(starts_ms/1000.0)
      AND clock_timestamp() < to_timestamp(ends_ms/1000.0)
    FOR SHARE)
$$;
REVOKE ALL ON FUNCTION ef_quiz_sms_qa.verified_run_active(text,text,text) FROM PUBLIC;
