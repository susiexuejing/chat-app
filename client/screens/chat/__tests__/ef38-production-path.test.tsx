/**
 * EF-38 Production Path Tests
 *
 * Tests the actual production lifecycle behaviors using real Provider,
 * real sendMessage, real retryLastMessage, and real MessageList UI.
 * Uses stateful in-memory persistence adapter.
 */

import React from 'react';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';
import { ChatProvider, useChat } from '../contexts/ChatContext';
import * as cozeApi from '../api/cozeApi';
import * as sessionStore from '../stores/sessionStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MessageList } from '../components/MessageList';

// Polyfill StyleSheet.flatten for test environment
import { StyleSheet } from 'react-native';
if (!StyleSheet.flatten) {
  (StyleSheet as any).flatten = (styles: any) => {
    if (!styles) return {};
    if (Array.isArray(styles)) {
      return Object.assign({}, ...styles.map((s) => (typeof s === 'object' ? s : {})));
    }
    return typeof styles === 'object' ? styles : {};
  };
}

// Mock @expo/vector-icons
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return {
    FontAwesome6: ({ name, size, color }: any) => React.createElement('Text', { testID: `icon-${name}` }, name),
    MaterialIcons: ({ name, size, color }: any) => React.createElement('Text', { testID: `icon-${name}` }, name),
  };
});

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// Mock expo-av
jest.mock('expo-av', () => ({
  Audio: {
    Recording: jest.fn(),
    setAudioModeAsync: jest.fn(),
  },
}));

// Mock react-native-slider
jest.mock('@react-native-community/slider', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ value, onValueChange, testID }: any) =>
      React.createElement('Slider', { testID, value, onValueChange }),
  };
});

// Mock expo-linear-gradient
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children, testID }: any) =>
      React.createElement(View, { testID }, children),
  };
});

// Mock expo-blur
jest.mock('expo-blur', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    BlurView: ({ children, testID }: any) =>
      React.createElement(View, { testID }, children),
  };
});

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: {
      createAnimatedComponent: (comp: any) => comp,
      call: jest.fn(),
    },
    useSharedValue: (init: any) => ({ value: init }),
    useAnimatedStyle: (fn: any) => fn(),
    withTiming: (val: any) => val,
    withSpring: (val: any) => val,
    withDelay: (_: any, val: any) => val,
    withSequence: (...vals: any[]) => vals[vals.length - 1],
    runOnJS: (fn: any) => fn,
    runOnUI: (fn: any) => fn,
    interpolate: (val: any) => val,
    Easing: { linear: jest.fn(), bezier: jest.fn() },
    Animated: {
      View,
      Text: View,
      Image: View,
      ScrollView: View,
      FlatList: View,
      createAnimatedComponent: (comp: any) => comp,
    },
  };
});

// Mock expo-image
jest.mock('expo-image', () => {
  const React = require('react');
  const { Image } = require('react-native');
  return { Image };
});

// Mock react-native-gesture-handler
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { View, TouchableOpacity } = require('react-native');
  return {
    GestureHandlerRootView: View,
    PanGestureHandler: View,
    TapGestureHandler: View,
    State: {},
    TouchableOpacity,
  };
});

// Mock @react-native-async-storage/async-storage with stateful adapter
const asyncStorageState = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => asyncStorageState.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { asyncStorageState.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { asyncStorageState.delete(key); }),
    clear: jest.fn(async () => { asyncStorageState.clear(); }),
    getAllKeys: jest.fn(async () => Array.from(asyncStorageState.keys())),
    multiGet: jest.fn(async (keys: string[]) => keys.map((k) => [k, asyncStorageState.get(k) ?? null])),
    multiSet: jest.fn(async (pairs: [string, string][]) => { pairs.forEach(([k, v]) => asyncStorageState.set(k, v)); }),
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach((k) => asyncStorageState.delete(k)); }),
  },
}));

// Stateful session store adapter
let storedSessions: any[] = [];
jest.mock('../stores/sessionStore', () => ({
  getChatSessions: jest.fn(async () => storedSessions),
  saveChatSessions: jest.fn(async (sessions: any[]) => { storedSessions = [...sessions]; }),
}));

// Mock other dependencies
jest.mock('../constants/roles', () => ({
  roles: [{ id: 'role_1', name: 'Test Role', avatar: '' }],
}));

