/**
 * EF-38 Minimum Closed-Loop Tests
 * 
 * This test file contains three minimum closed-loop tests that demonstrate
 * the production defects and verify the fixes:
 * 
 * Loop A: Completed refresh
 * Loop B: Generating refresh
 * Loop C: Retry after refresh
 */

import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatProvider, useChat } from '../contexts/ChatContext';
import { chatStart, chatStream } from '../api/cozeApi';
import * as sessionStore from '../stores/sessionStore';
import type { ChatSession, ChatMessage, PendingTurn, TurnStatus } from '../types';

// Mock dependencies
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}));

jest.mock('../api/cozeApi', () => ({
  chatStart: jest.fn(),
  chatStream: jest.fn(),
}));

jest.mock('../stores/sessionStore', () => ({
  getChatSessions: jest.fn(),
  saveChatSessions: jest.fn(),
  persistMessage: jest.fn(),
  createConversation: jest.fn(),
  fetchConversation: jest.fn(),
}));

jest.mock('../constants/roles', () => ({
  DEFAULT_ROLE_ID: 'role_1',
  DEFAULT_CONVERSATION_ID: 'conv_1',
  roles: [{ id: 'role-1', name: 'Test Role' }],
}));

// Stateful in-memory storage
const storage: Record<string, string> = {};
(AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => storage[key] || null);
(AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
  storage[key] = value;
});
(AsyncStorage.removeItem as jest.Mock).mockImplementation(async (key: string) => {
  delete storage[key];
});
(AsyncStorage.clear as jest.Mock).mockImplementation(async () => {
  Object.keys(storage).forEach(key => delete storage[key]);
});

// Stateful session store
let storedSessions: ChatSession[] = [];
(sessionStore.getChatSessions as jest.Mock).mockImplementation(async () => storedSessions);
(sessionStore.saveChatSessions as jest.Mock).mockImplementation(async (sessions: ChatSession[]) => {
  storedSessions = [...sessions];
});
(sessionStore.persistMessage as jest.Mock).mockResolvedValue(undefined);
(sessionStore.createConversation as jest.Mock).mockResolvedValue({ id: 'conv_1' });
(sessionStore.fetchConversation as jest.Mock).mockResolvedValue({ id: 'conv_1' });

const mockedChatStart = chatStart as jest.MockedFunction<typeof chatStart>;
const mockedChatStream = chatStream as jest.MockedFunction<typeof chatStream>;

// Stream controller for deterministic testing
interface StreamController {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  onChunk?: (text: string) => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
}

const createStreamController = (): StreamController => {
  let resolve: () => void;
  let reject: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve!, reject: reject! };
};

// Test consumer to capture context
interface CapturedContext {
  isHydrated: boolean;
  chatPhase: string;
  turnStatus: TurnStatus | null;
  pendingTurn: PendingTurn | undefined;
  messages: ChatMessage[];
  sendMessage: (text: string) => Promise<boolean>;
  retryLastMessage: () => Promise<void>;
}

let capturedCtx: CapturedContext | null = null;

const TestConsumer: React.FC<{ onContext: (ctx: CapturedContext) => void }> = ({ onContext }) => {
  const ctx = useChat();
  
  React.useEffect(() => {
    onContext({
      isHydrated: ctx.isHydrated,
      chatPhase: ctx.chatPhase,
      turnStatus: ctx.turnStatus,
      pendingTurn: ctx.pendingTurn,
      messages: ctx.messages,
      sendMessage: ctx.sendMessage,
      retryLastMessage: ctx.retryLastMessage,
    });
  }, [ctx, onContext]);

  return null;
};

