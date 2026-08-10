/**
 * EF-38 Production Path Tests
 * 
 * These tests verify the actual production behavior of the interrupted generation recovery.
 * They use a stateful in-memory persistence adapter that survives Provider unmount/remount.
 * 
 * Required scenarios (Tests 1-12):
 * 1. Normal valid Deep settles as completed without timeout
 * 2. Generating Session is produced by real send path
 * 3. Real Provider unmount/remount converts generating to interrupted
 * 4. Production interruption UI is visible
 * 5. Actual Retry button is clicked
 * 6. Original user-message ID remains unchanged after retry
 * 7. User message exists exactly once
 * 8. Retry completes with exactly one assistant response
 * 9. onError settles without timeout
 * 10. chatStream Promise rejection settles promptly
 * 11. Empty Deep follows the documented fallback
 * 12. Old Provider cannot finalize after unmount
 * 
 * Plus one continuous production-path recovery test.
 */

import React from 'react';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';
import { Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import { ChatProvider, useChat } from '../contexts/ChatContext';
import { MessageList } from '../components/MessageList';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as sessionStore from '../stores/sessionStore';
import * as cozeApi from '../api/cozeApi';
import { roles } from '../constants/roles';

// ============================================================
// StyleSheet.flatten Polyfill for Test Environment
// ============================================================
const originalFlatten = (StyleSheet as any).flatten;
beforeAll(() => {
  if (!(StyleSheet as any).flatten) {
    (StyleSheet as any).flatten = (style: any) => style;
  }
});
afterAll(() => {
  (StyleSheet as any).flatten = originalFlatten;
});

// ============================================================
// Stateful In-Memory Persistence Adapter
// ============================================================
// Session store
let memoryStore: { sessions: any[] } = { sessions: [] };

// AsyncStorage stateful store
let asyncStorageStore: Map<string, string> = new Map();

function resetMemoryStore() {
  memoryStore = { sessions: [] };
  asyncStorageStore = new Map();
}

// Mock AsyncStorage with STATEFUL adapter
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockImplementation(async (key: string, value: string) => {
    asyncStorageStore.set(key, value);
    return undefined;
  }),
  getItem: jest.fn().mockImplementation(async (key: string) => {
    return asyncStorageStore.get(key) ?? null;
  }),
  removeItem: jest.fn().mockImplementation(async (key: string) => {
    asyncStorageStore.delete(key);
    return undefined;
  }),
  clear: jest.fn().mockImplementation(async () => {
    asyncStorageStore.clear();
    resetMemoryStore();
    return undefined;
  }),
}));

// Mock sessionStore with STATEFUL adapter
jest.mock('../stores/sessionStore', () => ({
  saveChatSessions: jest.fn().mockImplementation(async (sessions: any[]) => {
    memoryStore.sessions = JSON.parse(JSON.stringify(sessions));
    return undefined;
  }),
  getChatSessions: jest.fn().mockImplementation(async () => {
    return JSON.parse(JSON.stringify(memoryStore.sessions));
  }),
  persistMessage: jest.fn().mockResolvedValue(undefined),
  createConversation: jest.fn().mockResolvedValue({ id: 'conv-test-123' }),
  fetchConversation: jest.fn().mockResolvedValue(null),
}));

// Mock cozeApi
jest.mock('../api/cozeApi', () => ({
  chatStart: jest.fn(),
  chatStream: jest.fn(),
}));

// Mock roles
jest.mock('../constants/roles', () => ({
  roles: [
    {
      id: 'test-role',
      name: 'Test Role',
      title: 'Test',
      description: 'Test role',
      greeting: 'Hello',
      suggestedQuestions: [],
      model: 'test-model',
    },
  ],
  getRoleById: (id: string) => roles.find(r => r.id === id) || roles[0],
}));

// Mock @expo/vector-icons
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return {
    FontAwesome6: (props: any) => React.createElement('Text', props, props.testID || 'icon'),
    MaterialCommunityIcons: (props: any) => React.createElement('Text', props, props.testID || 'icon'),
  };
});

// ============================================================
// Stream Controller Helper
// ============================================================
interface StreamController {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  callbacks: { onChunk: (chunk: string) => void; onDone: () => void; onError: (error: Error) => void } | null;
}

function createStreamController(): StreamController {
  let resolve: () => void;
  let reject: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve!, reject: reject!, callbacks: null };
}

