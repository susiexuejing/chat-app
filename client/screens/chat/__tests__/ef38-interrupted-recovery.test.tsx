/**
 * EF-38 Interrupted Generation Recovery Tests
 * 
 * These tests verify the complete interrupted generation recovery flow:
 * 1. Refresh during generation - session is marked as interrupted
 * 2. Retry after refresh - uses persisted pendingTurn
 * 3. SSE error handling - marks turn as failed
 */

import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';
import { ChatProvider, useChat } from '../contexts/ChatContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as sessionStore from '../stores/sessionStore';
import * as cozeApi from '../api/cozeApi';
import { roles } from '../constants/roles';

// Mock dependencies
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
  clear: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../stores/sessionStore', () => ({
  saveChatSessions: jest.fn().mockResolvedValue(undefined),
  getChatSessions: jest.fn().mockResolvedValue([]),
  persistMessage: jest.fn().mockResolvedValue(undefined),
  createConversation: jest.fn().mockResolvedValue({ id: 'conv-test-123' }),
  fetchConversation: jest.fn().mockResolvedValue(null),
}));

jest.mock('../api/cozeApi', () => ({
  chatStart: jest.fn(),
  chatStream: jest.fn(),
}));

// Test helper component to access context
function TestConsumer({ onContext }: { onContext: (ctx: ReturnType<typeof useChat>) => void }) {
  const context = useChat();
  React.useEffect(() => {
    onContext(context);
  }, [context]);
  return null;
}