describe('EF-38 Minimum Closed-Loop Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storedSessions = [];
    Object.keys(storage).forEach(key => delete storage[key]);
    capturedCtx = null;
  });

  // ─── Loop A: Completed refresh ───
  describe('Loop A: Completed refresh', () => {
    it('should restore completed state after unmount/remount', async () => {
      let streamCtrl: StreamController | null = null;

      mockedChatStart.mockResolvedValue({ sessionId: 'session_1' } as any);
      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        streamCtrl = createStreamController();
        streamCtrl.onChunk = callbacks.onChunk;
        streamCtrl.onDone = callbacks.onDone;
        streamCtrl.onError = callbacks.onError;
        return streamCtrl.promise;
      });

      // Provider A: send message
      const renderResultA = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitFor(() => {
        expect(capturedCtx?.isHydrated).toBe(true);
      });

      const sendPromise = capturedCtx!.sendMessage('Hello');
      
      await waitFor(() => {
        expect(mockedChatStream).toHaveBeenCalled();
      });

      // Complete the stream
      streamCtrl!.onChunk!('{"content":"Response"}');
      streamCtrl!.onDone!();
      streamCtrl!.resolve();
      
      await sendPromise;

      // Wait for completion
      await waitFor(() => {
        expect(capturedCtx?.chatPhase).toBe('done');
      });

      // Verify completed state
      const messagesBeforeUnmount = capturedCtx!.messages;
      expect(messagesBeforeUnmount.length).toBe(2); // user + assistant

      // Unmount Provider A
      await act(async () => {
        renderResultA.unmount();
      });

      // Provider B: remount and verify restoration
      await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitFor(() => {
        expect(capturedCtx?.isHydrated).toBe(true);
      });

      // Verify same messages restored
      expect(capturedCtx!.messages.length).toBe(2);
      expect(capturedCtx!.messages[0].content).toBe('Hello');
      expect(capturedCtx!.messages[1].content).toBe('Response');
      expect(capturedCtx!.chatPhase).toBe('done');
    });
  });

  // ─── Loop B: Generating refresh ───
  describe('Loop B: Generating refresh', () => {
    it('should restore interrupted state after unmount/remount', async () => {
      let streamCtrl: StreamController | null = null;

      mockedChatStart.mockResolvedValue({ sessionId: 'session_1' } as any);
      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        streamCtrl = createStreamController();
        streamCtrl.onChunk = callbacks.onChunk;
        streamCtrl.onDone = callbacks.onDone;
        streamCtrl.onError = callbacks.onError;
        return streamCtrl.promise;
      });

      // Provider A: send message
      const renderResultA = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitFor(() => {
        expect(capturedCtx?.isHydrated).toBe(true);
      });

      const sendPromise = capturedCtx!.sendMessage('Hello');
      
      // Wait for generating state
      await waitFor(() => {
        expect(storedSessions.some(s => s.turnStatus === 'generating')).toBe(true);
      });

      // Verify generating state has pendingTurn
      const generatingSession = storedSessions.find(s => s.turnStatus === 'generating');
      expect(generatingSession?.pendingTurn).toBeDefined();
      expect(generatingSession?.pendingTurn?.userMessageId).toBeDefined();

      // Unmount Provider A (simulating refresh)
      await act(async () => {
        renderResultA.unmount();
      });

      // Abandoned callback should be ignored
      // (In production, this would happen when the old Provider's stream completes)
      // We don't call onDone here to simulate the abandoned request

      // Provider B: remount and verify interrupted state
      await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitFor(() => {
        expect(capturedCtx?.isHydrated).toBe(true);
      });

      // Verify interrupted state restored
      expect(capturedCtx?.turnStatus).toBe('interrupted');
      expect(capturedCtx?.pendingTurn).toBeDefined();
      expect(capturedCtx?.pendingTurn?.userMessageId).toBe(generatingSession?.pendingTurn?.userMessageId);

      // Clean up: resolve the abandoned stream
      streamCtrl!.resolve();
      await sendPromise.catch(() => {}); // Ignore errors from abandoned request
    });
  });

  // ─── Loop C: Retry after refresh ───
  describe('Loop C: Retry after refresh', () => {
    it('should retry with original identity after refresh', async () => {
      let streamCtrl1: StreamController | null = null;
      let streamCtrl2: StreamController | null = null;
      let streamCallCount = 0;

      mockedChatStart.mockResolvedValue({ sessionId: 'session_1' } as any);
      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        streamCallCount++;
        const ctrl = createStreamController();
        
        if (streamCallCount === 1) {
          streamCtrl1 = ctrl;
        } else {
          streamCtrl2 = ctrl;
        }
        
        ctrl.onChunk = callbacks.onChunk;
        ctrl.onDone = callbacks.onDone;
        ctrl.onError = callbacks.onError;
        return ctrl.promise;
      });

      // Provider A: send message
      const renderResultA = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitFor(() => {
        expect(capturedCtx?.isHydrated).toBe(true);
      });

      const sendPromise1 = capturedCtx!.sendMessage('Hello');
      
      // Wait for generating state
      await waitFor(() => {
        expect(storedSessions.some(s => s.turnStatus === 'generating')).toBe(true);
      });

      // Capture original user message ID
      const generatingSession = storedSessions.find(s => s.turnStatus === 'generating');
      const originalUserMessageId = generatingSession?.pendingTurn?.userMessageId;
      expect(originalUserMessageId).toBeDefined();

      // Unmount Provider A (simulating refresh)
      await act(async () => {
        renderResultA.unmount();
      });

      // Provider B: remount and verify interrupted state
      await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitFor(() => {
        expect(capturedCtx?.isHydrated).toBe(true);
        expect(capturedCtx?.turnStatus).toBe('interrupted');
      });

      // Retry
      const retryPromise = capturedCtx!.retryLastMessage();

      // Wait for second request
      await waitFor(() => {
        expect(streamCallCount).toBe(2);
      });

      // Complete the retry stream
      streamCtrl2!.onChunk!('{"content":"Retry Response"}');
      streamCtrl2!.onDone!();
      streamCtrl2!.resolve();

      await retryPromise;

      // Wait for completion
      await waitFor(() => {
        expect(capturedCtx?.chatPhase).toBe('done');
      });

      // Verify exactly one user message and one assistant response
      const userMessages = capturedCtx!.messages.filter(m => m.role === 'user');
      const assistantMessages = capturedCtx!.messages.filter(m => m.role === 'assistant');
      
      expect(userMessages.length).toBe(1);
      expect(assistantMessages.length).toBe(1);
      expect(userMessages[0].id).toBe(originalUserMessageId);
      expect(assistantMessages[0].content).toBe('Retry Response');

      // Clean up: resolve the abandoned stream
      streamCtrl1!.resolve();
      await sendPromise1.catch(() => {}); // Ignore errors from abandoned request
    });
  });
});
