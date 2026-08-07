import { relations } from "drizzle-orm/relations";
import { conversations, messages } from "./schema";

// conversations -> messages (one-to-many)
export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
}));

// messages -> conversations (many-to-one)
export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversation_id],
    references: [conversations.id],
  }),
}));

