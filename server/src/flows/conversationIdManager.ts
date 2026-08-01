/**
 * EM-43: Conversation ID Management
 *
 * Pure functions for generating and resolving conversation IDs.
 * Extracted for testability.
 */

/**
 * Generate a new unique conversation ID.
 * Cross-platform safe (no crypto dependency).
 */
export function generateConversationId(): string {
  return `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Session data stored per conversation.
 */
export interface ConversationSession {
  conversationId: string;
  createdAt: number;
}

/**
 * In-memory store for active conversations.
 * Maps sessionKey -> ConversationSession
 */
const activeConversations = new Map<string, ConversationSession>();

/**
 * Create a new conversation for a given session key.
 * Returns the new conversation ID.
 */
export function createNewConversation(sessionKey: string): string {
  const conversationId = generateConversationId();
  activeConversations.set(sessionKey, {
    conversationId,
    createdAt: Date.now(),
  });
  return conversationId;
}

/**
 * Get the current conversation ID for a session key.
 * Returns undefined if no active conversation.
 */
export function getCurrentConversationId(sessionKey: string): string | undefined {
  return activeConversations.get(sessionKey)?.conversationId;
}

/**
 * Resolve the conversation ID to use for a sendMessage call.
 * If explicitConversationId is provided (from createNewConversation), use it.
 * Otherwise, fall back to the stored conversation for the session.
 */
export function resolveConversationId(
  sessionKey: string,
  explicitConversationId?: string,
): string | undefined {
  if (explicitConversationId) {
    return explicitConversationId;
  }
  return getCurrentConversationId(sessionKey);
}

/**
 * Clear all conversations (for testing only).
 */
export function _resetAllConversations(): void {
  activeConversations.clear();
}
