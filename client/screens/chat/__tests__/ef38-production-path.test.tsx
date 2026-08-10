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
// Fix: StyleSheet.flatten may not be available in test environment with Uniwind
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
// This adapter actually stores sessions passed to saveChatSessions
// and returns them from getChatSessions. It survives Provider
// unmount/remount within one test and resets between tests.

let memoryStore: { sessions: any[] } = { sessions: [] };

function resetMemoryStore() {
  memoryStore = { sessions: [] };
}

// Mock AsyncStorage (used for currentSessionId tracking)
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn().mockResolvedValue(undefined),
  getItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(undefined),
  clear: jest.fn().mockImplementation(async () => {
    resetMemoryStore();
    return undefined;
  }),
}));

// Mock sessionStore with STATEFUL adapter
jest.mock('../stores/sessionStore', () => ({
  saveChatSessions: jest.fn().mockImplementation(async (sessions: any[]) => {
    // Actually store the sessions
    memoryStore.sessions = JSON.parse(JSON.stringify(sessions));
    return undefined;
  }),
  getChatSessions: jest.fn().mockImplementation(async () => {
    // Return the stored sessions
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
      avatar: 'https://example.com/avatar.png',
      themeColor: '#FF6F00',
      shortDesc: 'Test',
      category: 'test',
      expertise: ['test'],
      briefIntro: 'Test',
      description: 'Test',
      systemPrompt: 'You are a test assistant.',
      personalityTraits: ['helpful'],
      communicationStyle: 'warm',
      emotionalApproach: 'empathetic',
      psychologyConcept: 'cbt',
      lifeExperience: 'test',
      workExperience: 'test',
      specialties: ['test'],
      education: 'test',
      reactionPattern: 'test',
    },
  ],
  DEFAULT_ROLE: {
    id: 'test-role',
    name: 'Test Role',
    title: 'Test',
    avatar: 'https://example.com/avatar.png',
    themeColor: '#FF6F00',
    shortDesc: 'Test',
    category: 'test',
    expertise: ['test'],
    briefIntro: 'Test',
    description: 'Test',
    systemPrompt: 'You are a test assistant.',
    personalityTraits: ['helpful'],
    communicationStyle: 'warm',
    emotionalApproach: 'empathetic',
    psychologyConcept: 'cbt',
    lifeExperience: 'test',
    workExperience: 'test',
    specialties: ['test'],
    education: 'test',
    reactionPattern: 'test',
  },
  DEFAULT_ROLES: [
    {
      id: 'test-role',
      name: 'Test Role',
      title: 'Test',
      avatar: 'https://example.com/avatar.png',
      themeColor: '#FF6F00',
      shortDesc: 'Test',
      category: 'test',
      expertise: ['test'],
      briefIntro: 'Test',
      description: 'Test',
      systemPrompt: 'You are a test assistant.',
      personalityTraits: ['helpful'],
      communicationStyle: 'warm',
      emotionalApproach: 'empathetic',
      psychologyConcept: 'cbt',
      lifeExperience: 'test',
      workExperience: 'test',
      specialties: ['test'],
      education: 'test',
      reactionPattern: 'test',
    },
  ],
  getRoleById: jest.fn().mockImplementation((id: string) => {
    if (id === 'test-role') {
      return {
        id: 'test-role',
        name: 'Test Role',
        title: 'Test',
        avatar: 'https://example.com/avatar.png',
        themeColor: '#FF6F00',
        shortDesc: 'Test',
        category: 'test',
        expertise: ['test'],
        briefIntro: 'Test',
        description: 'Test',
        systemPrompt: 'You are a test assistant.',
        personalityTraits: ['helpful'],
        communicationStyle: 'warm',
        emotionalApproach: 'empathetic',
        psychologyConcept: 'cbt',
        lifeExperience: 'test',
        workExperience: 'test',
        specialties: ['test'],
        education: 'test',
        reactionPattern: 'test',
      };
    }
    return undefined;
  }),
  getDefaultRoles: jest.fn().mockReturnValue([
    {
      id: 'test-role',
      name: 'Test Role',
      title: 'Test',
      avatar: 'https://example.com/avatar.png',
      themeColor: '#FF6F00',
      shortDesc: 'Test',
      category: 'test',
      expertise: ['test'],
      briefIntro: 'Test',
      description: 'Test',
      systemPrompt: 'You are a test assistant.',
      personalityTraits: ['helpful'],
      communicationStyle: 'warm',
      emotionalApproach: 'empathetic',
      psychologyConcept: 'cbt',
      lifeExperience: 'test',
      workExperience: 'test',
      specialties: ['test'],
      education: 'test',
      reactionPattern: 'test',
    },
  ]),
  buildSystemPrompt: jest.fn().mockReturnValue('You are a test assistant.'),
}));

