import { describe, expect, it } from '@jest/globals';
import type { Request } from 'express';
import { identityMatches, isUuidV4, readBackendIdentity } from '../auth/backendIdentity';

const owner = '11111111-1111-4111-8111-111111111111';
const otherUser = '22222222-2222-4222-8222-222222222222';
const conversation = '33333333-3333-4333-8333-333333333333';

function request(headers: Record<string, string> = {}): Request {
  return { header: (name: string) => headers[name] ?? headers[name.toLowerCase()] } as unknown as Request;
}

describe('EF-107 backend identity and ownership contract', () => {
  it('accepts a valid canonical body identity and rejects absent identity', () => {
    expect(readBackendIdentity(request(), { bodyUserId: owner })).toEqual({ identity: { userId: owner } });
    expect(readBackendIdentity(request())).toEqual({ failure: 'missing' });
  });

  it('rejects malformed and forged/mismatched identity context', () => {
    expect(isUuidV4(owner)).toBe(true);
    expect(readBackendIdentity(request(), { bodyUserId: 'not-a-user' })).toEqual({ failure: 'malformed' });
    expect(readBackendIdentity(request({ 'X-EmotionFlow-User-Id': otherUser }), { bodyUserId: owner })).toEqual({ failure: 'mismatched' });
    expect(readBackendIdentity(request({ 'X-EmotionFlow-User-Id': owner, 'X-EmotionFlow-Conversation-Id': 'forged' }), { requireConversationHeader: true })).toEqual({ failure: 'malformed' });
  });

  it('requires stream conversation context and preserves exact owner binding', () => {
    expect(readBackendIdentity(request({ 'X-EmotionFlow-User-Id': owner, 'X-EmotionFlow-Conversation-Id': conversation }), { requireConversationHeader: true })).toEqual({ identity: { userId: owner, conversationId: conversation } });
    expect(readBackendIdentity(request({ 'X-EmotionFlow-User-Id': owner }), { requireConversationHeader: true })).toEqual({ failure: 'missing' });
    expect(identityMatches(owner, { userId: owner })).toBe(true);
    expect(identityMatches(otherUser, { userId: owner })).toBe(false);
    expect(identityMatches(undefined, { userId: owner })).toBe(false);
  });
});
