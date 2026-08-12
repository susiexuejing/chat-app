import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatProvider, useChat } from '../contexts/ChatContext';
import { MessageList } from '../components/MessageList';
import { chatStart, chatStream } from '../api/cozeApi';
import * as sessionStore from '../stores/sessionStore';
import type { ChatStartResponse } from '../api/cozeApi';
import type { ChatMessage, ChatSession, PendingTurn, TurnStatus } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({
  FontAwesome6: () => null,
}));

jest.mock('../components/MessageBubble', () => ({
  MessageBubble: () => null,
}));

jest.mock('../components/DeepAnalysisCard', () => ({
  DeepAnalysisCard: () => null,
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

const storage: Record<string, string> = {};
let storedSessions: ChatSession[] = [];

const mockedChatStart = chatStart as jest.MockedFunction<typeof chatStart>;
const mockedChatStream = chatStream as jest.MockedFunction<typeof chatStream>;
const mockedGetChatSessions = sessionStore.getChatSessions as jest.MockedFunction<typeof sessionStore.getChatSessions>;
const mockedSaveChatSessions = sessionStore.saveChatSessions as jest.MockedFunction<typeof sessionStore.saveChatSessions>;
const mockedPersistMessage = sessionStore.persistMessage as jest.MockedFunction<typeof sessionStore.persistMessage>;
const mockedCreateConversation = sessionStore.createConversation as jest.MockedFunction<typeof sessionStore.createConversation>;
const mockedFetchConversation = sessionStore.fetchConversation as jest.MockedFunction<typeof sessionStore.fetchConversation>;

type StreamCallbacks = Parameters<typeof chatStream>[1];

interface StreamController {
  promise: Promise<void>;
  resolve: () => void;
  callbacks: StreamCallbacks;
}

interface CapturedContext {
  isHydrated: boolean;
  chatPhase: string;
  turnStatus: TurnStatus;
  pendingTurn?: PendingTurn;
  messages: ChatMessage[];
  sendMessage: (text: string) => Promise<boolean>;
}

const chatStartResponse: ChatStartResponse = {
  sessionId: 'backend-session-1',
  emotionTag: 'neutral',
  eventKeyword: '',
  frontFlowText: '',
  flowContext: {
    flowType: null,
    flowStage: null,
    flowStrength: null,
    flowConfidence: null,
    flowRisk: null,
  },
};

let capturedContext: CapturedContext | null = null;

function Harness() {
  const context = useChat();
  React.useEffect(() => {
    capturedContext = {
      isHydrated: context.isHydrated,
      chatPhase: context.chatPhase,
      turnStatus: context.turnStatus,
      pendingTurn: context.pendingTurn,
      messages: context.messages,
      sendMessage: context.sendMessage,
    };
  }, [context]);

  return <MessageList onShowIntro={() => undefined} />;
}

function createStreamMock() {
  const controllers: StreamController[] = [];

  mockedChatStream.mockImplementation((_sessionId, callbacks) => {
    let resolvePromise: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    controllers.push({ promise, resolve: resolvePromise, callbacks });
    return promise;
  });

  return controllers;
}

async function waitForHydration() {
  await waitFor(() => expect(capturedContext?.isHydrated).toBe(true));
}

async function beginTurn(text = 'Hello') {
  let sendPromise: Promise<boolean> | undefined;
  await act(async () => {
    sendPromise = capturedContext?.sendMessage(text);
    await Promise.resolve();
  });
  await waitFor(() => expect(mockedChatStream).toHaveBeenCalledTimes(1));
  if (!sendPromise) {
    throw new Error('sendMessage did not return a Promise');
  }
  return { sendPromise };
}

async function completeStream(controller: StreamController, content: string) {
  await act(async () => {
    controller.callbacks.onChunk?.(JSON.stringify({ content }));
    controller.callbacks.onDone?.();
    controller.resolve();
    await controller.promise;
  });
}

describe('EF-38 minimum closed loops', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedContext = null;
    storedSessions = [];
    Object.keys(storage).forEach(key => delete storage[key]);

    (AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>)
      .mockImplementation(async key => storage[key] ?? null);
    (AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>)
      .mockImplementation(async (key, value) => { storage[key] = value; });
    (AsyncStorage.removeItem as jest.MockedFunction<typeof AsyncStorage.removeItem>)
      .mockImplementation(async key => { delete storage[key]; });

    mockedGetChatSessions.mockImplementation(async () => storedSessions);
    mockedSaveChatSessions.mockImplementation(async sessions => {
      storedSessions = sessions.map(session => ({
        ...session,
        messages: [...session.messages],
      }));
    });
    mockedPersistMessage.mockResolvedValue(null);
    mockedCreateConversation.mockResolvedValue({ id: 'conversation-1' });
    mockedFetchConversation.mockResolvedValue(null);
    mockedChatStart.mockResolvedValue(chatStartResponse);
  });

  it('Loop A: restores one completed turn after remount', async () => {
    const streams = createStreamMock();
    const firstProvider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();

    const { sendPromise } = await beginTurn();
    await completeStream(streams[0], '完整回复');
    await act(async () => { await sendPromise; });

    await waitFor(() => {
      expect(capturedContext?.chatPhase).toBe('done');
      expect(capturedContext?.turnStatus).toBe('completed');
      expect(capturedContext?.messages).toHaveLength(2);
    });

    await firstProvider.unmount();
    await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();

    await waitFor(() => {
      expect(capturedContext?.chatPhase).toBe('done');
      expect(capturedContext?.turnStatus).toBe('completed');
      expect(capturedContext?.messages.map(message => message.content))
        .toEqual(['Hello', '完整回复']);
    });
  });

  it('Loop B: restores the original pending turn as interrupted', async () => {
    const streams = createStreamMock();
    const firstProvider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();

    const { sendPromise: abandonedSend } = await beginTurn();
    await waitFor(() => {
      const generating = storedSessions.find(session => session.turnStatus === 'generating');
      expect(generating?.pendingTurn?.userMessageId).toBeDefined();
    });
    const originalPendingTurn = storedSessions[0].pendingTurn!;

    await firstProvider.unmount();
    await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();

    await waitFor(() => {
      expect(capturedContext?.turnStatus).toBe('interrupted');
      expect(capturedContext?.pendingTurn).toEqual(originalPendingTurn);
      expect(capturedContext?.messages).toHaveLength(1);
    });

    await act(async () => {
      streams[0].resolve();
      await abandonedSend;
    });
  });

  it('Loop B2: transport resolve before cleanup persists one interrupted turn', async () => {
    const streams = createStreamMock();
    await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();

    const { sendPromise } = await beginTurn();
    const originalPendingTurn = storedSessions[0].pendingTurn!;

    await act(async () => {
      streams[0].resolve();
      await streams[0].promise;
      await sendPromise;
    });

    await waitFor(() => {
      expect(capturedContext?.chatPhase).toBe('idle');
      expect(capturedContext?.turnStatus).toBe('interrupted');
      expect(capturedContext?.pendingTurn).toEqual(originalPendingTurn);
      expect(capturedContext?.messages).toHaveLength(1);
      expect(capturedContext?.messages[0].role).toBe('user');
    });

    expect(storedSessions[0]).toMatchObject({
      chatPhase: 'idle',
      turnStatus: 'interrupted',
      pendingTurn: originalPendingTurn,
    });
    expect(storedSessions[0].messages).toHaveLength(1);
  });

  it('Loop C: real Retry UI preserves identity and completes without duplication', async () => {
    const streams = createStreamMock();
    const firstProvider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();

    const { sendPromise: abandonedSend } = await beginTurn();
    await waitFor(() => expect(storedSessions[0]?.pendingTurn).toBeDefined());
    const originalUserMessageId = storedSessions[0].pendingTurn!.userMessageId;

    await firstProvider.unmount();
    const recoveredProvider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();
    await waitFor(() => expect(recoveredProvider.getByText('重新生成')).toBeTruthy());

    await act(async () => {
      fireEvent.press(recoveredProvider.getByText('重新生成'));
      await waitFor(() => expect(mockedChatStream).toHaveBeenCalledTimes(2));

      streams[1].callbacks.onChunk?.(JSON.stringify({ content: '重试回复' }));
      streams[1].callbacks.onDone?.();
      streams[1].resolve();
      await streams[1].promise;
    });

    await waitFor(() => {
      expect(capturedContext?.chatPhase).toBe('done');
      expect(capturedContext?.turnStatus).toBe('completed');
      expect(capturedContext?.messages).toHaveLength(2);
      expect(capturedContext?.messages[0].id).toBe(originalUserMessageId);
      expect(capturedContext?.messages.map(message => message.content))
        .toEqual(['Hello', '重试回复']);
    });

    await act(async () => {
      streams[0].resolve();
      await abandonedSend;
    });
  });
});
