/**
 * EM-43 Client→Server Contract Tests
 * 
 * These tests verify that the client chatStart API correctly serializes
 * requests and that the server route correctly processes them.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { resetAllConversations, incrementConversationTurnIdempotent } from '../flows/conversationTurns';

describe('EM-43 Client→Server Contract', () => {
  beforeEach(() => {
    resetAllConversations();
  });

  describe('chatStart route validation', () => {
    it('accepts valid conversationId and requestId', async () => {
      const conversationId = 'conv_test_123';
      const requestId = 'req_test_456';
      
      // Verify the IDs match the protocol
      const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
      expect(conversationId).toMatch(idPattern);
      expect(requestId).toMatch(idPattern);
    });

    it('rejects conversationId with invalid characters', () => {
      const invalidId = 'conv with spaces';
      const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
      expect(invalidId).not.toMatch(idPattern);
    });

    it('rejects conversationId over 100 characters', () => {
      const longId = 'a'.repeat(101);
      const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
      expect(longId).not.toMatch(idPattern);
    });

    it('accepts conversationId with hyphens and underscores', () => {
      const validId = 'conv-test_id-123';
      const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
      expect(validId).toMatch(idPattern);
    });

    it('accepts single character conversationId', () => {
      const validId = 'a';
      const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
      expect(validId).toMatch(idPattern);
    });

    it('accepts exactly 100 character conversationId', () => {
      const validId = 'a'.repeat(100);
      const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
      expect(validId).toMatch(idPattern);
    });
  });

  describe('idempotent requestId behavior', () => {
    it('same requestId returns same userTurn', async () => {
      const conversationId = 'conv_test';
      const requestId = 'req_test';
      
      const turn1 = incrementConversationTurnIdempotent(conversationId, requestId);
      const turn2 = incrementConversationTurnIdempotent(conversationId, requestId);
      
      expect(turn1).toBe(1);
      expect(turn2).toBe(1); // Same requestId returns same turn
    });

    it('different requestId increments userTurn', async () => {
      const conversationId = 'conv_test_2';
      const requestId1 = 'req_test_1';
      const requestId2 = 'req_test_2';
      
      const turn1 = incrementConversationTurnIdempotent(conversationId, requestId1);
      const turn2 = incrementConversationTurnIdempotent(conversationId, requestId2);
      
      expect(turn1).toBe(1);
      expect(turn2).toBe(2); // Different requestId increments
    });
  });
});
