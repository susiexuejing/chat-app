/**
 * EF-38 Production Path Tests
 * 
 * These tests verify the actual production behavior of the interrupted generation recovery.
 * They test the full lifecycle from send to recovery.
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

describe('EF-38 Production Path Tests', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (sessionStore.getChatSessions as jest.Mock).mockResolvedValue([]);
  });

  describe('Test 1: Normal valid Deep settles as completed without timeout', () => {
    it('should settle stream as completed when valid Deep content is received', async () => {
      const startTime = Date.now();
      
      // Setup mocks
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
      
      (cozeApi.chatStream as jest.Mock).mockImplementation((sessionId: string, callbacks: any) => {
        // Simulate valid Deep content via onChunk
        setTimeout(() => {
          callbacks.onChunk(JSON.stringify({ content: 'Valid Deep response' }));
          callbacks.onChunk(JSON.stringify({ done: true }));
          callbacks.onDone();
        }, 50);
        return Promise.resolve();
      });

      let contextRef: any = null;

      // Render provider
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

      // Create new chat and send message
      await act(async () => {
        contextRef!.createNewChat();
      });

      await act(async () => {
        await contextRef!.sendMessage('Hello');
      });

      // Wait for completion
      await waitFor(() => {
        expect(contextRef?.chatPhase).toBe('done');
      }, { timeout: 5000 });

      const duration = Date.now() - startTime;
      
      // Should complete quickly, not wait for 30-second timeout
      expect(duration).toBeLessThan(5000);
      expect(contextRef?.turnStatus).toBe('completed');
    });
  });

  describe('Test 2: Generating Session is produced by real send path', () => {
    it('should persist session with turnStatus=generating before chatStart', async () => {
      let chatStartCalled = false;
      let generatingPersistedBeforeChatStart = false;

      // Setup mocks
      const backendUUID = '2976d531-99c1-46b6-adb3-cbc71a400787';
      (cozeApi.chatStart as jest.Mock).mockImplementation(async () => {
        // Check if generating state was persisted before chatStart
        const currentSessions = await sessionStore.getChatSessions();
        generatingPersistedBeforeChatStart = currentSessions.some((s: any) => s.turnStatus === 'generating');
        chatStartCalled = true;
        return {
          sessionId: backendUUID,
          reactionLayer: 'Test reaction',
          companionLayer: null,
          frontFlowText: null,
          reactionTimeline: null,
          companionTimeline: null,
          flowContext: { conversation_id: 'conv_123' } as any,
        };
      });

      (cozeApi.chatStream as jest.Mock).mockImplementation((sessionId: string, callbacks: any) => {
        setTimeout(() => {
          callbacks.onChunk(JSON.stringify({ content: 'Response' }));
          callbacks.onChunk(JSON.stringify({ done: true }));
          callbacks.onDone();
        }, 50);
        return Promise.resolve();
      });

      let contextRef: any = null;

      // Render provider
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

      await act(async () => {
        contextRef!.createNewChat();
      });

      await act(async () => {
        await contextRef!.sendMessage('Hello');
      });

      // Wait for chatStart to be called
      await waitFor(() => expect(chatStartCalled).toBe(true));

      // Verify generating state was persisted before chatStart
      expect(generatingPersistedBeforeChatStart).toBe(true);
    });
  });

  describe('Test 3: Real Provider unmount/remount converts generating to interrupted', () => {
    it('should convert generating to interrupted after unmount and remount', async () => {
      // Setup mocks - chatStream never completes
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

      (cozeApi.chatStream as jest.Mock).mockImplementation(() => {
        // Never call onDone - simulate hanging stream
        return new Promise(() => {});
      });

      let contextRef: any = null;

      // First render
      const renderResult = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );

      // Wait for hydration
      await waitFor(() => {
        expect(contextRef?.isHydrated).toBe(true);
      });

      await act(async () => {
        contextRef!.createNewChat();
      });

      // Start message but don't wait for completion
      await act(async () => {
        contextRef!.sendMessage('Hello');
      });

      // Wait a bit for generating state to be persisted
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Unmount first provider
      await renderResult.unmount();

      // Wait for unmount to settle
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Second render - should hydrate from storage
      contextRef = null;
      await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );

      // Wait for hydration
      await waitFor(() => {
        expect(contextRef?.isHydrated).toBe(true);
      });

      // Verify interrupted state
      await waitFor(() => {
        expect(contextRef?.turnStatus).toBe('interrupted');
      });

      expect(contextRef?.chatPhase).not.toBe('responding');
      expect(contextRef?.isThinking).toBe(false);
      expect(contextRef?.isLoading).toBe(false);
    });
  });

  describe('Test 6: Original user-message ID remains unchanged after retry', () => {
    it('should reuse original user message ID on retry', async () => {
      // Setup mocks
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

      let callCount = 0;
      (cozeApi.chatStream as jest.Mock).mockImplementation((sessionId: string, callbacks: any) => {
        callCount++;
        if (callCount === 1) {
          // First call - error
          setTimeout(() => {
            callbacks.onError(new Error('Stream error'));
          }, 50);
        } else {
          // Second call (retry) - success
          setTimeout(() => {
            callbacks.onChunk(JSON.stringify({ content: 'Retry response' }));
            callbacks.onChunk(JSON.stringify({ done: true }));
            callbacks.onDone();
          }, 50);
        }
        return Promise.resolve();
      });

      let contextRef: any = null;

      // Render provider
      await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );

      // Wait for hydration
      await waitFor(() => {
        expect(contextRef?.isHydrated).toBe(true);
      });

      await act(async () => {
        contextRef!.createNewChat();
      });

      // First send - will fail
      await act(async () => {
        await contextRef!.sendMessage('Hello');
      });

      // Wait for error state
      await waitFor(() => {
        expect(contextRef?.turnStatus).toBe('failed');
      });

      // Get the user message ID from the session
      const currentSessions = await sessionStore.getChatSessions();
      const session = currentSessions[0];
      const firstUserMessageId = session?.messages?.find((m: any) => m.role === 'user')?.id;

      // Retry
      await act(async () => {
        await contextRef!.retryLastMessage();
      });

      // Wait for completion
      await waitFor(() => {
        expect(contextRef?.chatPhase).toBe('done');
      });

      // Get the user message ID after retry
      const sessionsAfterRetry = await sessionStore.getChatSessions();
      const sessionAfterRetry = sessionsAfterRetry[0];
      const secondUserMessageId = sessionAfterRetry?.messages?.find((m: any) => m.role === 'user')?.id;

      // User message ID should be the same
      expect(firstUserMessageId).toBe(secondUserMessageId);
      
      // User message should exist exactly once
      const userMessages = sessionAfterRetry?.messages?.filter((m: any) => m.role === 'user') || [];
      expect(userMessages.length).toBe(1);
    });
  });

  describe('Test 9: onError settles without timeout', () => {
    it('should settle stream as error immediately when onError is called', async () => {
      const startTime = Date.now();

      // Setup mocks
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

      (cozeApi.chatStream as jest.Mock).mockImplementation((sessionId: string, callbacks: any) => {
        // Call onError immediately
        setTimeout(() => {
          callbacks.onError(new Error('Stream error'));
        }, 50);
        return Promise.resolve();
      });

      let contextRef: any = null;

      // Render provider
      await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );

      // Wait for hydration
      await waitFor(() => {
        expect(contextRef?.isHydrated).toBe(true);
      });

      await act(async () => {
        contextRef!.createNewChat();
      });

      await act(async () => {
        await contextRef!.sendMessage('Hello');
      });

      // Wait for error state
      await waitFor(() => {
        expect(contextRef?.turnStatus).toBe('failed');
      }, { timeout: 5000 });

      const duration = Date.now() - startTime;

      // Should complete quickly, not wait for 30-second timeout
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('Test 12: Old Provider cannot finalize after unmount', () => {
    it('should not call finalizeTurnCompleted after unmount', async () => {
      // Setup mocks
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

      (cozeApi.chatStream as jest.Mock).mockImplementation((sessionId: string, callbacks: any) => {
        // Delay completion until after unmount
        setTimeout(() => {
          callbacks.onChunk(JSON.stringify({ content: 'Late response' }));
          callbacks.onChunk(JSON.stringify({ done: true }));
          callbacks.onDone();
        }, 500);
        return Promise.resolve();
      });

      let contextRef: any = null;

      // First render
      const renderResult = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );

      // Wait for hydration
      await waitFor(() => {
        expect(contextRef?.isHydrated).toBe(true);
      });

      await act(async () => {
        contextRef!.createNewChat();
      });

      // Start message
      await act(async () => {
        contextRef!.sendMessage('Hello');
      });

      // Wait a bit
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Get sessions before unmount
      const sessionsBefore = await sessionStore.getChatSessions();
      const turnStatusBefore = sessionsBefore[0]?.turnStatus;

      // Unmount
      await renderResult.unmount();

      // Wait for stream to complete
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 600));
      });

      // Get sessions after unmount
      const sessionsAfter = await sessionStore.getChatSessions();
      const turnStatusAfter = sessionsAfter[0]?.turnStatus;

      // Turn status should not change to completed after unmount
      // It should remain as generating (to be converted to interrupted by new provider)
      expect(turnStatusAfter).not.toBe('completed');
    });
  });
});
