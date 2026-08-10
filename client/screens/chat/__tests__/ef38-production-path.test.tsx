/**
 * EF-38 Production Path Tests
 * 
 * These tests verify the actual production behavior of the interrupted generation recovery.
 * They use a stateful persistence adapter and real unmount to test the full lifecycle.
 */

import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';
import { ChatProvider, useChat } from '../contexts/ChatContext';

// Stateful in-memory storage
const createMemoryStorage = () => {
  let storage: Record<string, string> = {};
  return {
    getItem: jest.fn(async (key: string) => storage[key] || null),
    setItem: jest.fn(async (key: string, value: string) => { storage[key] = value; }),
    removeItem: jest.fn(async (key: string) => { delete storage[key]; }),
    clear: jest.fn(async () => { storage = {}; }),
    getAllKeys: jest.fn(async () => Object.keys(storage)),
    multiGet: jest.fn(async (keys: string[]) => keys.map(k => [k, storage[k] || null])),
    multiSet: jest.fn(async (pairs: [string, string][]) => { pairs.forEach(([k, v]) => { storage[k] = v; }); }),
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(k => delete storage[k]); }),
    multiMerge: jest.fn(async () => {}),
    _storage: storage,
    _reset: () => { storage = {}; },
  };
};

// Stateful session store
const createMemorySessionStore = () => {
  let sessions: any[] = [];
  return {
    getChatSessions: jest.fn(async () => sessions),
    saveChatSessions: jest.fn(async (newSessions: any[]) => { sessions = [...newSessions]; }),
    addChatSession: jest.fn(async (session: any) => { sessions.push(session); }),
    updateChatSession: jest.fn(async (id: string, updates: any) => {
      sessions = sessions.map(s => s.id === id ? { ...s, ...updates } : s);
    }),
    deleteChatSession: jest.fn(async (id: string) => {
      sessions = sessions.filter(s => s.id !== id);
    }),
    _sessions: sessions,
    _reset: () => { sessions = []; },
  };
};

// Create mock instances
const memoryStorage = createMemoryStorage();
const memorySessionStore = createMemorySessionStore();

// Mock dependencies - use inline object definitions
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => memoryStorage._storage[key] || null),
    setItem: jest.fn(async (key: string, value: string) => { memoryStorage._storage[key] = value; }),
    removeItem: jest.fn(async (key: string) => { delete memoryStorage._storage[key]; }),
  },
}));

jest.mock('../stores/sessionStore', () => ({
  __esModule: true,
  getChatSessions: jest.fn(async () => memorySessionStore._sessions),
  saveChatSessions: jest.fn(async (newSessions: any[]) => { memorySessionStore._sessions = [...newSessions]; }),
  addChatSession: jest.fn(async (session: any) => { memorySessionStore._sessions.push(session); }),
  updateChatSession: jest.fn(async (id: string, updates: any) => {
    memorySessionStore._sessions = memorySessionStore._sessions.map(s => s.id === id ? { ...s, ...updates } : s);
  }),
  deleteChatSession: jest.fn(async (id: string) => {
    memorySessionStore._sessions = memorySessionStore._sessions.filter(s => s.id !== id);
  }),
  persistMessage: jest.fn(async () => {}),
}));

jest.mock('../api/cozeApi', () => ({
  __esModule: true,
  chatStart: jest.fn(),
  chatStream: jest.fn(),
  persistMessage: jest.fn(),
}));

jest.mock('../constants/roles', () => ({
  __esModule: true,
  roles: [
    { id: 'clever-fox', name: '聪明狐狸', avatar: '', description: '' },
  ],
}));

// Import mocked modules
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as sessionStore from '../stores/sessionStore';
import * as cozeApi from '../api/cozeApi';

// Test component that exposes context
let contextRef: any = null;
const TestConsumer: React.FC = () => {
  const context = useChat();
  contextRef = context;
  return null;
};