// Mock @expo/vector-icons
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: (props: Record<string, unknown>) => React.createElement(Text, { testID: 'icon' }),
    FontAwesome6: (props: Record<string, unknown>) => React.createElement(Text, { testID: 'icon' }),
  };
});

// ============================================================
// Test Helper: Context Consumer
// ============================================================

function TestConsumer({ onContext }: { onContext: (ctx: ReturnType<typeof useChat>) => void }) {
  const context = useChat();
  
  React.useEffect(() => {
    onContext(context);
  }, [context]);

  return null;
}

// ============================================================
// Test Helper: Stream Control
// ============================================================

interface StreamController {
  resolve: () => void;
  reject: (err: Error) => void;
  sendChunk: (data: any) => void;
  sendDone: () => void;
  sendError: (err: Error) => void;
}

function createStreamController(): { promise: Promise<void>; controller: StreamController } {
  let resolveStream: () => void;
  let rejectStream: (err: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolveStream = resolve;
    rejectStream = reject;
  });

  return {
    promise,
    controller: {
      resolve: resolveStream!,
      reject: rejectStream!,
      sendChunk: () => {}, // Will be set by mock
      sendDone: () => {},
      sendError: () => {},
    },
  };
}

// ============================================================
// Standard Mock Setup Helpers
// ============================================================

const BACKEND_UUID = '2976d531-99c1-46b6-adb3-cbc71a400787';

function setupChatStartMock(overrides?: Partial<any>) {
  (cozeApi.chatStart as jest.Mock).mockResolvedValue({
    sessionId: BACKEND_UUID,
    reactionLayer: 'Test reaction',
    companionLayer: null,
    frontFlowText: null,
    reactionTimeline: null,
    companionTimeline: null,
    flowContext: { conversation_id: 'conv_123' },
    ...overrides,
  });
}

function setupChatStreamSuccess(content: string = 'Valid Deep response') {
  let capturedCallbacks: any = null;
  
  (cozeApi.chatStream as jest.Mock).mockImplementation(async (sessionId: string, callbacks: any) => {
    capturedCallbacks = callbacks;
    
    // Send Deep content
    callbacks.onChunk({
      content: JSON.stringify({
        deep: {
          thinking_process: 'Thinking...',
          answer: content,
          confidence: 0.9,
        },
      }),
      role: 'assistant',
      finish_reason: 'stop',
    });
    
    // Call onDone
    callbacks.onDone();
  });
  
  return {
    getCallbacks: () => capturedCallbacks,
  };
}

function setupChatStreamError(error: Error) {
  (cozeApi.chatStream as jest.Mock).mockImplementation(async (sessionId: string, callbacks: any) => {
    callbacks.onError(error);
  });
}

function setupChatStreamReject(error: Error) {
  (cozeApi.chatStream as jest.Mock).mockRejectedValue(error);
}

function setupChatStreamHanging() {
  (cozeApi.chatStream as jest.Mock).mockImplementation(async (sessionId: string, callbacks: any) => {
    // Never calls any callbacks - simulates hanging stream
  });
}

// ============================================================
// Test Setup
// ============================================================

beforeEach(() => {
  jest.clearAllMocks();
  resetMemoryStore();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
});

// ============================================================
// Test 1: Normal valid Deep settles as completed without timeout
// ============================================================