// ============================================================
// Test Helpers
// ============================================================
function setupChatStartMock() {
  (cozeApi.chatStart as jest.Mock).mockResolvedValue({
    conversationId: 'conv-test-123',
  });
}

function setupChatStreamSuccess(content: string) {
  const controller = createStreamController();
  (cozeApi.chatStream as jest.Mock).mockImplementation(async (sessionId: string, callbacks: any) => {
    controller.callbacks = callbacks;
    // Simulate async stream
    setTimeout(() => {
      callbacks.onChunk(content);
      callbacks.onDone();
      controller.resolve();
    }, 10);
    return controller.promise;
  });
  return controller;
}

function setupChatStreamError(error: Error) {
  const controller = createStreamController();
  (cozeApi.chatStream as jest.Mock).mockImplementation(async (sessionId: string, callbacks: any) => {
    controller.callbacks = callbacks;
    setTimeout(() => {
      callbacks.onError(error);
      controller.reject(error);
    }, 10);
    return controller.promise;
  });
  return controller;
}

function setupChatStreamHanging() {
  const controller = createStreamController();
  (cozeApi.chatStream as jest.Mock).mockImplementation(async (sessionId: string, callbacks: any) => {
    controller.callbacks = callbacks;
    // Never resolves or rejects - truly hanging
    return controller.promise;
  });
  return controller;
}

// ============================================================
// Test Consumer Component
// ============================================================
interface TestConsumerProps {
  onContext: (ctx: any) => void;
}

function TestConsumer({ onContext }: TestConsumerProps) {
  const context = useChat();
  
  React.useEffect(() => {
    onContext(context);
  }, [context, onContext]);
  
  return null;
}

// ============================================================
// Test Setup
// ============================================================
let contextRef: any = null;

function captureContext(ctx: any) {
  contextRef = ctx;
}

async function renderProvider() {
  contextRef = null;
  const renderResult = await render(
    <ChatProvider>
      <TestConsumer onContext={captureContext} />
    </ChatProvider>
  );
  
  // Wait for hydration
  await waitFor(() => {
    expect(contextRef?.isHydrated).toBe(true);
  }, { timeout: 3000 });
  
  return renderResult;
}

// ============================================================
// Reset before each test
// ============================================================
beforeEach(() => {
  jest.clearAllMocks();
  resetMemoryStore();
  // Reset AsyncStorage mock to use stateful implementation
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => {
    return asyncStorageStore.get(key) ?? null;
  });
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
    asyncStorageStore.set(key, value);
    return undefined;
  });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (key: string) => {
    asyncStorageStore.delete(key);
    return undefined;
  });
});

afterEach(async () => {
  contextRef = null;
  jest.clearAllMocks();
  resetMemoryStore();
});

// ============================================================
// Test 1: Normal valid Deep settles as completed without timeout
// ============================================================
describe('Test 1: Normal valid Deep settles as completed without timeout', () => {
  it('should settle stream as completed when valid Deep content is received', async () => {
    setupChatStartMock();
    const streamController = setupChatStreamSuccess('Valid Deep response');
    
    const { unmount } = await renderProvider();
    
    // Send message
    let sendPromise: Promise<void>;
    await act(async () => {
      sendPromise = contextRef.sendMessage('Hello');
    });
    
    // Wait for stream to complete
    await act(async () => {
      await sendPromise;
    });
    
    // Verify completion
    await waitFor(() => {
      expect(contextRef.chatPhase).toBe('done');
    }, { timeout: 2000 });
    
    unmount();
  }, 10000);
});