describe('EF-38 Production Path Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    contextRef = null;
    // Reset storage
    memoryStorage._reset();
    memorySessionStore._reset();
  });

  describe('Test 1: Normal valid Deep settles as completed without timeout', () => {
    it('should settle stream as completed when valid Deep content is received', async () => {
      const startTime = Date.now();
      
      // Setup mocks
      (cozeApi.chatStart as jest.Mock).mockResolvedValue({
        sessionId: 'backend-uuid-123',
        conversationId: 'conv-123',
      });
      
      (cozeApi.chatStream as jest.Mock).mockImplementation((params) => {
        // Simulate valid Deep content
        setTimeout(() => {
          params.onEvent({ event: 'deep', data: { content: 'Valid Deep response' } });
          params.onDone();
        }, 100);
        return Promise.resolve();
      });

      // Render provider
      await render(
        <ChatProvider>
          <TestConsumer />
        </ChatProvider>
      );

      // Wait for context to be ready
      await waitFor(() => expect(contextRef).not.toBeNull());

      // Create new chat and send message
      await act(async () => {
        await contextRef.createNewChat();
      });

      await act(async () => {
        await contextRef.sendMessage('Hello');
      });

      // Wait for completion
      await waitFor(() => {
        expect(contextRef.chatPhase).toBe('done');
      }, { timeout: 5000 });

      const duration = Date.now() - startTime;
      
      // Should complete quickly, not wait for 30-second timeout
      expect(duration).toBeLessThan(5000);
      expect(contextRef.turnStatus).toBe('completed');
    });
  });

  describe('Test 2: Generating Session is produced by real send path', () => {
    it('should persist session with turnStatus=generating before chatStart', async () => {
      let chatStartCalled = false;
      let generatingPersistedBeforeChatStart = false;

      // Setup mocks
      (cozeApi.chatStart as jest.Mock).mockImplementation(async () => {
        // Check if generating state was persisted before chatStart
        const currentSessions = await sessionStore.getChatSessions();
        generatingPersistedBeforeChatStart = currentSessions.some((s: any) => s.turnStatus === 'generating');
        chatStartCalled = true;
        return { sessionId: 'backend-uuid-123', conversationId: 'conv-123' };
      });

      (cozeApi.chatStream as jest.Mock).mockImplementation((params) => {
        setTimeout(() => {
          params.onEvent({ event: 'deep', data: { content: 'Response' } });
          params.onDone();
        }, 50);
        return Promise.resolve();
      });

      // Render provider
      await render(
        <ChatProvider>
          <TestConsumer />
        </ChatProvider>
      );

      await waitFor(() => expect(contextRef).not.toBeNull());

      await act(async () => {
        await contextRef.createNewChat();
      });

      await act(async () => {
        await contextRef.sendMessage('Hello');
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
      (cozeApi.chatStart as jest.Mock).mockResolvedValue({
        sessionId: 'backend-uuid-123',
        conversationId: 'conv-123',
      });

      (cozeApi.chatStream as jest.Mock).mockImplementation(() => {
        // Never call onDone - simulate hanging stream
        return new Promise(() => {});
      });

      // First render
      const render1 = await render(
        <ChatProvider>
          <TestConsumer />
        </ChatProvider>
      );

      await waitFor(() => expect(contextRef).not.toBeNull());

      await act(async () => {
        await contextRef.createNewChat();
      });

      // Start message but don't wait for completion
      act(() => {
        contextRef.sendMessage('Hello');
      });

      // Wait a bit for generating state to be persisted
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Unmount first provider
      render1.unmount();

      // Wait for unmount to settle
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Second render - should hydrate from storage
      contextRef = null;
      const render2 = await render(
        <ChatProvider>
          <TestConsumer />
        </ChatProvider>
      );

      // Wait for context to be ready
      await waitFor(() => expect(contextRef).not.toBeNull());

      // Verify interrupted state
      await waitFor(() => {
        expect(contextRef.turnStatus).toBe('interrupted');
      });

      expect(contextRef.chatPhase).not.toBe('responding');
      expect(contextRef.isThinking).toBe(false);
      expect(contextRef.isLoading).toBe(false);

      render2.unmount();
    });
  });

  describe('Test 6: Original user-message ID remains unchanged after retry', () => {
    it('should reuse original user message ID on retry', async () => {
      // Setup mocks
      (cozeApi.chatStart as jest.Mock).mockResolvedValue({
        sessionId: 'backend-uuid-123',
        conversationId: 'conv-123',
      });

      let callCount = 0;
      (cozeApi.chatStream as jest.Mock).mockImplementation((params) => {
        callCount++;
        if (callCount === 1) {
          // First call - error
          setTimeout(() => {
            params.onError(new Error('Stream error'));
          }, 50);
        } else {
          // Second call (retry) - success
          setTimeout(() => {
            params.onEvent({ event: 'deep', data: { content: 'Retry response' } });
            params.onDone();
          }, 50);
        }
        return Promise.resolve();
      });

      // Render provider
      await render(
        <ChatProvider>
          <TestConsumer />
        </ChatProvider>
      );

      await waitFor(() => expect(contextRef).not.toBeNull());

      await act(async () => {
        await contextRef.createNewChat();
      });

      // First send - will fail
      await act(async () => {
        await contextRef.sendMessage('Hello');
      });

      // Wait for error state
      await waitFor(() => {
        expect(contextRef.turnStatus).toBe('failed');
      });

      // Get the user message ID from the session
      const currentSessions = await sessionStore.getChatSessions();
      const session = currentSessions[0];
      const firstUserMessageId = session.messages.find((m: any) => m.role === 'user')?.id;

      // Retry
      await act(async () => {
        await contextRef.retryLastMessage();
      });

      // Wait for completion
      await waitFor(() => {
        expect(contextRef.chatPhase).toBe('done');
      });

      // Get the user message ID after retry
      const sessionsAfterRetry = await sessionStore.getChatSessions();
      const sessionAfterRetry = sessionsAfterRetry[0];
      const secondUserMessageId = sessionAfterRetry.messages.find((m: any) => m.role === 'user')?.id;

      // User message ID should be the same
      expect(firstUserMessageId).toBe(secondUserMessageId);
      
      // User message should exist exactly once
      const userMessages = sessionAfterRetry.messages.filter((m: any) => m.role === 'user');
      expect(userMessages.length).toBe(1);
    });
  });

  describe('Test 9: onError settles without timeout', () => {
    it('should settle stream as error immediately when onError is called', async () => {
      const startTime = Date.now();

      // Setup mocks
      (cozeApi.chatStart as jest.Mock).mockResolvedValue({
        sessionId: 'backend-uuid-123',
        conversationId: 'conv-123',
      });

      (cozeApi.chatStream as jest.Mock).mockImplementation((params) => {
        // Call onError immediately
        setTimeout(() => {
          params.onError(new Error('Stream error'));
        }, 50);
        return Promise.resolve();
      });

      // Render provider
      await render(
        <ChatProvider>
          <TestConsumer />
        </ChatProvider>
      );

      await waitFor(() => expect(contextRef).not.toBeNull());

      await act(async () => {
        await contextRef.createNewChat();
      });

      await act(async () => {
        await contextRef.sendMessage('Hello');
      });

      // Wait for error state
      await waitFor(() => {
        expect(contextRef.turnStatus).toBe('failed');
      }, { timeout: 5000 });

      const duration = Date.now() - startTime;

      // Should complete quickly, not wait for 30-second timeout
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('Test 12: Old Provider cannot finalize after unmount', () => {
    it('should not call finalizeTurnCompleted after unmount', async () => {
      // Setup mocks
      (cozeApi.chatStart as jest.Mock).mockResolvedValue({
        sessionId: 'backend-uuid-123',
        conversationId: 'conv-123',
      });

      (cozeApi.chatStream as jest.Mock).mockImplementation((params) => {
        // Delay completion until after unmount
        setTimeout(() => {
          params.onEvent({ event: 'deep', data: { content: 'Late response' } });
          params.onDone();
        }, 500);
        return Promise.resolve();
      });

      // First render
      const render1 = await render(
        <ChatProvider>
          <TestConsumer />
        </ChatProvider>
      );

      await waitFor(() => expect(contextRef).not.toBeNull());

      await act(async () => {
        await contextRef.createNewChat();
      });

      // Start message
      act(() => {
        contextRef.sendMessage('Hello');
      });

      // Wait a bit
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Get sessions before unmount
      const sessionsBefore = await sessionStore.getChatSessions();
      const turnStatusBefore = sessionsBefore[0]?.turnStatus;

      // Unmount
      render1.unmount();

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
