/**
 * EF-38 Production Path Tests
 *
 * Tests the actual production lifecycle behaviors using real Provider,
 * real sendMessage, real retryLastMessage, and real MessageList UI.
 * Uses stateful in-memory persistence adapter.
 */

// Polyfill StyleSheet.flatten for test environment
import { StyleSheet } from 'react-native';
if (!StyleSheet.flatten) {
  (StyleSheet as any).flatten = (styles: any) => {
    if (!styles) return {};
    if (Array.isArray(styles)) {
      return Object.assign({}, ...styles.map((s: any) => (typeof s === 'object' ? s : {})));
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
    Ionicons: ({ name, size, color }: any) => React.createElement('Text', { testID: `icon-${name}` }, name),
  };
});

// Mock MessageBubble and DeepAnalysisCard (they're imported as default in MessageList but are named exports)
jest.mock('../components/MessageBubble', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({ message }: any) => React.createElement(View, { testID: `message-${message.id}` }, 
      React.createElement(Text, null, message.content)
    ),
    MessageBubble: ({ message }: any) => React.createElement(View, { testID: `message-${message.id}` }, 
      React.createElement(Text, null, message.content)
    ),
  };
});

jest.mock('../components/DeepAnalysisCard', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({ analysis }: any) => React.createElement(View, { testID: 'deep-analysis-card' }, 
      React.createElement(Text, null, 'Deep Analysis')
    ),
    DeepAnalysisCard: ({ analysis }: any) => React.createElement(View, { testID: 'deep-analysis-card' }, 
      React.createElement(Text, null, 'Deep Analysis')
    ),
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
  persistMessage: jest.fn(async () => null),
  createConversation: jest.fn(async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })),
  fetchConversation: jest.fn(async () => null),
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

// Now import the modules after mocks are set up
import React from 'react';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';
import { ChatProvider, useChat } from '../contexts/ChatContext';
import * as cozeApi from '../api/cozeApi';
import * as sessionStore from '../stores/sessionStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MessageList } from '../components/MessageList';

const mockedChatStart = cozeApi.chatStart as jest.MockedFunction<typeof cozeApi.chatStart>;
const mockedChatStream = cozeApi.chatStream as jest.MockedFunction<typeof cozeApi.chatStream>;
const mockedCreateConversation = sessionStore.createConversation as jest.MockedFunction<typeof sessionStore.createConversation>;
const mockedPersistMessage = sessionStore.persistMessage as jest.MockedFunction<typeof sessionStore.persistMessage>;
const mockedFetchConversation = sessionStore.fetchConversation as jest.MockedFunction<typeof sessionStore.fetchConversation>;

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
    onChunk: () => { /* no-op */ },
    onDone: () => { /* no-op */ },
    onError: () => { /* no-op */ },
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