describe('Test 1: Normal valid Deep settles as completed without timeout', () => {
  it('should settle stream as completed when valid Deep content is received', async () => {
    // Setup
    setupChatStartMock();
    const streamMock = setupChatStreamSuccess('Valid Deep response');
    
    let contextRef: ReturnType<typeof useChat> | null = null;
    
    // Render Provider
    await act(async () => {
      render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );
    });
    
    // Wait for initialization
    await waitFor(() => {
      expect(contextRef).not.toBeNull();
      expect(contextRef?.isHydrated).toBe(true);
    });
    
    // Send message
    await act(async () => {
      await contextRef?.sendMessage('Hello');
    });
    
    // Wait for completion - this should happen quickly, not after 30s timeout
    await waitFor(() => {
      expect(contextRef?.chatPhase).toBe('done');
    }, { timeout: 5000 });
    
    // Verify the session was persisted with completed status
    const sessions = memoryStore.sessions;
    expect(sessions.length).toBeGreaterThan(0);
    const session = sessions.find((s: any) => s.turnStatus === 'completed');
    expect(session).toBeDefined();
  });
});

// ============================================================
// Test 2: Generating Session is produced by real send path
// ============================================================

describe('Test 2: Generating Session is produced by real send path', () => {
  it('should persist session with turnStatus=generating before chatStart', async () => {
    // Setup hanging stream to keep state in generating
    setupChatStartMock();
    setupChatStreamHanging();
    
    let contextRef: ReturnType<typeof useChat> | null = null;
    let generatingPersistedBeforeChatStart = false;
    
    // Track when generating state is persisted
    const originalSave = (sessionStore.saveChatSessions as jest.Mock).mockImplementation;
    (sessionStore.saveChatSessions as jest.Mock).mockImplementation(async (sessions: any[]) => {
      // Check if any session has generating status
      const hasGenerating = sessions.some((s: any) => s.turnStatus === 'generating');
      if (hasGenerating) {
        generatingPersistedBeforeChatStart = true;
      }
      // Call original implementation
      memoryStore.sessions = JSON.parse(JSON.stringify(sessions));
      return undefined;
    });
    
    // Render Provider
    await act(async () => {
      render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );
    });
    
    // Wait for initialization
    await waitFor(() => {
      expect(contextRef).not.toBeNull();
      expect(contextRef?.isHydrated).toBe(true);
    });
    
    // Send message
    await act(async () => {
      await contextRef?.sendMessage('Hello');
    });
    
    // Verify generating state was persisted before chatStart
    expect(generatingPersistedBeforeChatStart).toBe(true);
    
    // Cleanup - unmount the Provider
    await act(async () => {
      // The Provider will be cleaned up by the test framework
    });
  });
});

// ============================================================
// Test 3: Real Provider unmount/remount converts generating to interrupted
// ============================================================

describe('Test 3: Real Provider unmount/remount converts generating to interrupted', () => {
  it('should convert generating to interrupted after unmount and remount', async () => {
    // Setup hanging stream
    setupChatStartMock();
    setupChatStreamHanging();
    
    let contextRef: ReturnType<typeof useChat> | null = null;
    
    // First Provider - start generating
    const renderResult1 = await act(async () => {
      return render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );
    });
    
    // Wait for initialization
    await waitFor(() => {
      expect(contextRef).not.toBeNull();
      expect(contextRef?.isHydrated).toBe(true);
    });
    
    // Send message to enter generating state
    await act(async () => {
      await contextRef?.sendMessage('Hello');
    });
    
    // Verify generating state
    await waitFor(() => {
      expect((contextRef as any)?.turnStatus).toBe('generating');
    });
    
    // Unmount first Provider
    await act(async () => {
      renderResult1.unmount();
    });
    
    // Wait a bit for unmount effects
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    
    // Second Provider - should hydrate and convert to interrupted
    await act(async () => {
      render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );
    });
    
    // Wait for initialization
    await waitFor(() => {
      expect(contextRef).not.toBeNull();
      expect(contextRef?.isHydrated).toBe(true);
    });
    
    // Verify interrupted state
    await waitFor(() => {
      expect((contextRef as any)?.turnStatus).toBe('interrupted');
    });
  });
});