jest.mock('../api/cozeApi');
jest.mock('../utils/storage', () => ({
  getStoredMessages: jest.fn().mockResolvedValue([]),
  saveStoredMessages: jest.fn().mockResolvedValue(undefined),
  clearStoredMessages: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/textAnalyzer', () => ({
  analyzeText: jest.fn().mockResolvedValue({ emotions: [], keyEvent: '', keywords: [], interactionOptions: [] }),
}));

const mockedChatStart = cozeApi.chatStart as jest.MockedFunction<typeof cozeApi.chatStart>;
const mockedChatStream = cozeApi.chatStream as jest.MockedFunction<typeof cozeApi.chatStream>;

// Stream controller for deterministic testing
interface StreamController {
  resolve: () => void;
  reject: (err: Error) => void;
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
  promise: Promise<void>;
}

function createStreamController(): StreamController {
  let resolveFn: () => void;
  let rejectFn: (err: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return {
    resolve: () => resolveFn!(),
    reject: (err: Error) => rejectFn!(err),
    onChunk: () => {},
    onDone: () => {},
    onError: () => {},
    promise,
  };
}

// Test consumer component that captures context
interface CapturedContext {
  isHydrated: boolean;
  chatPhase: string;
  turnStatus: string;
  pendingTurn: any;
  messages: any[];
  sessions: any[];
  currentSessionId: string | null;
  sendMessage: (text: string) => Promise<boolean>;
  retryLastMessage: () => Promise<void>;
}

interface TestConsumerProps {
  onContext: (ctx: CapturedContext) => void;
}

function TestConsumer({ onContext }: TestConsumerProps) {
  const ctx = useChat();
  React.useEffect(() => {
    onContext({
      isHydrated: ctx.isHydrated,
      chatPhase: ctx.chatPhase,
      turnStatus: ctx.turnStatus,
      pendingTurn: ctx.pendingTurn,
      messages: ctx.messages,
      sessions: ctx.sessions,
      currentSessionId: ctx.currentSessionId,
      sendMessage: ctx.sendMessage,
      retryLastMessage: ctx.retryLastMessage,
    });
  });
  return null;
}

describe('EF-38 Production Path Tests', () => {
  let capturedCtx: CapturedContext | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    asyncStorageState.clear();
    storedSessions = [];
    capturedCtx = null;

    // Default mock implementations
    mockedChatStart.mockResolvedValue({
      sessionId: 'backend-session-123',
      emotionTag: 'neutral',
      eventKeyword: '',
      frontFlowText: '',
      flowContext: { reaction: '', companion: '' },
    } as any);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    capturedCtx = null;
  });

  const waitForHydration = async () => {
    await waitFor(() => {
      expect(capturedCtx?.isHydrated).toBe(true);
    }, { timeout: 2000 });
  };

  // ─── Test 1: Normal valid Deep settles as completed without timeout ───
  describe('Test 1: Normal valid Deep settles as completed without timeout', () => {
    it('should settle stream as completed when valid Deep content is received', async () => {
      let streamCtrl: StreamController | null = null;

      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        streamCtrl = createStreamController();
        // Store callbacks for later use
        streamCtrl.onChunk = callbacks.onChunk;
        streamCtrl.onDone = callbacks.onDone;
        streamCtrl.onError = callbacks.onError;
        return streamCtrl.promise;
      });

      const renderResult = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();
      expect(capturedCtx).not.toBeNull();

      // Start send
      let sendPromise: Promise<boolean>;
      await act(async () => {
        sendPromise = capturedCtx!.sendMessage('Hello');
      });

      // Wait for chatStart to be called
      await waitFor(() => {
        expect(mockedChatStart).toHaveBeenCalled();
      });

      // Send valid Deep chunk
      await act(async () => {
        streamCtrl!.onChunk(JSON.stringify({ content: 'This is a valid Deep response with substantial content.' }));
      });

      // Send done
      await act(async () => {
        streamCtrl!.onDone();
        await streamCtrl!.promise;
      });

      // Wait for send to complete
      await act(async () => {
        await sendPromise;
      });

      // Verify stream settled as completed
      expect(capturedCtx!.chatPhase).toBe('done');
      expect(capturedCtx!.turnStatus).toBe('completed');

      await act(async () => {
        renderResult.unmount();
      });
    });
  });

  // ─── Test 2: Generating Session is produced by real send path ───
  describe('Test 2: Generating Session is produced by real send path', () => {
    it('should persist session with turnStatus=generating before chatStart', async () => {
      const eventLog: string[] = [];

      // Track when generating is saved
      (sessionStore.saveChatSessions as jest.Mock).mockImplementation(async (sessions: any[]) => {
        storedSessions = [...sessions];
        const generatingSession = sessions.find((s: any) => s.turnStatus === 'generating');
        if (generatingSession) {
          eventLog.push('save:generating');
        }
      });

      mockedChatStart.mockImplementation(async () => {
        eventLog.push('chatStart');
        return {
          sessionId: 'backend-session-123',
          emotionTag: 'neutral',
          eventKeyword: '',
          frontFlowText: '',
          flowContext: { reaction: '', companion: '' },
        } as any;
      });

      let streamCtrl: StreamController | null = null;
      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        eventLog.push('chatStream');
        streamCtrl = createStreamController();
        streamCtrl.onChunk = callbacks.onChunk;
        streamCtrl.onDone = callbacks.onDone;
        streamCtrl.onError = callbacks.onError;
        return streamCtrl.promise;
      });

      const renderResult = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      // Start send
      let sendPromise: Promise<boolean>;
      await act(async () => {
        sendPromise = capturedCtx!.sendMessage('Hello');
      });

      // Wait for chatStream to be called
      await waitFor(() => {
        expect(mockedChatStream).toHaveBeenCalled();
      });

      // Verify ordering: save:generating must come before chatStart
      const saveIndex = eventLog.indexOf('save:generating');
      const chatStartIndex = eventLog.indexOf('chatStart');
      const chatStreamIndex = eventLog.indexOf('chatStream');

      expect(saveIndex).toBeGreaterThanOrEqual(0);
      expect(chatStartIndex).toBeGreaterThanOrEqual(0);
      expect(saveIndex).toBeLessThan(chatStartIndex);

      // Verify generating session structure
      const generatingSession = storedSessions.find((s: any) => s.turnStatus === 'generating');
      expect(generatingSession).toBeDefined();
      expect(generatingSession.pendingTurn).toBeDefined();
      expect(generatingSession.pendingTurn.userMessage).toBe('Hello');
      expect(generatingSession.pendingTurn.userMessageId).toBeDefined();

      // Clean up
      await act(async () => {
        streamCtrl!.onDone();
        await streamCtrl!.promise;
        await sendPromise;
      });

      await act(async () => {
        renderResult.unmount();
      });
    });
  });

  // ─── Test 3: Real Provider unmount/remount converts generating to interrupted ───
  describe('Test 3: Real Provider unmount/remount converts generating to interrupted', () => {
    it('should convert generating to interrupted after unmount and remount', async () => {
      let streamCtrl: StreamController | null = null;

      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        streamCtrl = createStreamController();
        streamCtrl.onChunk = callbacks.onChunk;
        streamCtrl.onDone = callbacks.onDone;
        streamCtrl.onError = callbacks.onError;
        return streamCtrl.promise;
      });

      // Provider A: send and persist generating
      const renderResultA = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      // Start send
      let sendPromiseA: Promise<boolean>;
      await act(async () => {
        sendPromiseA = capturedCtx!.sendMessage('Hello');
      });

      // Wait for generating to be persisted
      await waitFor(() => {
        expect(storedSessions.some((s: any) => s.turnStatus === 'generating')).toBe(true);
      });

      // Verify generating was persisted
      const generatingSession = storedSessions.find((s: any) => s.turnStatus === 'generating');
      expect(generatingSession).toBeDefined();

      // Unmount Provider A (simulates refresh)
      await act(async () => {
        renderResultA.unmount();
      });

      // Verify sessions are still in storage
      expect(storedSessions.length).toBeGreaterThan(0);

      // Provider B: remount and verify interrupted
      const renderResultB = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      // Verify interrupted state
      await waitFor(() => {
        expect(capturedCtx?.turnStatus).toBe('interrupted');
      });

      // Clean up
      await act(async () => {
        renderResultB.unmount();
      });
    });
  });

  // ─── Test 4: Production interruption UI is visible ───
  describe('Test 4: Production interruption UI is visible', () => {
    it('should render interruption UI with retry button when turnStatus is interrupted', async () => {
      // Pre-populate storage with interrupted session
      const interruptedSession = {
        id: 'session_interrupted',
        roleId: 'role_1',
        messages: [
          { id: 'msg_1', role: 'user', content: 'Hello', createdAt: Date.now() - 10000 },
        ],
        turnStatus: 'interrupted',
        pendingTurn: {
          requestId: 'req_1',
          userMessageId: 'msg_1',
          userMessage: 'Hello',
          startedAt: Date.now() - 10000,
          roleId: 'role_1',
        },
        createdAt: Date.now() - 10000,
        updatedAt: Date.now() - 10000,
      };
      storedSessions = [interruptedSession];
      asyncStorageState.set('current_session_id', 'session_interrupted');

      const renderResult = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
          <MessageList onShowIntro={() => {}} />
        </ChatProvider>
      );

      await waitForHydration();

      // Verify interrupted state
      await waitFor(() => {
        expect(capturedCtx?.turnStatus).toBe('interrupted');
      });

      // Verify interruption UI is rendered
      const retryButton = renderResult.queryByText('重新生成');
      expect(retryButton).not.toBeNull();

      await act(async () => {
        renderResult.unmount();
      });
    });
  });

  // ─── Test 5: Actual Retry button is clicked ───
  describe('Test 5: Actual Retry button is clicked', () => {
    it('should trigger retry when the production retry button is pressed', async () => {
      // Pre-populate storage with interrupted session
      const interruptedSession = {
        id: 'session_interrupted',
        roleId: 'role_1',
        messages: [
          { id: 'msg_1', role: 'user', content: 'Hello', createdAt: Date.now() - 10000 },
        ],
        turnStatus: 'interrupted',
        pendingTurn: {
          requestId: 'req_1',
          userMessageId: 'msg_1',
          userMessage: 'Hello',
          startedAt: Date.now() - 10000,
          roleId: 'role_1',
        },
        createdAt: Date.now() - 10000,
        updatedAt: Date.now() - 10000,
      };
      storedSessions = [interruptedSession];
      asyncStorageState.set('current_session_id', 'session_interrupted');

      let streamCtrl: StreamController | null = null;
      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        streamCtrl = createStreamController();
        streamCtrl.onChunk = callbacks.onChunk;
        streamCtrl.onDone = callbacks.onDone;
        streamCtrl.onError = callbacks.onError;
        return streamCtrl.promise;
      });

      const renderResult = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
          <MessageList onShowIntro={() => {}} />
        </ChatProvider>
      );

      await waitForHydration();

      // Verify interrupted state
      await waitFor(() => {
        expect(capturedCtx?.turnStatus).toBe('interrupted');
      });

      // Find and click the retry button
      const retryButton = renderResult.getByText('重新生成');
      await act(async () => {
        fireEvent.press(retryButton);
      });

      // Wait for chatStream to be called (retry started)
      await waitFor(() => {
        expect(mockedChatStream).toHaveBeenCalled();
      });

      // Complete the stream
      await act(async () => {
        streamCtrl!.onChunk(JSON.stringify({ content: 'Retry response content' }));
        streamCtrl!.onDone();
        await streamCtrl!.promise;
      });

      // Verify completed state
      await waitFor(() => {
        expect(capturedCtx?.turnStatus).toBe('completed');
      });

      await act(async () => {
        renderResult.unmount();
      });
    });
  });

  // ─── Test 6: Original user-message ID remains unchanged after retry ───
  describe('Test 6: Original user-message ID remains unchanged after retry', () => {
    it('should reuse original user message ID on retry', async () => {
      // Pre-populate storage with interrupted session
      const originalUserMessageId = 'msg_original_123';
      const interruptedSession = {
        id: 'session_interrupted',
        roleId: 'role_1',
        messages: [
          { id: originalUserMessageId, role: 'user', content: 'Hello', createdAt: Date.now() - 10000 },
        ],
        turnStatus: 'interrupted',
        pendingTurn: {
          requestId: 'req_1',
          userMessageId: originalUserMessageId,
          userMessage: 'Hello',
          startedAt: Date.now() - 10000,
          roleId: 'role_1',
        },
        createdAt: Date.now() - 10000,
        updatedAt: Date.now() - 10000,
      };
      storedSessions = [interruptedSession];
      asyncStorageState.set('current_session_id', 'session_interrupted');

      let streamCtrl: StreamController | null = null;
      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        streamCtrl = createStreamController();
        streamCtrl.onChunk = callbacks.onChunk;
        streamCtrl.onDone = callbacks.onDone;
        streamCtrl.onError = callbacks.onError;
        return streamCtrl.promise;
      });

      const renderResult = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
          <MessageList onShowIntro={() => {}} />
        </ChatProvider>
      );

      await waitForHydration();

      // Verify interrupted state
      await waitFor(() => {
        expect(capturedCtx?.turnStatus).toBe('interrupted');
      });

      // Click retry button
      const retryButton = renderResult.getByText('重新生成');
      await act(async () => {
        fireEvent.press(retryButton);
      });

      // Complete the stream
      await act(async () => {
        streamCtrl!.onChunk(JSON.stringify({ content: 'Retry response' }));
        streamCtrl!.onDone();
        await streamCtrl!.promise;
      });

      // Verify original user message ID is preserved
      const userMessage = capturedCtx!.messages.find((m: any) => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage!.id).toBe(originalUserMessageId);

      await act(async () => {
        renderResult.unmount();
      });
    });
  });

  // ─── Test 7: User message exists exactly once ───
  describe('Test 7: User message exists exactly once', () => {
    it('should have exactly one user message after retry', async () => {
      // Pre-populate storage with interrupted session
      const interruptedSession = {
        id: 'session_interrupted',
        roleId: 'role_1',
        messages: [
          { id: 'msg_1', role: 'user', content: 'Hello', createdAt: Date.now() - 10000 },
        ],
        turnStatus: 'interrupted',
        pendingTurn: {
          requestId: 'req_1',
          userMessageId: 'msg_1',
          userMessage: 'Hello',
          startedAt: Date.now() - 10000,
          roleId: 'role_1',
        },
        createdAt: Date.now() - 10000,
        updatedAt: Date.now() - 10000,
      };
      storedSessions = [interruptedSession];
      asyncStorageState.set('current_session_id', 'session_interrupted');

      let streamCtrl: StreamController | null = null;
      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        streamCtrl = createStreamController();
        streamCtrl.onChunk = callbacks.onChunk;
        streamCtrl.onDone = callbacks.onDone;
        streamCtrl.onError = callbacks.onError;
        return streamCtrl.promise;
      });

      const renderResult = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      // Click retry button
      await act(async () => {
        await capturedCtx!.retryLastMessage();
      });

      // Complete the stream
      await act(async () => {
        streamCtrl!.onChunk(JSON.stringify({ content: 'Retry response' }));
        streamCtrl!.onDone();
        await streamCtrl!.promise;
      });

      // Verify exactly one user message
      const userMessages = capturedCtx!.messages.filter((m: any) => m.role === 'user');
      expect(userMessages.length).toBe(1);

      await act(async () => {
        renderResult.unmount();
      });
    });
  });

  // ─── Test 8: Retry completes with exactly one assistant response ───
  describe('Test 8: Retry completes with exactly one assistant response', () => {
    it('should have exactly one assistant response after retry', async () => {
      // Pre-populate storage with interrupted session
      const interruptedSession = {
        id: 'session_interrupted',
        roleId: 'role_1',
        messages: [
          { id: 'msg_1', role: 'user', content: 'Hello', createdAt: Date.now() - 10000 },
        ],
        turnStatus: 'interrupted',
        pendingTurn: {
          requestId: 'req_1',
          userMessageId: 'msg_1',
          userMessage: 'Hello',
          startedAt: Date.now() - 10000,
          roleId: 'role_1',
        },
        createdAt: Date.now() - 10000,
        updatedAt: Date.now() - 10000,
      };
      storedSessions = [interruptedSession];
      asyncStorageState.set('current_session_id', 'session_interrupted');

      let streamCtrl: StreamController | null = null;
      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        streamCtrl = createStreamController();
        streamCtrl.onChunk = callbacks.onChunk;
        streamCtrl.onDone = callbacks.onDone;
        streamCtrl.onError = callbacks.onError;
        return streamCtrl.promise;
      });

      const renderResult = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      // Click retry button
      await act(async () => {
        await capturedCtx!.retryLastMessage();
      });

      // Complete the stream
      await act(async () => {
        streamCtrl!.onChunk(JSON.stringify({ content: 'Retry response' }));
        streamCtrl!.onDone();
        await streamCtrl!.promise;
      });

      // Verify exactly one assistant response
      const assistantMessages = capturedCtx!.messages.filter((m: any) => m.role === 'assistant');
      expect(assistantMessages.length).toBe(1);

      await act(async () => {
        renderResult.unmount();
      });
    });
  });

  // ─── Test 9: onError settles without timeout ───
  describe('Test 9: onError settles without timeout', () => {
    it('should settle stream as error immediately when onError is called', async () => {
      let streamCtrl: StreamController | null = null;

      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        streamCtrl = createStreamController();
        streamCtrl.onChunk = callbacks.onChunk;
        streamCtrl.onDone = callbacks.onDone;
        streamCtrl.onError = callbacks.onError;
        return streamCtrl.promise;
      });

      const renderResult = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      // Start send
      let sendPromise: Promise<boolean>;
      await act(async () => {
        sendPromise = capturedCtx!.sendMessage('Hello');
      });

      // Wait for chatStream to be called
      await waitFor(() => {
        expect(mockedChatStream).toHaveBeenCalled();
      });

      // Call onError immediately
      await act(async () => {
        streamCtrl!.onError(new Error('Network error'));
        try { await streamCtrl!.promise; } catch {}
      });

      // Wait for send to complete
      await act(async () => {
        try { await sendPromise; } catch {}
      });

      // Verify error state
      expect(capturedCtx!.turnStatus).toBe('failed');

      await act(async () => {
        renderResult.unmount();
      });
    });
  });

  // ─── Test 10: chatStream Promise rejection settles promptly ───
  describe('Test 10: chatStream Promise rejection settles promptly', () => {
    it('should settle stream as error when chatStream promise rejects', async () => {
      mockedChatStream.mockImplementation(() => {
        return Promise.reject(new Error('Stream connection failed'));
      });

      const renderResult = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      // Start send
      let sendPromise: Promise<boolean>;
      await act(async () => {
        sendPromise = capturedCtx!.sendMessage('Hello');
      });

      // Wait for send to complete (with error)
      await act(async () => {
        try { await sendPromise; } catch {}
      });

      // Verify error state
      expect(capturedCtx!.turnStatus).toBe('failed');

      await act(async () => {
        renderResult.unmount();
      });
    });
  });

  // ─── Test 11: Empty Deep follows the documented fallback ───
  describe('Test 11: Empty Deep follows the documented fallback', () => {
    it('should handle empty Deep content according to fallback logic', async () => {
      let streamCtrl: StreamController | null = null;

      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        streamCtrl = createStreamController();
        streamCtrl.onChunk = callbacks.onChunk;
        streamCtrl.onDone = callbacks.onDone;
        streamCtrl.onError = callbacks.onError;
        return streamCtrl.promise;
      });

      const renderResult = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      // Start send
      let sendPromise: Promise<boolean>;
      await act(async () => {
        sendPromise = capturedCtx!.sendMessage('Hello');
      });

      // Wait for chatStream to be called
      await waitFor(() => {
        expect(mockedChatStream).toHaveBeenCalled();
      });

      // Send empty Deep chunk (no content)
      await act(async () => {
        streamCtrl!.onChunk(JSON.stringify({ done: true }));
      });

      // Send done
      await act(async () => {
        streamCtrl!.onDone();
        await streamCtrl!.promise;
      });

      // Wait for send to complete
      await act(async () => {
        await sendPromise;
      });

      // Verify fallback behavior - empty Deep should result in completed with no assistant message
      // or a fallback message
      expect(capturedCtx!.chatPhase).toBe('done');
      expect(capturedCtx!.turnStatus).toBe('completed');

      await act(async () => {
        renderResult.unmount();
      });
    });
  });

  // ─── Test 12: Old Provider cannot finalize after unmount ───
  describe('Test 12: Old Provider cannot finalize after unmount', () => {
    it('should not call finalizeTurnCompleted after unmount', async () => {
      let streamCtrl: StreamController | null = null;

      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        streamCtrl = createStreamController();
        streamCtrl.onChunk = callbacks.onChunk;
        streamCtrl.onDone = callbacks.onDone;
        streamCtrl.onError = callbacks.onError;
        return streamCtrl.promise;
      });

      // Provider A: start send
      const renderResultA = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      // Start send
      let sendPromiseA: Promise<boolean>;
      await act(async () => {
        sendPromiseA = capturedCtx!.sendMessage('Hello');
      });

      // Wait for generating to be persisted
      await waitFor(() => {
        expect(storedSessions.some((s: any) => s.turnStatus === 'generating')).toBe(true);
      });

      // Unmount Provider A
      await act(async () => {
        renderResultA.unmount();
      });

      // Now call onDone on the abandoned stream
      await act(async () => {
        streamCtrl!.onDone();
        streamCtrl!.resolve();
        try { await sendPromiseA; } catch {}
      });

      // Verify completed was NOT persisted (old Provider cannot finalize)
      const completedSession = storedSessions.find((s: any) => s.turnStatus === 'completed');
      expect(completedSession).toBeUndefined();

      // Provider B: remount and verify interrupted
      const renderResultB = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      // Verify interrupted state
      await waitFor(() => {
        expect(capturedCtx?.turnStatus).toBe('interrupted');
      });

      await act(async () => {
        renderResultB.unmount();
      });
    });
  });

  // ─── Continuous: Full recovery chain ───
  describe('Continuous: Full recovery chain', () => {
    it('should complete the full recovery chain: send -> generating -> unmount -> remount -> interrupted -> retry -> completed', async () => {
      let streamCtrlA: StreamController | null = null;
      let streamCtrlB: StreamController | null = null;
      let streamCallCount = 0;

      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        streamCallCount++;
        const ctrl = createStreamController();
        ctrl.onChunk = callbacks.onChunk;
        ctrl.onDone = callbacks.onDone;
        ctrl.onError = callbacks.onError;
        if (streamCallCount === 1) {
          streamCtrlA = ctrl;
        } else {
          streamCtrlB = ctrl;
        }
        return ctrl.promise;
      });

      // Provider A: send and persist generating
      const renderResultA = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      // Start send
      let sendPromiseA: Promise<boolean>;
      await act(async () => {
        sendPromiseA = capturedCtx!.sendMessage('Hello');
      });

      // Wait for generating to be persisted
      await waitFor(() => {
        expect(storedSessions.some((s: any) => s.turnStatus === 'generating')).toBe(true);
      });

      const originalUserMessageId = storedSessions[0].pendingTurn.userMessageId;

      // Unmount Provider A
      await act(async () => {
        renderResultA.unmount();
      });

      // Provider B: remount
      const renderResultB = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
          <MessageList onShowIntro={() => {}} />
        </ChatProvider>
      );

      await waitForHydration();

      // Verify interrupted state
      await waitFor(() => {
        expect(capturedCtx?.turnStatus).toBe('interrupted');
      });

      // Verify interruption UI is rendered
      const retryButton = renderResultB.queryByText('重新生成');
      expect(retryButton).not.toBeNull();

      // Click retry button
      await act(async () => {
        fireEvent.press(retryButton!);
      });

      // Wait for new stream to be called
      await waitFor(() => {
        expect(streamCallCount).toBe(2);
      });

      // Complete the retry stream
      await act(async () => {
        streamCtrlB!.onChunk(JSON.stringify({ content: 'Retry response content' }));
        streamCtrlB!.onDone();
        await streamCtrlB!.promise;
      });

      // Verify completed state
      await waitFor(() => {
        expect(capturedCtx?.turnStatus).toBe('completed');
      });

      // Verify original user message ID is preserved
      const userMessage = capturedCtx!.messages.find((m: any) => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage!.id).toBe(originalUserMessageId);

      // Verify exactly one user message
      const userMessages = capturedCtx!.messages.filter((m: any) => m.role === 'user');
      expect(userMessages.length).toBe(1);

      // Verify exactly one assistant response
      const assistantMessages = capturedCtx!.messages.filter((m: any) => m.role === 'assistant');
      expect(assistantMessages.length).toBe(1);

      // Verify completed was persisted
      expect(storedSessions.some((s: any) => s.turnStatus === 'completed')).toBe(true);

      await act(async () => {
        renderResultB.unmount();
      });
    });
  });
});
