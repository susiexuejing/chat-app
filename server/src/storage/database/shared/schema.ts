import { pgTable, serial, timestamp, varchar, text, bigint, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// EF-59: Conversations table
export const conversations = pgTable(
  "conversations",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    user_id: varchar("user_id", { length: 36 }).notNull(),
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