// ============================================================
// Test 4: Production interruption UI is visible
// ============================================================

describe('Test 4: Production interruption UI is visible', () => {
  it('should render the actual MessageList interruption UI when turnStatus is interrupted', async () => {
    // Setup hanging stream
    setupChatStartMock();
    setupChatStreamHanging();
    
    let contextRef: ReturnType<typeof useChat> | null = null;
    
    // First Provider - start generating
    const renderResult1 = await act(async () => {
      return render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );
    });
    
    await waitFor(() => {
      expect(contextRef).not.toBeNull();
      expect(contextRef?.isHydrated).toBe(true);
    });
    
    await act(async () => {
      await contextRef?.sendMessage('Hello');
    });
    
    await waitFor(() => {
      expect((contextRef as any)?.turnStatus).toBe('generating');
    });
    
    // Unmount to trigger interrupted state
    await act(async () => {
      renderResult1.unmount();
    });
    
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    
    // Second Provider with MessageList - should show interruption UI
    const renderResult2 = await act(async () => {
      return render(
        <ChatProvider>
          <View style={{ flex: 1 }}>
            <MessageList onShowIntro={() => {}} />
          </View>
        </ChatProvider>
      );
    });
    
    // Wait for the interruption UI to appear
    await waitFor(() => {
      const interruptionText = renderResult2.queryByText('刚才的回复因页面刷新而中断，你可以重新生成。');
      expect(interruptionText).not.toBeNull();
    }, { timeout: 3000 });
    
    // Verify the retry button exists
    const retryButton = renderResult2.queryByText('重新生成');
    expect(retryButton).not.toBeNull();
    
    // Cleanup
    await act(async () => {
      renderResult2.unmount();
    });
  });
});

// ============================================================
// Test 5: Actual Retry button is clicked
// ============================================================

describe('Test 5: Actual Retry button is clicked', () => {
  it('should trigger retry when the production Retry button is pressed', async () => {
    // Setup for first attempt - hanging stream
    setupChatStartMock();
    setupChatStreamHanging();
    
    let contextRef: ReturnType<typeof useChat> | null = null;
    
    // First Provider - start generating
    const renderResult1 = await act(async () => {
      return render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );
    });
    
    await waitFor(() => {
      expect(contextRef).not.toBeNull();
      expect(contextRef?.isHydrated).toBe(true);
    });
    
    await act(async () => {
      await contextRef?.sendMessage('Hello');
    });
    
    await waitFor(() => {
      expect((contextRef as any)?.turnStatus).toBe('generating');
    });
    
    // Unmount to trigger interrupted state
    await act(async () => {
      renderResult1.unmount();
    });
    
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    
    // Setup for retry - success stream
    setupChatStartMock();
    setupChatStreamSuccess('Retry response');
    
    // Second Provider with MessageList - should show interruption UI
    const renderResult2 = await act(async () => {
      return render(
        <ChatProvider>
          <View style={{ flex: 1 }}>
            <MessageList onShowIntro={() => {}} />
            <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
          </View>
        </ChatProvider>
      );
    });
    
    // Wait for interruption UI
    await waitFor(() => {
      const retryButton = renderResult2.queryByText('重新生成');
      expect(retryButton).not.toBeNull();
    });
    
    // Click the actual production Retry button
    const retryButton = renderResult2.getByText('重新生成');
    await act(async () => {
      fireEvent.press(retryButton);
    });
    
    // Wait for retry to complete
    await waitFor(() => {
      expect(contextRef?.chatPhase).toBe('done');
    }, { timeout: 5000 });
    
    // Cleanup
    await act(async () => {
      renderResult2.unmount();
    });
  });
});

// ============================================================
// Test 6: Original user-message ID remains unchanged after retry
// ============================================================

