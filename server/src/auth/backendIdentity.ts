import type { Request } from 'express';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IdentityFailure = 'missing' | 'malformed' | 'mismatched';

export interface BackendIdentity {
  userId: string;
  conversationId?: string;
}

export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

function singleHeader(req: Request, name: string): string | undefined {
  const value = req.header(name);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readBackendIdentity(req: Request, options: {
  bodyUserId?: unknown;
  requireConversationHeader?: boolean;
} = {}): { identity: BackendIdentity } | { failure: IdentityFailure } {
  const headerUserId = singleHeader(req, 'X-EmotionFlow-User-Id');
  const bodyUserId = options.bodyUserId;
  const userId = headerUserId ?? (typeof bodyUserId === 'string' ? bodyUserId : undefined);

  if (!userId) return { failure: 'missing' };
  if (!isUuidV4(userId)) return { failure: 'malformed' };
  if (headerUserId && bodyUserId !== undefined && bodyUserId !== headerUserId) {
    return { failure: 'mismatched' };
  }

  const headerConversationId = singleHeader(req, 'X-EmotionFlow-Conversation-Id');
  if (options.requireConversationHeader && !headerConversationId) return { failure: 'missing' };
  if (headerConversationId && !isUuidV4(headerConversationId)) return { failure: 'malformed' };

  return { identity: { userId, conversationId: headerConversationId } };
}

export function identityMatches(actualUserId: unknown, identity: BackendIdentity): boolean {
  return isUuidV4(actualUserId) && actualUserId === identity.userId;
}
