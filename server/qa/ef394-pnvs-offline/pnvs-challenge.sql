-- Local rehearsal only. No grants, deployed migration, or provider credentials.
CREATE TABLE ef_quiz_sms_qa.challenge (
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
REVOKE ALL ON ef_quiz_sms_qa.challenge FROM PUBLIC;