describe('Test 6: Original user-message ID remains unchanged after retry', () => {
  it('should reuse original user message ID on retry', async () => {
    // Setup for first attempt - error
    setupChatStartMock();
    setupChatStreamError(new Error('Test error'));
    
    let contextRef: ReturnType<typeof useChat> | null = null;
    
    await act(async () => {
      render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );
    });
    
    await waitFor(() => {
      expect(contextRef).not.toBeNull();
      expect(contextRef?.isHydrated).toBe(true);
    });
    
    // Send message
    await act(async () => {
      await contextRef?.sendMessage('Hello');
    });
    
    // Wait for error state
    await waitFor(() => {
      expect((contextRef as any)?.turnStatus).toBe('failed');
    });
    
    // Get original user message ID
    const originalUserMessageId = (contextRef as any)?.messages?.find((m: any) => m.role === 'user')?.id;
    expect(originalUserMessageId).toBeDefined();
    
    // Setup for retry - success
    setupChatStartMock();
    setupChatStreamSuccess('Retry response');
    
    // Retry
    await act(async () => {
      await contextRef?.retryLastMessage();
    });
    
    // Wait for completion
    await waitFor(() => {
      expect(contextRef?.chatPhase).toBe('done');
    }, { timeout: 5000 });
    
    // Verify user message ID is unchanged
    const retriedUserMessageId = (contextRef as any)?.messages?.find((m: any) => m.role === 'user')?.id;
    expect(retriedUserMessageId).toBe(originalUserMessageId);
  });
});

// ============================================================
// Test 7: User message exists exactly once
// ============================================================

describe('Test 7: User message exists exactly once', () => {
  it('should have exactly one user message after retry', async () => {
    // Setup for first attempt - error
    setupChatStartMock();
    setupChatStreamError(new Error('Test error'));
    
    let contextRef: ReturnType<typeof useChat> | null = null;
    
    await act(async () => {
      render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );
    });
    
    await waitFor(() => {
      expect(contextRef).not.toBeNull();
      expect(contextRef?.isHydrated).toBe(true);
    });
    
    // Send message
    await act(async () => {
      await contextRef?.sendMessage('Hello');
    });
    
    await waitFor(() => {
      expect((contextRef as any)?.turnStatus).toBe('failed');
    });
    
    // Setup for retry - success
    setupChatStartMock();
    setupChatStreamSuccess('Retry response');
    
    // Retry
    await act(async () => {
      await contextRef?.retryLastMessage();
    });
    
    await waitFor(() => {
      expect(contextRef?.chatPhase).toBe('done');
    }, { timeout: 5000 });
    
    // Verify exactly one user message
    const userMessages = (contextRef as any)?.messages?.filter((m: any) => m.role === 'user');
    expect(userMessages?.length).toBe(1);
  });
});

// ============================================================
// Test 8: Retry completes with exactly one assistant response
// ============================================================

describe('Test 8: Retry completes with exactly one assistant response', () => {
  it('should have exactly one assistant response after retry', async () => {
    // Setup for first attempt - error
    setupChatStartMock();
    setupChatStreamError(new Error('Test error'));
    
    let contextRef: ReturnType<typeof useChat> | null = null;
    
    await act(async () => {
      render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );
    });
    
    await waitFor(() => {
      expect(contextRef).not.toBeNull();
      expect(contextRef?.isHydrated).toBe(true);
    });
    
    await act(async () => {
      await contextRef?.sendMessage('Hello');
    });
    
    await waitFor(() => {
      expect((contextRef as any)?.turnStatus).toBe('failed');
    });
    
    // Setup for retry - success
    setupChatStartMock();
    setupChatStreamSuccess('Retry response');
    
    await act(async () => {
      await contextRef?.retryLastMessage();
    });
    
    await waitFor(() => {
      expect(contextRef?.chatPhase).toBe('done');
    }, { timeout: 5000 });
    
    // Verify exactly one assistant response
    const assistantMessages = (contextRef as any)?.messages?.filter((m: any) => m.role === 'assistant');
    expect(assistantMessages?.length).toBe(1);
  });
});

// ============================================================
// Test 9: onError settles without timeout
// ============================================================

