import { pgTable, serial, timestamp, varchar, text, bigint, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// EF-75: Opaque, server-issued anonymous credentials. Only credential hashes
// are persisted; the raw token is returned once to the supported transport.
export const anonymousSessions = pgTable(
  "anonymous_sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    credential_hash: varchar("credential_hash", { length: 64 }).notNull().unique(),
    transport: varchar("transport", { length: 8 }).notNull(),
    csrf_hash: varchar("csrf_hash", { length: 64 }),
    created_at: bigint("created_at", { mode: "number" }).notNull(),
    expires_at: bigint("expires_at", { mode: "number" }).notNull(),
    revoked_at: bigint("revoked_at", { mode: "number" }),
  },
  (table) => [
    index("anonymous_sessions_active_idx").on(
      table.credential_hash,
      table.transport,
      table.expires_at,
    ),
  ],
);

// EF-185: this private binding is the only RDS-side ownership representation.
// It contains no conversation/message content and has no client authority.
export const conversationOwnerBindings = pgTable(
  "conversation_owner_bindings",
  {
    conversation_ref: varchar("conversation_ref", { length: 36 }).primaryKey(),
    owner_principal_id: varchar("owner_principal_id", { length: 36 }).notNull(),
    created_at: bigint("created_at", { mode: "number" }).notNull(),
    revoked_at: bigint("revoked_at", { mode: "number" }),
  },
  (table) => [
    index("conversation_owner_bindings_owner_active_idx").on(
      table.owner_principal_id,
      table.conversation_ref,
    ),
  ],
);

// EF-59: Conversations table
export const conversations = pgTable(
  "conversations",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    user_id: varchar("user_id", { length: 36 }).notNull(),
    owner_session_id: varchar("owner_session_id", { length: 36 })
      .references(() => anonymousSessions.id, { onDelete: "restrict" }),
    role_id: varchar("role_id", { length: 100 }).notNull(),
    state: varchar("state", { length: 20 }).notNull().default("active"),
    created_at: bigint("created_at", { mode: "number" }).notNull(),
    updated_at: bigint("updated_at", { mode: "number" }).notNull(),
    last_message_at: bigint("last_message_at", { mode: "number" }),
  },
  (table) => [
    index("conversations_user_id_idx").on(table.user_id),
    index("conversations_user_state_idx").on(table.user_id, table.state),
    index("conversations_last_message_idx").on(table.user_id, table.last_message_at),
    index("conversations_owner_session_id_idx").on(table.owner_session_id, table.id),
  ]
);

// EF-59: Messages table
export const messages = pgTable(
  "messages",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    conversation_id: varchar("conversation_id", { length: 36 }).notNull().references(() => conversations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull(),
    content: text("content").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("sent"),
    request_id: varchar("request_id", { length: 100 }),
    timestamp: bigint("timestamp", { mode: "number" }).notNull(),
  },
  (table) => [
    index("messages_conversation_id_idx").on(table.conversation_id),
    index("messages_conversation_ts_idx").on(table.conversation_id, table.timestamp),
    index("messages_request_id_idx").on(table.request_id),
  ]
);
