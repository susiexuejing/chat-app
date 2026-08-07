-- EF-59 Phase 1: Create conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         VARCHAR(36) NOT NULL,
  role_id         VARCHAR(100) NOT NULL,
  state           VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL,
  last_message_at BIGINT
);

CREATE INDEX IF NOT EXISTS conversations_user_id_idx
  ON conversations(user_id);

CREATE INDEX IF NOT EXISTS conversations_user_state_idx
  ON conversations(user_id, state);

CREATE INDEX IF NOT EXISTS conversations_last_message_idx
  ON conversations(user_id, last_message_at);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