// ============================================================
// Test 2: Generating Session is produced by real send path
// ============================================================
describe('Test 2: Generating Session is produced by real send path', () => {
  it('should persist session with turnStatus=generating before chatStart', async () => {
    // Track event order
    const eventLog: string[] = [];
    
    (cozeApi.chatStart as jest.Mock).mockImplementation(async () => {
      eventLog.push('chatStart');
      return { conversationId: 'conv-test-123' };
    });
    
    const hangingController = createStreamController();
    (cozeApi.chatStream as jest.Mock).mockImplementation(async (sessionId: string, callbacks: any) => {
      eventLog.push('chatStream');
      hangingController.callbacks = callbacks;
      return hangingController.promise;
    });
    
    // Track save events
    const originalSave = memoryStore.sessions;
    (sessionStore.saveChatSessions as jest.Mock).mockImplementation(async (sessions: any[]) => {
      const generatingSession = sessions.find((s: any) => s.turnStatus === 'generating');
      if (generatingSession) {
        eventLog.push('save:generating');
      }
      memoryStore.sessions = JSON.parse(JSON.stringify(sessions));
      return undefined;
    });
    
    const { unmount } = await renderProvider();
    
    // Send message
    let sendPromise: Promise<void>;
    await act(async () => {
      sendPromise = contextRef.sendMessage('Hello');
    });
    
    // Wait for generating to be persisted
    await waitFor(() => {
      expect(eventLog).toContain('save:generating');
    }, { timeout: 2000 });
    
    // Verify order: save:generating should come before chatStart
    const saveIndex = eventLog.indexOf('save:generating');
    const chatStartIndex = eventLog.indexOf('chatStart');
    expect(saveIndex).toBeLessThan(chatStartIndex);
    
    // Verify generating session structure
    const savedSessions = memoryStore.sessions;
    const generatingSession = savedSessions.find((s: any) => s.turnStatus === 'generating');
    expect(generatingSession).toBeDefined();
    expect(generatingSession.pendingTurn).toBeDefined();
    expect(generatingSession.messages.length).toBeGreaterThan(0);
    
    // Clean up hanging stream
    await act(async () => {
      hangingController.callbacks?.onError(new Error('Test cleanup'));
      hangingController.reject(new Error('Test cleanup'));
      await sendPromise;
    });
    
    unmount();
  }, 10000);
});

// ============================================================
// Test 3: Real Provider unmount/remount converts generating to interrupted
// ============================================================
describe('Test 3: Real Provider unmount/remount converts generating to interrupted', () => {
  it('should convert generating to interrupted after unmount and remount', async () => {
    setupChatStartMock();
    const hangingController = createStreamController();
    (cozeApi.chatStream as jest.Mock).mockImplementation(async (sessionId: string, callbacks: any) => {
      hangingController.callbacks = callbacks;
      return hangingController.promise;
    });
    
    // First Provider
    const renderResult1 = await renderProvider();
    
    // Send message
    let sendPromise: Promise<void>;
    await act(async () => {
      sendPromise = contextRef.sendMessage('Hello');
    });
    
    // Wait for generating state
    await waitFor(() => {
      expect(contextRef.turnStatus).toBe('generating');
    });
    
    // Verify generating was persisted
    const sessionsBeforeUnmount = memoryStore.sessions;
    expect(sessionsBeforeUnmount.some((s: any) => s.turnStatus === 'generating')).toBe(true);
    
    // Verify active session ID was persisted
    const activeSessionIdBeforeUnmount = asyncStorageStore.get('current_session_id');
    expect(activeSessionIdBeforeUnmount).toBeDefined();
    
    // Unmount first Provider
    await act(async () => {
      renderResult1.unmount();
    });
    
    // Verify sessions survived unmount
    const sessionsAfterUnmount = memoryStore.sessions;
    expect(sessionsAfterUnmount.length).toBeGreaterThan(0);
    
    // Verify active session ID survived unmount
    const activeSessionIdAfterUnmount = asyncStorageStore.get('current_session_id');
    expect(activeSessionIdAfterUnmount).toBe(activeSessionIdBeforeUnmount);
    
    // Second Provider (remount)
    const renderResult2 = await renderProvider();
    
    // Wait for hydration and interrupted state
    await waitFor(() => {
      expect(contextRef.isHydrated).toBe(true);
      expect(contextRef.turnStatus).toBe('interrupted');
    }, { timeout: 3000 });
    
    // Clean up
    await act(async () => {
      renderResult2.unmount();
    });
  }, 15000);
});