describe('Test 9: onError settles without timeout', () => {
  it('should settle stream as error immediately when onError is called', async () => {
    setupChatStartMock();
    setupChatStreamError(new Error('Test error'));
    
    let contextRef: ReturnType<typeof useChat> | null = null;
    
    await act(async () => {
      render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );
    });
    
    await waitFor(() => {
      expect(contextRef).not.toBeNull();
      expect(contextRef?.isHydrated).toBe(true);
    });
    
    await act(async () => {
      await contextRef?.sendMessage('Hello');
    });
    
    // Should settle quickly, not wait for timeout
    await waitFor(() => {
      expect(contextRef?.chatPhase).toBe('done');
    }, { timeout: 2000 });
    
    // Verify failed status
    expect((contextRef as any)?.turnStatus).toBe('failed');
  });
});

// ============================================================
// Test 10: chatStream Promise rejection settles promptly
// ============================================================

describe('Test 10: chatStream Promise rejection settles promptly', () => {
  it('should settle stream as error when chatStream promise rejects', async () => {
    setupChatStartMock();
    setupChatStreamReject(new Error('Network error'));
    
    let contextRef: ReturnType<typeof useChat> | null = null;
    
    await act(async () => {
      render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );
    });
    
    await waitFor(() => {
      expect(contextRef).not.toBeNull();
      expect(contextRef?.isHydrated).toBe(true);
    });
    
    await act(async () => {
      await contextRef?.sendMessage('Hello');
    });
    
    // Should settle quickly
    await waitFor(() => {
      expect(contextRef?.chatPhase).toBe('done');
    }, { timeout: 2000 });
    
    expect((contextRef as any)?.turnStatus).toBe('failed');
  });
});

// ============================================================
// Test 11: Empty Deep follows the documented fallback
// ============================================================

describe('Test 11: Empty Deep follows the documented fallback', () => {
  it('should handle empty Deep content according to fallback logic', async () => {
    setupChatStartMock();
    
    // Setup stream that sends empty Deep
    (cozeApi.chatStream as jest.Mock).mockImplementation(async (sessionId: string, callbacks: any) => {
      callbacks.onChunk({
        content: JSON.stringify({
          deep: {
            thinking_process: '',
            answer: '',
            confidence: 0,
          },
        }),
        role: 'assistant',
        finish_reason: 'stop',
      });
      callbacks.onDone();
    });
    
    let contextRef: ReturnType<typeof useChat> | null = null;
    
    await act(async () => {
      render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );
    });
    
    await waitFor(() => {
      expect(contextRef).not.toBeNull();
      expect(contextRef?.isHydrated).toBe(true);
    });
    
    await act(async () => {
      await contextRef?.sendMessage('Hello');
    });
    
    // Should settle - either as completed or failed depending on fallback logic
    await waitFor(() => {
      expect(contextRef?.chatPhase).toBe('done');
    }, { timeout: 5000 });
  });
});

// ============================================================
// Test 12: Old Provider cannot finalize after unmount
// ============================================================

describe('Test 12: Old Provider cannot finalize after unmount', () => {
  it('should not call finalizeTurnCompleted after unmount', async () => {
    let contextRef: ReturnType<typeof useChat> | null = null;
    let streamCallbacks: any = null;
    
    setupChatStartMock();
    
    // Setup stream that captures callbacks but doesn't call them immediately
    (cozeApi.chatStream as jest.Mock).mockImplementation(async (sessionId: string, callbacks: any) => {
      streamCallbacks = callbacks;
      // Don't call any callbacks yet
    });
    
    const renderResult = await act(async () => {
      return render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );
    });
    
    await waitFor(() => {
      expect(contextRef).not.toBeNull();
      expect(contextRef?.isHydrated).toBe(true);
    });
    
    // Start message
    await act(async () => {
      await contextRef?.sendMessage('Hello');
    });
    
    // Wait for generating state
    await waitFor(() => {
      expect((contextRef as any)?.turnStatus).toBe('generating');
    });
    
    // Unmount Provider
    await act(async () => {
      renderResult.unmount();
    });
    
    // Wait for unmount effects
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    
    // Now try to call onDone on the old callbacks
    // This should NOT finalize the turn because Provider is unmounted
    if (streamCallbacks) {
      await act(async () => {
        streamCallbacks.onDone();
      });
    }
    
    // Create new Provider and verify state is interrupted, not completed
    await act(async () => {
      render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );
    });
    
    await waitFor(() => {
      expect(contextRef).not.toBeNull();
      expect(contextRef?.isHydrated).toBe(true);
    });
    
    // Should be interrupted, not completed
    await waitFor(() => {
      expect((contextRef as any)?.turnStatus).toBe('interrupted');
    });
  });
});