describe('EF-38 Interrupted Generation Recovery Tests', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (sessionStore.getChatSessions as jest.Mock).mockResolvedValue([]);
  });

  describe('Test A: Refresh during generation', () => {
    it('should mark session as interrupted when refresh occurs during generation', async () => {
      // Arrange: Mock chatStart to return backend UUID
      const backendUUID = '2976d531-99c1-46b6-adb3-cbc71a400787';
      (cozeApi.chatStart as jest.Mock).mockResolvedValue({
        sessionId: backendUUID,
        reactionLayer: 'Test reaction',
        companionLayer: null,
        frontFlowText: null,
        reactionTimeline: null,
        companionTimeline: null,
        flowContext: { conversation_id: 'conv_123' } as any,
      });

      // Mock chatStream to never complete (simulating refresh during generation)
      const mockedChatStream = cozeApi.chatStream as jest.Mock;
      mockedChatStream.mockImplementation((params: any) => {
        // Never call onDone or onEvent - simulating interrupted generation
        return Promise.resolve();
      });

      let contextRef: any = null;

      // Act: Render ChatProvider
      await act(async () => {
        render(
          <ChatProvider>
            <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
          </ChatProvider>
        );
      });

      // Wait for hydration
      await waitFor(() => {
        expect(contextRef?.isHydrated).toBe(true);
      });

      // Create a new chat and send a message
      let frontendSessionId: string | null = null;
      await act(async () => {
        frontendSessionId = contextRef!.createNewChat();
      });

      expect(frontendSessionId).toBeTruthy();
      expect(frontendSessionId).toMatch(/^session_/);

      // Send a message (this will start generation but never complete)
      await act(async () => {
        contextRef!.sendMessage('Test message');
      });

      // Wait for generating state to be persisted
      await waitFor(() => {
        expect(contextRef?.turnStatus).toBe('generating');
      });

      // Verify pendingTurn is persisted
      expect(contextRef?.pendingTurn).toBeTruthy();
      expect(contextRef?.pendingTurn?.userMessage).toBe('Test message');

      // Simulate refresh by unmounting and remounting
      await act(async () => {
        contextRef = null;
      });

      // Get the persisted sessions
      const persistedSessions = await sessionStore.getChatSessions();
      expect(persistedSessions).toHaveLength(1);

      // Verify the session has generating state
      expect(persistedSessions[0].turnStatus).toBe('generating');
      expect(persistedSessions[0].pendingTurn).toBeTruthy();

      // Remount to simulate refresh
      await act(async () => {
        render(
          <ChatProvider>
            <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
          </ChatProvider>
        );
      });

      // Wait for hydration
      await waitFor(() => {
        expect(contextRef?.isHydrated).toBe(true);
      });

      // Assert: Session should be marked as interrupted
      expect(contextRef?.turnStatus).toBe('interrupted');
      expect(contextRef?.isLoading).toBe(false);
      expect(contextRef?.isThinking).toBe(false);

      // Verify the session still has the user message
      const sessions = contextRef?.sessions || [];
      expect(sessions).toHaveLength(1);
      expect(sessions[0].messages).toHaveLength(1);
      expect(sessions[0].messages[0].role).toBe('user');
      expect(sessions[0].messages[0].content).toBe('Test message');

      // Verify pendingTurn is still available for retry
      expect(contextRef?.pendingTurn).toBeTruthy();
      expect(contextRef?.pendingTurn?.userMessage).toBe('Test message');
    });
  });

  describe('Test B: Retry after remount', () => {
    it('should retry using persisted pendingTurn after remount', async () => {
      // Arrange: Pre-populate storage with an interrupted session
      const interruptedSession = {
        id: 'session_test_123',
        roleId: 'clever-fox',
        title: 'Test Chat',
        messages: [
          { id: 'msg_user_1', role: 'user' as const, content: 'Test message', timestamp: Date.now() }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        conversationId: 'conv_123',
        chatPhase: 'idle' as const,
        turnStatus: 'interrupted' as const,
        pendingTurn: {
          requestId: 'req_123',
          userMessageId: 'msg_user_1',
          userMessage: 'Test message',
          startedAt: Date.now(),
          roleId: 'clever-fox',
          conversationId: 'conv_123',
        },
      };

      (sessionStore.getChatSessions as jest.Mock).mockResolvedValue([interruptedSession]);
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'chat_sessions') return Promise.resolve(JSON.stringify([interruptedSession]));
        if (key === 'current_session_id') return Promise.resolve('session_test_123');
        if (key === 'current_role_id') return Promise.resolve('clever-fox');
        return Promise.resolve(null);
      });

      // Mock chatStart and chatStream for successful completion
      const backendUUID = '2976d531-99c1-46b6-adb3-cbc71a400787';
      (cozeApi.chatStart as jest.Mock).mockResolvedValue({
        sessionId: backendUUID,
        reactionLayer: 'Test reaction',
        companionLayer: null,
        frontFlowText: null,
        reactionTimeline: null,
        companionTimeline: null,
        flowContext: { conversation_id: 'conv_123' } as any,
      });

      const mockedChatStream = cozeApi.chatStream as jest.Mock;
      mockedChatStream.mockImplementation((params: any) => {
        // Simulate successful completion
        setTimeout(() => {
          params.onEvent({ event: 'message', message: { role: 'assistant', content: 'Test response' } });
          params.onDone();
        }, 10);
        return Promise.resolve();
      });

      let contextRef: any = null;

      // Act: Render ChatProvider (should restore interrupted state)
      await act(async () => {
        render(
          <ChatProvider>
            <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
          </ChatProvider>
        );
      });

      // Wait for hydration
      await waitFor(() => {
        expect(contextRef?.isHydrated).toBe(true);
      });

      // Verify interrupted state is restored
      expect(contextRef?.turnStatus).toBe('interrupted');
      expect(contextRef?.pendingTurn).toBeTruthy();

      // Trigger retry
      await act(async () => {
        contextRef!.retryLastMessage();
      });

      // Wait for completion
      await waitFor(() => {
        expect(contextRef?.turnStatus).toBe('completed');
      }, { timeout: 5000 });

      // Assert: Original user message should not be duplicated
      const sessions = contextRef?.sessions || [];
      expect(sessions).toHaveLength(1);
      
      const userMessages = sessions[0].messages.filter((m: any) => m.role === 'user');
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0].content).toBe('Test message');

      // Assert: Exactly one assistant message should exist
      const assistantMessages = sessions[0].messages.filter((m: any) => m.role === 'assistant');
      expect(assistantMessages).toHaveLength(1);

      // Assert: turnStatus should be completed
      expect(contextRef?.turnStatus).toBe('completed');
      expect(contextRef?.chatPhase).toBe('done');

      // Assert: pendingTurn should be removed
      expect(contextRef?.pendingTurn).toBeUndefined();
    });
  });

  describe('Test C: Refresh interrupted state again', () => {
    it('should remain interrupted after multiple refreshes', async () => {
      // Arrange: Pre-populate storage with an interrupted session
      const interruptedSession = {
        id: 'session_test_123',
        roleId: 'clever-fox',
        title: 'Test Chat',
        messages: [
          { id: 'msg_user_1', role: 'user' as const, content: 'Test message', timestamp: Date.now() }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        conversationId: 'conv_123',
        chatPhase: 'idle' as const,
        turnStatus: 'interrupted' as const,
        pendingTurn: {
          requestId: 'req_123',
          userMessageId: 'msg_user_1',
          userMessage: 'Test message',
          startedAt: Date.now(),
          roleId: 'clever-fox',
          conversationId: 'conv_123',
        },
      };

      (sessionStore.getChatSessions as jest.Mock).mockResolvedValue([interruptedSession]);
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
        if (key === 'chat_sessions') return Promise.resolve(JSON.stringify([interruptedSession]));
        if (key === 'current_session_id') return Promise.resolve('session_test_123');
        if (key === 'current_role_id') return Promise.resolve('clever-fox');
        return Promise.resolve(null);
      });

      let contextRef: any = null;

      // First mount
      await act(async () => {
        render(
          <ChatProvider>
            <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
          </ChatProvider>
        );
      });

      await waitFor(() => {
        expect(contextRef?.isHydrated).toBe(true);
      });

      expect(contextRef?.turnStatus).toBe('interrupted');

      // Simulate refresh (unmount and remount)
      await act(async () => {
        contextRef = null;
      });

      // Second mount
      await act(async () => {
        render(
          <ChatProvider>
            <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
          </ChatProvider>
        );
      });

      await waitFor(() => {
        expect(contextRef?.isHydrated).toBe(true);
      });

      // Assert: Should still be interrupted
      expect(contextRef?.turnStatus).toBe('interrupted');
      expect(contextRef?.isLoading).toBe(false);
      expect(contextRef?.isThinking).toBe(false);

      // Assert: Retry should still be available
      expect(contextRef?.pendingTurn).toBeTruthy();
      expect(contextRef?.canRetry).toBe(true);
    });
  });

  describe('Test D: SSE error/empty completion', () => {
    it('should handle SSE error and mark turn as failed', async () => {
      // Arrange: Mock chatStart to return backend UUID
      const backendUUID = '2976d531-99c1-46b6-adb3-cbc71a400787';
      (cozeApi.chatStart as jest.Mock).mockResolvedValue({
        sessionId: backendUUID,
        reactionLayer: 'Test reaction',
        companionLayer: null,
        frontFlowText: null,
        reactionTimeline: null,
        companionTimeline: null,
        flowContext: { conversation_id: 'conv_123' } as any,
      });

      // Mock chatStream to call onError
      const mockedChatStream = cozeApi.chatStream as jest.Mock;
      mockedChatStream.mockImplementation((params: any) => {
        setTimeout(() => {
          params.onError?.(new Error('SSE connection failed'));
        }, 10);
        return Promise.resolve();
      });

      let contextRef: any = null;

      // Act: Render ChatProvider
      await act(async () => {
        render(
          <ChatProvider>
            <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
          </ChatProvider>
        );
      });

      // Wait for hydration
      await waitFor(() => {
        expect(contextRef?.isHydrated).toBe(true);
      });

      // Create a new chat and send a message
      await act(async () => {
        contextRef!.createNewChat();
      });

      // Send a message (this will trigger SSE error)
      await act(async () => {
        contextRef!.sendMessage('Test message');
      });

      // Wait for error handling
      await waitFor(() => {
        expect(contextRef?.turnStatus).toBe('failed');
      }, { timeout: 5000 });

      // Assert: isLoading and isThinking should be false
      expect(contextRef?.isLoading).toBe(false);
      expect(contextRef?.isThinking).toBe(false);

      // Assert: User message should still be present
      const sessions = contextRef?.sessions || [];
      expect(sessions).toHaveLength(1);
      expect(sessions[0].messages).toHaveLength(1);
      expect(sessions[0].messages[0].role).toBe('user');
      expect(sessions[0].messages[0].content).toBe('Test message');

      // Assert: sendMessage should have settled (not pending forever)
      expect(contextRef?.turnStatus).not.toBe('generating');
    });
  });
});