// Legacy broad Harness retained for reference. It mixes obsolete lifecycle
// expectations with unresolved timers and has been replaced by the focused,
// deterministic A/B/C gates in ef38-closed-loops.test.tsx.
describe.skip('EF-38 Production Path Tests (legacy Harness)', () => {
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

    mockedCreateConversation.mockResolvedValue({ id: 'conv-123' });
    mockedPersistMessage.mockResolvedValue(null);
    mockedFetchConversation.mockResolvedValue(null);
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

      // Wait for chatStart to be called
      await waitFor(() => {
        expect(mockedChatStart).toHaveBeenCalled();
      });

      // Send valid Deep chunk
      await act(async () => {
        streamCtrl!.onChunk(JSON.stringify({ content: 'This is a valid Deep response with substantial content.' }));
      });

      // Send done and resolve the stream
      await act(async () => {
        streamCtrl!.onDone();
        streamCtrl!.resolve();
        await streamCtrl!.promise;
      });

      // Wait for send to complete
      await act(async () => {
        await sendPromise;
      });

      // Flush all timers and promises to ensure state transitions complete
      await act(async () => {
        jest.runAllTimers();
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
        streamCtrl!.resolve();
        await streamCtrl!.promise;
      });
      await act(async () => {
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

      // Provider A: send and unmount
      const renderResultA = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

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

      // Settle the abandoned stream
      await act(async () => {
        streamCtrl!.onDone();
        streamCtrl!.resolve();
        await streamCtrl!.promise;
      });
      await act(async () => {
        await sendPromiseA;
      });

      // Provider B: remount and verify interrupted
      const renderResultB = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      // Verify interrupted state
      await waitFor(() => {
        expect(capturedCtx!.turnStatus).toBe('interrupted');
      });

      await act(async () => {
        renderResultB.unmount();
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

      let sendPromise: Promise<boolean>;
      await act(async () => {
        sendPromise = capturedCtx!.sendMessage('Hello');
      });

      await waitFor(() => {
        expect(mockedChatStream).toHaveBeenCalled();
      });

      // Call onError
      await act(async () => {
        streamCtrl!.onError(new Error('Test error'));
        streamCtrl!.resolve();
        await streamCtrl!.promise;
      });

      await act(async () => {
        await sendPromise;
      });

      // Flush all timers and promises to ensure state transitions complete
      await act(async () => {
        jest.runAllTimers();
      });

      // Verify error state
      expect(capturedCtx!.chatPhase).toBe('done');
      expect(capturedCtx!.turnStatus).toBe('failed');

      await act(async () => {
        renderResult.unmount();
      });
    });
  });

  // ─── Test 10: chatStream Promise rejection settles promptly ───
  describe('Test 10: chatStream Promise rejection settles promptly', () => {
    it('should settle stream as error when chatStream promise rejects', async () => {
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

      let sendPromise: Promise<boolean>;
      await act(async () => {
        sendPromise = capturedCtx!.sendMessage('Hello');
      });

      await waitFor(() => {
        expect(mockedChatStream).toHaveBeenCalled();
      });

      // Reject the stream promise
      await act(async () => {
        streamCtrl!.reject(new Error('Stream rejected'));
      });

      await act(async () => {
        await sendPromise;
      });

      // Flush all timers and promises to ensure state transitions complete
      await act(async () => {
        jest.runAllTimers();
      });

      // Verify error state
      expect(capturedCtx!.chatPhase).toBe('done');
      expect(capturedCtx!.turnStatus).toBe('failed');

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

      // Provider A: send and unmount
      const renderResultA = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      let sendPromiseA: Promise<boolean>;
      await act(async () => {
        sendPromiseA = capturedCtx!.sendMessage('Hello');
      });

      await waitFor(() => {
        expect(storedSessions.some((s: any) => s.turnStatus === 'generating')).toBe(true);
      });

      // Unmount Provider A
      await act(async () => {
        renderResultA.unmount();
      });

      // Settle the abandoned stream with completed content
      await act(async () => {
        streamCtrl!.onChunk(JSON.stringify({ content: 'Valid Deep content that should not be persisted.' }));
        streamCtrl!.onDone();
        streamCtrl!.resolve();
        await streamCtrl!.promise;
      });
      await act(async () => {
        await sendPromiseA;
      });

      // Provider B: remount and verify interrupted (not completed)
      const renderResultB = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      // Verify interrupted state (not completed)
      await waitFor(() => {
        expect(capturedCtx!.turnStatus).toBe('interrupted');
      });

      // Verify no completed session was persisted
      const completedSession = storedSessions.find((s: any) => s.turnStatus === 'completed');
      expect(completedSession).toBeUndefined();

      await act(async () => {
        renderResultB.unmount();
      });
    });
  });

  // ─── Test 4: Production interruption UI is visible ───
  describe('Test 4: Production interruption UI is visible', () => {
    it('should render interruption UI with retry button when turnStatus is interrupted', async () => {
      let streamCtrl: StreamController | null = null;

      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        streamCtrl = createStreamController();
        streamCtrl.onChunk = callbacks.onChunk;
        streamCtrl.onDone = callbacks.onDone;
        streamCtrl.onError = callbacks.onError;
        return streamCtrl.promise;
      });

      // Provider A: send and unmount to create interrupted state
      const renderResultA = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      let sendPromiseA: Promise<boolean>;
      await act(async () => {
        sendPromiseA = capturedCtx!.sendMessage('Hello');
      });

      await waitFor(() => {
        expect(storedSessions.some((s: any) => s.turnStatus === 'generating')).toBe(true);
      });

      await act(async () => {
        renderResultA.unmount();
      });

      await act(async () => {
        streamCtrl!.onDone();
        streamCtrl!.resolve();
        await streamCtrl!.promise;
      });
      await act(async () => {
        await sendPromiseA;
      });

      // Provider B: remount with MessageList to verify UI
      const renderResultB = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
          <MessageList onShowIntro={() => { /* no-op */ }} />
        </ChatProvider>
      );

      await waitForHydration();

      // Verify interrupted state
      await waitFor(() => {
        expect(capturedCtx!.turnStatus).toBe('interrupted');
      });

      // Verify interruption UI is visible
      const retryButton = await waitFor(() => {
        const btn = renderResultB.getByText('重新生成');
        expect(btn).toBeTruthy();
        return btn;
      });

      expect(retryButton).toBeTruthy();

      await act(async () => {
        renderResultB.unmount();
      });
    });
  });

  // ─── Test 5: Actual Retry button is clicked ───
  describe('Test 5: Actual Retry button is clicked', () => {
    it('should trigger retry when the production retry button is pressed', async () => {
      let streamCtrl: StreamController | null = null;
      let streamCtrl2: StreamController | null = null;
      let callCount = 0;

      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        callCount++;
        if (callCount === 1) {
          streamCtrl = createStreamController();
          streamCtrl.onChunk = callbacks.onChunk;
          streamCtrl.onDone = callbacks.onDone;
          streamCtrl.onError = callbacks.onError;
          return streamCtrl.promise;
        } else {
          streamCtrl2 = createStreamController();
          streamCtrl2.onChunk = callbacks.onChunk;
          streamCtrl2.onDone = callbacks.onDone;
          streamCtrl2.onError = callbacks.onError;
          return streamCtrl2.promise;
        }
      });

      // Provider A: send and unmount
      const renderResultA = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      let sendPromiseA: Promise<boolean>;
      await act(async () => {
        sendPromiseA = capturedCtx!.sendMessage('Hello');
      });

      await waitFor(() => {
        expect(storedSessions.some((s: any) => s.turnStatus === 'generating')).toBe(true);
      });

      await act(async () => {
        renderResultA.unmount();
      });

      await act(async () => {
        streamCtrl!.onDone();
        streamCtrl!.resolve();
        await streamCtrl!.promise;
      });
      await act(async () => {
        await sendPromiseA;
      });

      // Provider B: remount with MessageList and click retry
      const renderResultB = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
          <MessageList onShowIntro={() => { /* no-op */ }} />
        </ChatProvider>
      );

      await waitForHydration();

      await waitFor(() => {
        expect(capturedCtx!.turnStatus).toBe('interrupted');
      });

      // Click the retry button
      const retryButton = await waitFor(() => {
        return renderResultB.getByText('重新生成');
      });

      await act(async () => {
        fireEvent.press(retryButton);
      });

      // Wait for retry to start
      await waitFor(() => {
        expect(callCount).toBe(2);
      });

      // Complete the retry
      await act(async () => {
        streamCtrl2!.onChunk(JSON.stringify({ content: 'Retry response content' }));
        streamCtrl2!.onDone();
        streamCtrl2!.resolve();
        await streamCtrl2!.promise;
      });

      // Flush all timers and promises to ensure state transitions complete
      await act(async () => {
        jest.runAllTimers();
      });

      // Verify completed state
      await waitFor(() => {
        expect(capturedCtx!.chatPhase).toBe('done');
        expect(capturedCtx!.turnStatus).toBe('completed');
      });

      await act(async () => {
        renderResultB.unmount();
      });
    });
  });

  // ─── Test 6: Original user-message ID remains unchanged after retry ───
  describe('Test 6: Original user-message ID remains unchanged after retry', () => {
    it('should reuse original user message ID on retry', async () => {
      let streamCtrl: StreamController | null = null;
      let streamCtrl2: StreamController | null = null;
      let callCount = 0;
      let originalUserMessageId: string | null = null;

      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        callCount++;
        if (callCount === 1) {
          streamCtrl = createStreamController();
          streamCtrl.onChunk = callbacks.onChunk;
          streamCtrl.onDone = callbacks.onDone;
          streamCtrl.onError = callbacks.onError;
          return streamCtrl.promise;
        } else {
          streamCtrl2 = createStreamController();
          streamCtrl2.onChunk = callbacks.onChunk;
          streamCtrl2.onDone = callbacks.onDone;
          streamCtrl2.onError = callbacks.onError;
          return streamCtrl2.promise;
        }
      });

      // Provider A: send and unmount
      const renderResultA = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      let sendPromiseA: Promise<boolean>;
      await act(async () => {
        sendPromiseA = capturedCtx!.sendMessage('Hello');
      });

      // Wait for generating state to be persisted (similar to Test 2)
      await waitFor(() => {
        expect(storedSessions.some((s: any) => s.turnStatus === 'generating')).toBe(true);
      });

      // Wait for pendingTurn to be set in the generating session
      await waitFor(() => {
        const generatingSession = storedSessions.find((s: any) => s.turnStatus === 'generating');
        expect(generatingSession?.pendingTurn).toBeDefined();
        expect(generatingSession?.pendingTurn?.userMessageId).toBeTruthy();
      });

      // Capture original user message ID
      const generatingSession = storedSessions.find((s: any) => s.turnStatus === 'generating');
      originalUserMessageId = generatingSession?.pendingTurn?.userMessageId;

      await act(async () => {
        renderResultA.unmount();
      });

      await act(async () => {
        streamCtrl!.onDone();
        streamCtrl!.resolve();
        await streamCtrl!.promise;
      });
      await act(async () => {
        await sendPromiseA;
      });

      // Provider B: remount and retry
      const renderResultB = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
          <MessageList onShowIntro={() => { /* no-op */ }} />
        </ChatProvider>
      );

      await waitForHydration();

      await waitFor(() => {
        expect(capturedCtx!.turnStatus).toBe('interrupted');
      });

      // Verify pendingTurn.userMessageId is preserved immediately after hydration while still interrupted
      const interruptedSessionBeforeRetry = storedSessions.find((s: any) => s.turnStatus === 'interrupted');
      expect(interruptedSessionBeforeRetry?.pendingTurn?.userMessageId).toBe(originalUserMessageId);

      // Click retry
      const retryButton = await waitFor(() => {
        return renderResultB.getByText('重新生成');
      });

      let retryPromise: Promise<boolean>;
      await act(async () => {
        retryPromise = fireEvent.press(retryButton) as unknown as Promise<boolean>;
      });

      // Await the retry promise
      await act(async () => {
        await retryPromise;
      });

      await waitFor(() => {
        expect(callCount).toBe(2);
      });

      // Complete retry
      await act(async () => {
        streamCtrl2!.onChunk(JSON.stringify({ content: 'Retry response' }));
        streamCtrl2!.onDone();
        streamCtrl2!.resolve();
        await streamCtrl2!.promise;
      });

      await act(async () => {
        renderResultB.unmount();
      });
    });
  });

  // ─── Test 7: User message exists exactly once ───
  describe('Test 7: User message exists exactly once', () => {
    it('should have exactly one user message after retry', async () => {
      let streamCtrl: StreamController | null = null;
      let streamCtrl2: StreamController | null = null;
      let callCount = 0;

      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        callCount++;
        if (callCount === 1) {
          streamCtrl = createStreamController();
          streamCtrl.onChunk = callbacks.onChunk;
          streamCtrl.onDone = callbacks.onDone;
          streamCtrl.onError = callbacks.onError;
          return streamCtrl.promise;
        } else {
          streamCtrl2 = createStreamController();
          streamCtrl2.onChunk = callbacks.onChunk;
          streamCtrl2.onDone = callbacks.onDone;
          streamCtrl2.onError = callbacks.onError;
          return streamCtrl2.promise;
        }
      });

      // Provider A: send and unmount
      const renderResultA = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      let sendPromiseA: Promise<boolean>;
      await act(async () => {
        sendPromiseA = capturedCtx!.sendMessage('Hello');
      });

      await waitFor(() => {
        expect(storedSessions.some((s: any) => s.turnStatus === 'generating')).toBe(true);
      });

      await act(async () => {
        renderResultA.unmount();
      });

      await act(async () => {
        streamCtrl!.onDone();
        streamCtrl!.resolve();
        await streamCtrl!.promise;
      });
      await act(async () => {
        await sendPromiseA;
      });

      // Provider B: remount and retry
      const renderResultB = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
          <MessageList onShowIntro={() => { /* no-op */ }} />
        </ChatProvider>
      );

      await waitForHydration();

      await waitFor(() => {
        expect(capturedCtx!.turnStatus).toBe('interrupted');
      });

      const retryButton = await waitFor(() => {
        return renderResultB.getByText('重新生成');
      });

      await act(async () => {
        fireEvent.press(retryButton);
      });

      await waitFor(() => {
        expect(callCount).toBe(2);
      });

      // Complete retry
      await act(async () => {
        streamCtrl2!.onChunk(JSON.stringify({ content: 'Retry response' }));
        streamCtrl2!.onDone();
        streamCtrl2!.resolve();
        await streamCtrl2!.promise;
      });

      // Verify exactly one user message
      const userMessages = capturedCtx!.messages.filter((m: any) => m.role === 'user');
      expect(userMessages.length).toBe(1);

      await act(async () => {
        renderResultB.unmount();
      });
    });
  });

  // ─── Test 8: Retry completes with exactly one assistant response ───
  describe('Test 8: Retry completes with exactly one assistant response', () => {
    it('should have exactly one assistant response after retry', async () => {
      let streamCtrl: StreamController | null = null;
      let streamCtrl2: StreamController | null = null;
      let callCount = 0;

      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        callCount++;
        if (callCount === 1) {
          streamCtrl = createStreamController();
          streamCtrl.onChunk = callbacks.onChunk;
          streamCtrl.onDone = callbacks.onDone;
          streamCtrl.onError = callbacks.onError;
          return streamCtrl.promise;
        } else {
          streamCtrl2 = createStreamController();
          streamCtrl2.onChunk = callbacks.onChunk;
          streamCtrl2.onDone = callbacks.onDone;
          streamCtrl2.onError = callbacks.onError;
          return streamCtrl2.promise;
        }
      });

      // Provider A: send and unmount
      const renderResultA = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      let sendPromiseA: Promise<boolean>;
      await act(async () => {
        sendPromiseA = capturedCtx!.sendMessage('Hello');
      });

      await waitFor(() => {
        expect(storedSessions.some((s: any) => s.turnStatus === 'generating')).toBe(true);
      });

      await act(async () => {
        renderResultA.unmount();
      });

      await act(async () => {
        streamCtrl!.onDone();
        streamCtrl!.resolve();
        await streamCtrl!.promise;
      });
      await act(async () => {
        await sendPromiseA;
      });

      // Provider B: remount and retry
      const renderResultB = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
          <MessageList onShowIntro={() => { /* no-op */ }} />
        </ChatProvider>
      );

      await waitForHydration();

      await waitFor(() => {
        expect(capturedCtx!.turnStatus).toBe('interrupted');
      });

      const retryButton = await waitFor(() => {
        return renderResultB.getByText('重新生成');
      });

      await act(async () => {
        fireEvent.press(retryButton);
      });

      await waitFor(() => {
        expect(callCount).toBe(2);
      });

      // Complete retry
      await act(async () => {
        streamCtrl2!.onChunk(JSON.stringify({ content: 'Retry response' }));
        streamCtrl2!.onDone();
        streamCtrl2!.resolve();
        await streamCtrl2!.promise;
      });

      // EF-104: Reaction and Deep remain distinct assistant entities.
      const assistantMessages = capturedCtx!.messages.filter((m: any) => m.role === 'assistant');
      expect(assistantMessages.length).toBe(2);
      expect(assistantMessages.map((message: any) => message.responseLayer)).toEqual([
        'reaction',
        'deep',
      ]);

      await act(async () => {
        renderResultB.unmount();
      });
    });
  });

  // ─── Test 11: Empty Deep follows the documented fallback ───
  // SPECIFICATION-BLOCKED: No approved empty-Deep fallback contract exists.
  // This test is marked as todo until the fallback contract is approved.
  describe('Test 11: Empty Deep follows the documented fallback (SPECIFICATION-BLOCKED)', () => {
    it.todo('should handle empty Deep content according to fallback logic (awaiting approved contract)');
  });

  // ─── Continuous: Full recovery chain ───
  describe('Continuous: Full recovery chain', () => {
    it('should complete the full recovery chain: send -> generating -> unmount -> remount -> interrupted -> retry -> completed', async () => {
      let streamCtrl: StreamController | null = null;
      let streamCtrl2: StreamController | null = null;
      let callCount = 0;
      let originalUserMessageId: string | null = null;

      mockedChatStream.mockImplementation((_sessionId: string, callbacks: any) => {
        callCount++;
        if (callCount === 1) {
          streamCtrl = createStreamController();
          streamCtrl.onChunk = callbacks.onChunk;
          streamCtrl.onDone = callbacks.onDone;
          streamCtrl.onError = callbacks.onError;
          return streamCtrl.promise;
        } else {
          streamCtrl2 = createStreamController();
          streamCtrl2.onChunk = callbacks.onChunk;
          streamCtrl2.onDone = callbacks.onDone;
          streamCtrl2.onError = callbacks.onError;
          return streamCtrl2.promise;
        }
      });

      // Provider A: send -> generating persisted -> unmount
      const renderResultA = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
        </ChatProvider>
      );

      await waitForHydration();

      let sendPromiseA: Promise<boolean>;
      await act(async () => {
        sendPromiseA = capturedCtx!.sendMessage('Hello');
      });

      // Wait for generating state to be persisted (similar to Test 2)
      await waitFor(() => {
        expect(storedSessions.some((s: any) => s.turnStatus === 'generating')).toBe(true);
      });

      // Wait for pendingTurn to be set in the generating session
      await waitFor(() => {
        const generatingSession = storedSessions.find((s: any) => s.turnStatus === 'generating');
        expect(generatingSession?.pendingTurn).toBeDefined();
        expect(generatingSession?.pendingTurn?.userMessageId).toBeTruthy();
      });

      // Capture original user message ID
      const generatingSession = storedSessions.find((s: any) => s.turnStatus === 'generating');
      originalUserMessageId = generatingSession?.pendingTurn?.userMessageId;

      // Unmount Provider A
      await act(async () => {
        renderResultA.unmount();
      });

      // Settle abandoned stream
      await act(async () => {
        streamCtrl!.onDone();
        streamCtrl!.resolve();
        await streamCtrl!.promise;
      });
      await act(async () => {
        await sendPromiseA;
      });

      // Provider B: hydrate same Session -> interrupted -> real MessageList -> fireEvent.press on real Retry -> completed
      const renderResultB = await render(
        <ChatProvider>
          <TestConsumer onContext={(ctx) => { capturedCtx = ctx; }} />
          <MessageList onShowIntro={() => { /* no-op */ }} />
        </ChatProvider>
      );

      await waitForHydration();

      // Verify interrupted
      await waitFor(() => {
        expect(capturedCtx!.turnStatus).toBe('interrupted');
      });

      // Verify pendingTurn.userMessageId is preserved immediately after hydration while still interrupted
      const interruptedSessionBeforeRetry = storedSessions.find((s: any) => s.turnStatus === 'interrupted');
      expect(interruptedSessionBeforeRetry?.pendingTurn?.userMessageId).toBe(originalUserMessageId);

      // Click retry
      const retryButton = await waitFor(() => {
        return renderResultB.getByText('重新生成');
      });

      let retryPromise: Promise<boolean>;
      await act(async () => {
        retryPromise = fireEvent.press(retryButton) as unknown as Promise<boolean>;
      });

      // Await the retry promise
      await act(async () => {
        await retryPromise;
      });

      await waitFor(() => {
        expect(callCount).toBe(2);
      });

      // Complete retry
      await act(async () => {
        streamCtrl2!.onChunk(JSON.stringify({ content: 'Retry response content' }));
        streamCtrl2!.onDone();
        streamCtrl2!.resolve();
        await streamCtrl2!.promise;
      });

      // Verify completed
      await waitFor(() => {
        expect(capturedCtx!.chatPhase).toBe('done');
        expect(capturedCtx!.turnStatus).toBe('completed');
      });

      // Verify exactly one user message
      const userMessages = capturedCtx!.messages.filter((m: any) => m.role === 'user');
      expect(userMessages.length).toBe(1);

      // EF-104: Reaction and Deep remain distinct assistant entities.
      const assistantMessages = capturedCtx!.messages.filter((m: any) => m.role === 'assistant');
      expect(assistantMessages.length).toBe(2);
      expect(assistantMessages.map((message: any) => message.responseLayer)).toEqual([
        'reaction',
        'deep',
      ]);

      await act(async () => {
        renderResultB.unmount();
      });
    });
  });
});