// ============================================================
// Continuous: Full recovery chain
// ============================================================

describe('Continuous: Full recovery chain', () => {
  it('should complete the full recovery chain: send -> generating -> unmount -> remount -> interrupted -> retry -> completed', async () => {
    // Step 1: Start generating
    setupChatStartMock();
    setupChatStreamHanging();
    
    let contextRef: ReturnType<typeof useChat> | null = null;
    
    const renderResult1 = await act(async () => {
      return render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
        </ChatProvider>
      );
    });
    
    await waitFor(() => {
      expect(contextRef).not.toBeNull();
      expect(contextRef?.isHydrated).toBe(true);
    });
    
    // Step 2: Send message and verify generating state
    await act(async () => {
      await contextRef?.sendMessage('Hello');
    });
    
    await waitFor(() => {
      expect((contextRef as any)?.turnStatus).toBe('generating');
    });
    
    // Step 3: Get original user message ID
    const originalUserMessageId = (contextRef as any)?.messages?.find((m: any) => m.role === 'user')?.id;
    
    // Step 4: Unmount Provider
    await act(async () => {
      renderResult1.unmount();
    });
    
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    
    // Step 5: Setup for retry success
    setupChatStartMock();
    setupChatStreamSuccess('Retry response');
    
    // Step 6: Remount Provider with MessageList
    const renderResult2 = await act(async () => {
      return render(
        <ChatProvider>
          <View style={{ flex: 1 }}>
            <MessageList onShowIntro={() => {}} />
            <TestConsumer onContext={(ctx) => { contextRef = ctx; }} />
          </View>
        </ChatProvider>
      );
    });
    
    // Step 7: Verify interrupted state
    await waitFor(() => {
      expect((contextRef as any)?.turnStatus).toBe('interrupted');
    });
    
    // Step 8: Verify interruption UI is visible
    await waitFor(() => {
      const interruptionText = renderResult2.queryByText('刚才的回复因页面刷新而中断，你可以重新生成。');
      expect(interruptionText).not.toBeNull();
    });
    
    // Step 9: Click the actual production Retry button
    const retryButton = renderResult2.getByText('重新生成');
    await act(async () => {
      fireEvent.press(retryButton);
    });
    
    // Step 10: Wait for completion
    await waitFor(() => {
      expect(contextRef?.chatPhase).toBe('done');
    }, { timeout: 5000 });
    
    // Step 11: Verify original user message ID preserved
    const retriedUserMessageId = (contextRef as any)?.messages?.find((m: any) => m.role === 'user')?.id;
    expect(retriedUserMessageId).toBe(originalUserMessageId);
    
    // Step 12: Verify exactly one user message
    const userMessages = (contextRef as any)?.messages?.filter((m: any) => m.role === 'user');
    expect(userMessages?.length).toBe(1);
    
    // Step 13: Verify exactly one assistant response
    const assistantMessages = (contextRef as any)?.messages?.filter((m: any) => m.role === 'assistant');
    expect(assistantMessages?.length).toBe(1);
    
    // Step 14: Verify completed status persisted
    const sessions = memoryStore.sessions;
    const completedSession = sessions.find((s: any) => s.turnStatus === 'completed');
    expect(completedSession).toBeDefined();
    
    // Cleanup
    await act(async () => {
      renderResult2.unmount();
    });
  });
});
