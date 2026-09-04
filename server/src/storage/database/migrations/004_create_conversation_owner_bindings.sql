-- EF-185: private, additive server-side ownership bindings.
-- Application of this migration is separately gated through the protected
-- EF-182 RDS execution route. No grants or credentials are defined here.
CREATE TABLE IF NOT EXISTS conversation_owner_bindings (
  conversation_ref      VARCHAR(36) PRIMARY KEY,
  owner_principal_id    VARCHAR(36) NOT NULL,
  created_at            BIGINT NOT NULL,
  revoked_at            BIGINT
);

CREATE INDEX IF NOT EXISTS conversation_owner_bindings_owner_active_idx
  ON conversation_owner_bindings(owner_principal_id, conversation_ref)
  WHERE revoked_at IS NULL;
