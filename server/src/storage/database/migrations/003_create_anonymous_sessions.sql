-- EF-75: server-issued anonymous identity and conversation ownership.
-- Additive only: legacy conversations remain owner_session_id = NULL and are
-- deliberately ineligible for external ownership checks.
CREATE TABLE IF NOT EXISTS anonymous_sessions (
  id               VARCHAR(36) PRIMARY KEY,
  credential_hash  CHAR(64) NOT NULL UNIQUE,
  transport         VARCHAR(8) NOT NULL CHECK (transport IN ('native', 'web')),
  csrf_hash         CHAR(64),
  created_at        BIGINT NOT NULL,
  expires_at        BIGINT NOT NULL,
  revoked_at        BIGINT
);

CREATE INDEX IF NOT EXISTS anonymous_sessions_active_idx
  ON anonymous_sessions(credential_hash, transport, expires_at);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS owner_session_id VARCHAR(36)
  REFERENCES anonymous_sessions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS conversations_owner_session_id_idx
  ON conversations(owner_session_id, id);

ALTER TABLE anonymous_sessions ENABLE ROW LEVEL SECURITY;