// ============================================================
// Test 4: Production interruption UI is visible
// ============================================================
describe('Test 4: Production interruption UI is visible', () => {
  it('should render the actual MessageList interruption UI when turnStatus is interrupted', async () => {
    // Pre-load an interrupted session
    const interruptedSession = {
      id: 'session-interrupted',
      roleId: 'test-role',
      conversationId: 'conv-test-123',
      messages: [
        { id: 'msg-1', role: 'user', content: 'Hello', createdAt: Date.now() },
      ],
      turnStatus: 'interrupted',
      pendingTurn: {
        userMessageId: 'msg-1',
        userMessageContent: 'Hello',
        interruptedAt: Date.now(),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    memoryStore.sessions = [interruptedSession];
    asyncStorageStore.set('current_session_id', 'session-interrupted');
    asyncStorageStore.set('current_role_id', 'test-role');
    
    const { unmount, getByText } = await renderProvider();
    
    // Wait for hydration
    await waitFor(() => {
      expect(contextRef.isHydrated).toBe(true);
      expect(contextRef.turnStatus).toBe('interrupted');
    });
    
    // Render MessageList with interrupted state
    const renderResult2 = await render(
      <ChatProvider>
        <MessageList onShowIntro={() => {}} />
      </ChatProvider>
    );
    
    // Verify interruption UI is visible
    await waitFor(() => {
      expect(renderResult2.getByText(/重新生成/)).toBeTruthy();
    });
    
    unmount();
  }, 10000);
});

// ============================================================
// Test 5: Actual Retry button is clicked
// ============================================================
describe('Test 5: Actual Retry button is clicked', () => {
  it('should trigger retry when the production Retry button is pressed', async () => {
    // Pre-load an interrupted session
    const interruptedSession = {
      id: 'session-interrupted',
      roleId: 'test-role',
      conversationId: 'conv-test-123',
      messages: [
        { id: 'msg-1', role: 'user', content: 'Hello', createdAt: Date.now() },
      ],
      turnStatus: 'interrupted',
      pendingTurn: {
        userMessageId: 'msg-1',
        userMessageContent: 'Hello',
        interruptedAt: Date.now(),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    memoryStore.sessions = [interruptedSession];
    asyncStorageStore.set('current_session_id', 'session-interrupted');
    asyncStorageStore.set('current_role_id', 'test-role');
    
    setupChatStartMock();
    const streamController = setupChatStreamSuccess('Retry response');
    
    const { unmount, getByText } = await renderProvider();
    
    // Wait for hydration
    await waitFor(() => {
      expect(contextRef.isHydrated).toBe(true);
      expect(contextRef.turnStatus).toBe('interrupted');
    });
    
    // Render MessageList
    const renderResult2 = await render(
      <ChatProvider>
        <MessageList onShowIntro={() => {}} />
      </ChatProvider>
    );
    
    // Find and click the retry button
    const retryButton = renderResult2.getByText(/重新生成/);
    await act(async () => {
      fireEvent.press(retryButton);
    });
    
    // Wait for completion
    await waitFor(() => {
      expect(contextRef.chatPhase).toBe('done');
    }, { timeout: 5000 });
    
    unmount();
  }, 15000);
});

// ============================================================
// Test 6: Original user-message ID remains unchanged after retry
// ============================================================
describe('Test 6: Original user-message ID remains unchanged after retry', () => {
  it('should reuse original user message ID on retry', async () => {
    const originalUserMessageId = 'msg-original-user';
    
    const interruptedSession = {
      id: 'session-interrupted',
      roleId: 'test-role',
      conversationId: 'conv-test-123',
      messages: [
        { id: originalUserMessageId, role: 'user', content: 'Hello', createdAt: Date.now() },
      ],
      turnStatus: 'interrupted',
      pendingTurn: {
        userMessageId: originalUserMessageId,
        userMessageContent: 'Hello',
        interruptedAt: Date.now(),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    memoryStore.sessions = [interruptedSession];
    asyncStorageStore.set('current_session_id', 'session-interrupted');
    asyncStorageStore.set('current_role_id', 'test-role');
    
    setupChatStartMock();
    setupChatStreamSuccess('Retry response');
    
    const { unmount } = await renderProvider();
    
    await waitFor(() => {
      expect(contextRef.isHydrated).toBe(true);
    });
    
    // Call retryLastMessage
    await act(async () => {
      await contextRef.retryLastMessage();
    });
    
    // Wait for completion
    await waitFor(() => {
      expect(contextRef.chatPhase).toBe('done');
    }, { timeout: 5000 });
    
    // Verify user message ID is unchanged
    const messages = (contextRef as any).messages;
    const userMessages = messages.filter((m: any) => m.role === 'user');
    expect(userMessages.length).toBe(1);
    expect(userMessages[0].id).toBe(originalUserMessageId);
    
    unmount();
  }, 10000);
});

// ============================================================
// Test 7: User message exists exactly once
// ============================================================
describe('Test 7: User message exists exactly once', () => {
  it('should have exactly one user message after retry', async () => {
    const interruptedSession = {
      id: 'session-interrupted',
      roleId: 'test-role',
      conversationId: 'conv-test-123',
      messages: [
        { id: 'msg-1', role: 'user', content: 'Hello', createdAt: Date.now() },
      ],
      turnStatus: 'interrupted',
      pendingTurn: {
        userMessageId: 'msg-1',
        userMessageContent: 'Hello',
        interruptedAt: Date.now(),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    memoryStore.sessions = [interruptedSession];
    asyncStorageStore.set('current_session_id', 'session-interrupted');
    asyncStorageStore.set('current_role_id', 'test-role');
    
    setupChatStartMock();
    setupChatStreamSuccess('Retry response');
    
    const { unmount } = await renderProvider();
    
    await waitFor(() => {
      expect(contextRef.isHydrated).toBe(true);
    });
    
    await act(async () => {
      await contextRef.retryLastMessage();
    });
    
    await waitFor(() => {
      expect(contextRef.chatPhase).toBe('done');
    }, { timeout: 5000 });
    
    const messages = (contextRef as any).messages;
    const userMessages = messages.filter((m: any) => m.role === 'user');
    expect(userMessages.length).toBe(1);
    
    unmount();
  }, 10000);
});

// ============================================================
// Test 8: Retry completes with exactly one assistant response
// ============================================================
describe('Test 8: Retry completes with exactly one assistant response', () => {
  it('should have exactly one assistant response after retry', async () => {
    const interruptedSession = {
      id: 'session-interrupted',
      roleId: 'test-role',
      conversationId: 'conv-test-123',
      messages: [
        { id: 'msg-1', role: 'user', content: 'Hello', createdAt: Date.now() },
      ],
      turnStatus: 'interrupted',
      pendingTurn: {
        userMessageId: 'msg-1',
        userMessageContent: 'Hello',
        interruptedAt: Date.now(),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    memoryStore.sessions = [interruptedSession];
    asyncStorageStore.set('current_session_id', 'session-interrupted');
    asyncStorageStore.set('current_role_id', 'test-role');
    
    setupChatStartMock();
    setupChatStreamSuccess('Retry response');
    
    const { unmount } = await renderProvider();
    
    await waitFor(() => {
      expect(contextRef.isHydrated).toBe(true);
    });
    
    await act(async () => {
      await contextRef.retryLastMessage();
    });
    
    await waitFor(() => {
      expect(contextRef.chatPhase).toBe('done');
    }, { timeout: 5000 });
    
    const messages = (contextRef as any).messages;
    const assistantMessages = messages.filter((m: any) => m.role === 'assistant');
    expect(assistantMessages.length).toBe(1);
    
    unmount();
  }, 10000);
});

// ============================================================
// Test 9: onError settles without timeout
// ============================================================
describe('Test 9: onError settles without timeout', () => {
  it('should settle stream as error immediately when onError is called', async () => {
    setupChatStartMock();
    setupChatStreamError(new Error('Test error'));
    
    const { unmount } = await renderProvider();
    
    await act(async () => {
      await contextRef.sendMessage('Hello');
    });
    
    await waitFor(() => {
      expect(contextRef.turnStatus).toBe('failed');
    }, { timeout: 2000 });
    
    unmount();
  }, 10000);
});

// ============================================================
// Test 10: chatStream Promise rejection settles promptly
// ============================================================
describe('Test 10: chatStream Promise rejection settles promptly', () => {
  it('should settle stream as error when chatStream promise rejects', async () => {
    setupChatStartMock();
    
    (cozeApi.chatStream as jest.Mock).mockRejectedValue(new Error('Stream rejected'));
    
    const { unmount } = await renderProvider();
    
    await act(async () => {
      await contextRef.sendMessage('Hello');
    });
    
    await waitFor(() => {
      expect(contextRef.turnStatus).toBe('failed');
    }, { timeout: 2000 });
    
    unmount();
  }, 10000);
});

// ============================================================
// Test 11: Empty Deep follows the documented fallback
// ============================================================
describe('Test 11: Empty Deep follows the documented fallback', () => {
  it('should handle empty Deep content according to fallback logic', async () => {
    setupChatStartMock();
    setupChatStreamSuccess(''); // Empty content
    
    const { unmount } = await renderProvider();
    
    await act(async () => {
      await contextRef.sendMessage('Hello');
    });
    
    // Wait for completion
    await waitFor(() => {
      expect(contextRef.chatPhase).toBe('done');
    }, { timeout: 5000 });
    
    // Verify fallback behavior
    const messages = (contextRef as any).messages;
    const assistantMessages = messages.filter((m: any) => m.role === 'assistant');
    expect(assistantMessages.length).toBe(1);
    
    unmount();
  }, 10000);
});

// ============================================================
// Test 12: Old Provider cannot finalize after unmount
// ============================================================
describe('Test 12: Old Provider cannot finalize after unmount', () => {
  it('should not call finalizeTurnCompleted after unmount', async () => {
    setupChatStartMock();
    const hangingController = createStreamController();
    (cozeApi.chatStream as jest.Mock).mockImplementation(async (sessionId: string, callbacks: any) => {
      hangingController.callbacks = callbacks;
      return hangingController.promise;
    });
    
    const renderResult = await renderProvider();
    
    let sendPromise: Promise<void>;
    await act(async () => {
      sendPromise = contextRef.sendMessage('Hello');
    });
    
    await waitFor(() => {
      expect(contextRef.turnStatus).toBe('generating');
    });
    
    // Unmount
    await act(async () => {
      renderResult.unmount();
    });
    
    // Try to finalize from old callbacks
    await act(async () => {
      hangingController.callbacks?.onDone();
      hangingController.resolve();
      await sendPromise;
    });
    
    // Verify completed was not persisted
    const sessions = memoryStore.sessions;
    const completedSession = sessions.find((s: any) => s.turnStatus === 'completed');
    expect(completedSession).toBeUndefined();
  }, 10000);
});

// ============================================================
// Continuous: Full recovery chain
// ============================================================
describe('Continuous: Full recovery chain', () => {
  it('should complete the full recovery chain: send -> generating -> unmount -> remount -> interrupted -> retry -> completed', async () => {
    setupChatStartMock();
    const hangingController = createStreamController();
    (cozeApi.chatStream as jest.Mock).mockImplementation(async (sessionId: string, callbacks: any) => {
      hangingController.callbacks = callbacks;
      return hangingController.promise;
    });
    
    // Step 1: First Provider - send and get generating state
    const renderResult1 = await renderProvider();
    
    let sendPromise: Promise<void>;
    await act(async () => {
      sendPromise = contextRef.sendMessage('Hello');
    });
    
    await waitFor(() => {
      expect(contextRef.turnStatus).toBe('generating');
    });
    
    const originalUserMessageId = (contextRef as any).messages.find((m: any) => m.role === 'user')?.id;
    expect(originalUserMessageId).toBeDefined();
    
    // Step 2: Unmount first Provider
    await act(async () => {
      renderResult1.unmount();
    });
    
    // Step 3: Remount second Provider
    const renderResult2 = await renderProvider();
    
    await waitFor(() => {
      expect(contextRef.isHydrated).toBe(true);
      expect(contextRef.turnStatus).toBe('interrupted');
    }, { timeout: 3000 });
    
    // Step 4: Setup successful stream for retry
    setupChatStreamSuccess('Retry response');
    
    // Step 5: Click retry button via production UI
    const renderResult3 = await render(
      <ChatProvider>
        <MessageList onShowIntro={() => {}} />
      </ChatProvider>
    );
    
    const retryButton = renderResult3.getByText(/重新生成/);
    await act(async () => {
      fireEvent.press(retryButton);
    });
    
    // Step 6: Wait for completion
    await waitFor(() => {
      expect(contextRef.chatPhase).toBe('done');
    }, { timeout: 5000 });
    
    // Step 7: Verify final state
    const messages = (contextRef as any).messages;
    const userMessages = messages.filter((m: any) => m.role === 'user');
    const assistantMessages = messages.filter((m: any) => m.role === 'assistant');
    
    expect(userMessages.length).toBe(1);
    expect(userMessages[0].id).toBe(originalUserMessageId);
    expect(assistantMessages.length).toBe(1);
    
    // Step 8: Verify completed was persisted
    const sessions = memoryStore.sessions;
    const completedSession = sessions.find((s: any) => s.turnStatus === 'completed');
    expect(completedSession).toBeDefined();
    
    await act(async () => {
      renderResult2.unmount();
    });
  }, 20000);
});
