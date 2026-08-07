-- EF-59 Phase 1: Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id               VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  VARCHAR(36) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             VARCHAR(20) NOT NULL,
  content          TEXT NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'sent',
  request_id       VARCHAR(100),
  timestamp        BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_conversation_id_idx
  ON messages(conversation_id);

CREATE INDEX IF NOT EXISTS messages_conversation_ts_idx
  ON messages(conversation_id, timestamp);

CREATE INDEX IF NOT EXISTS messages_request_id_idx
  ON messages(request_id);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
