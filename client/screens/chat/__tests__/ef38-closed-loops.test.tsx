import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatProvider, EF38_STREAM_TIMEOUT_MS, useChat } from '../contexts/ChatContext';
import { MessageList } from '../components/MessageList';
import { chatStart, chatStream } from '../api/cozeApi';
import * as sessionStore from '../stores/sessionStore';
import type { ChatStartResponse } from '../api/cozeApi';
import type { ChatMessage, ChatSession, PendingTurn, TurnStatus } from '../types';
import { EF77_TRACE_PREFIX } from '../utils/ef77Diagnostics';

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
  reject: (error: Error) => void;
  callbacks: StreamCallbacks;
  signal?: AbortSignal;
}

interface CapturedContext {
  isHydrated: boolean;
  isLoading: boolean;
  isThinking: boolean;
  chatPhase: string;
  turnStatus: TurnStatus;
  pendingTurn?: PendingTurn;
  messages: ChatMessage[];
  sendMessage: (text: string) => Promise<boolean>;
  retryLastMessage: () => Promise<void>;
  selectSession: (sessionId: string) => void;
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
let pagehideListener: ((event: { type: string }) => void) | null = null;

function installDiagnosticWindow() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { search: '?ef77trace=true', origin: 'https://runtime.invalid', pathname: '/chat' },
      localStorage: {
        getItem: jest.fn((key: string) => storage[key] ?? null),
        setItem: jest.fn((key: string, value: string) => { storage[key] = value; }),
        removeItem: jest.fn((key: string) => { delete storage[key]; }),
      },
      addEventListener: jest.fn((name: string, listener: (event: { type: string }) => void) => {
        if (name === 'pagehide') pagehideListener = listener;
      }),
      removeEventListener: jest.fn((name: string) => {
        if (name === 'pagehide') pagehideListener = null;
      }),
    },
  });
}

function ef77Events(infoSpy: jest.SpyInstance) {
  return infoSpy.mock.calls
    .filter(call => call[0] === EF77_TRACE_PREFIX)
    .map(call => JSON.parse(call[1] as string) as Record<string, unknown>);
}

function Harness() {
  const context = useChat();
  React.useEffect(() => {
    capturedContext = {
      isHydrated: context.isHydrated,
      isLoading: context.isLoading,
      isThinking: context.isThinking,
      chatPhase: context.chatPhase,
      turnStatus: context.turnStatus,
      pendingTurn: context.pendingTurn,
      messages: context.messages,
      sendMessage: context.sendMessage,
      retryLastMessage: context.retryLastMessage,
      selectSession: context.selectSession,
    };
  }, [context]);

  return <MessageList onShowIntro={() => undefined} />;
}

function createStreamMock() {
  const controllers: StreamController[] = [];

  mockedChatStream.mockImplementation((_sessionId, callbacks, _diagnostics, signal) => {
    let resolvePromise: () => void = () => undefined;
    let rejectPromise: (error: Error) => void = () => undefined;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    controllers.push({ promise, resolve: resolvePromise, reject: rejectPromise, callbacks, signal });
    return promise;
  });

  return controllers;
}

async function waitForHydration() {
  await waitFor(() => expect(capturedContext?.isHydrated).toBe(true));
}

async function beginTurn(text = 'Hello') {
  const previousStreamCount = mockedChatStream.mock.calls.length;
  let sendPromise: Promise<boolean> | undefined;
  await act(async () => {
    sendPromise = capturedContext?.sendMessage(text);
    await Promise.resolve();
  });
  await waitFor(() => expect(mockedChatStream).toHaveBeenCalledTimes(previousStreamCount + 1));
  await waitFor(() => {
    expect(capturedContext?.turnStatus).toBe('generating');
    expect(['responding', 'waiting_deep']).toContain(capturedContext?.chatPhase);
    expect(capturedContext?.isLoading).toBe(true);
    expect(capturedContext?.isThinking).toBe(capturedContext?.chatPhase === 'responding');
  });
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
    pagehideListener = null;
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

  afterEach(() => {
    cleanup();
    delete (globalThis as { window?: unknown }).window;
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
      expect(capturedContext?.messages).toHaveLength(3);
    });
    const completedMessages = capturedContext!.messages;
    const completedTurnId = completedMessages[0].turnId;
    expect(completedTurnId).toBeTruthy();
    expect(completedMessages.map(message => message.turnId)).toEqual([
      completedTurnId,
      completedTurnId,
      completedTurnId,
    ]);
    expect(completedMessages.slice(1).map(message => message.responseLayer)).toEqual([
      'reaction',
      'deep',
    ]);

    await firstProvider.unmount();
    await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();

    await waitFor(() => {
      expect(capturedContext?.chatPhase).toBe('done');
      expect(capturedContext?.turnStatus).toBe('completed');
      expect(capturedContext?.messages.map(message => message.content))
        .toEqual(['Hello', '', '完整回复']);
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
    const recoveredProvider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();

    await waitFor(() => {
      expect(capturedContext?.turnStatus).toBe('interrupted');
      expect(capturedContext?.pendingTurn).toEqual(originalPendingTurn);
      expect(capturedContext?.messages).toHaveLength(1);
      expect(capturedContext?.isLoading).toBe(false);
      expect(capturedContext?.isThinking).toBe(false);
    });
    expect(recoveredProvider.queryByText(/正在思考中/)).toBeNull();
    expect(recoveredProvider.getByText('重新生成')).toBeTruthy();

    await act(async () => {
      streams[0].resolve();
      await abandonedSend;
    });
  });

  it.each([
    ['current-session recovery', false],
    ['most-recent fallback recovery', true],
  ])('preserves generating through teardown termination and completes Retry via %s', async (_label, forceFallback) => {
    installDiagnosticWindow();
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const streams = createStreamMock();
    const firstProvider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();

    const { sendPromise } = await beginTurn('Refresh race message');
    await waitFor(() => expect(storedSessions[0]?.turnStatus).toBe('generating'));
    const durablePendingTurn = storedSessions[0].pendingTurn!;
    const writesBeforeTermination = mockedSaveChatSessions.mock.calls.length;
    const transportError = new TypeError('transport terminated by document teardown');

    await act(async () => {
      pagehideListener?.({ type: 'pagehide' });
      streams[0].callbacks.onError?.(transportError);
      streams[0].reject(transportError);
      await sendPromise;
    });

    expect(mockedSaveChatSessions.mock.calls).toHaveLength(writesBeforeTermination);
    expect(storedSessions[0]).toMatchObject({
      turnStatus: 'generating',
      chatPhase: 'responding',
      pendingTurn: durablePendingTurn,
    });
    const terminationEvents = ef77Events(infoSpy).filter(event =>
      event.event === 'failure_source_observed'
      && event.failurePath === 'transport_termination_without_failed_write'
    );
    expect(terminationEvents).toHaveLength(2);
    expect(terminationEvents.map(event => event.source)).toEqual([
      'chatStream.onError',
      'chatStream.rejection',
    ]);
    expect(terminationEvents.every(event => event.mounted === true)).toBe(true);
    expect(terminationEvents.every(event => event.transportTerminated === true)).toBe(true);
    expect(terminationEvents.every(event => event.terminationReason === 'pagehide')).toBe(true);

    await firstProvider.unmount();
    if (forceFallback) storage.current_session_id = 'missing-session-pointer';
    const recoveredProvider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();

    await waitFor(() => {
      expect(capturedContext?.turnStatus).toBe('interrupted');
      expect(capturedContext?.pendingTurn).toEqual(durablePendingTurn);
      expect(capturedContext?.messages).toHaveLength(1);
    });
    expect(recoveredProvider.getByText('重新生成')).toBeTruthy();

    await act(async () => {
      fireEvent.press(recoveredProvider.getByText('重新生成'));
    });
    await waitFor(() => expect(mockedChatStream).toHaveBeenCalledTimes(2));
    expect(mockedChatStart.mock.calls[1][3]).toBe(durablePendingTurn.requestId);

    await completeStream(streams[1], 'Recovered assistant reply');
    await waitFor(() => {
      expect(capturedContext?.turnStatus).toBe('completed');
      expect(capturedContext?.messages.map(message => message.content)).toEqual([
        'Refresh race message',
        '',
        'Recovered assistant reply',
      ]);
      expect(capturedContext?.messages.filter(message => message.role === 'user')).toHaveLength(1);
      expect(capturedContext?.messages.filter(message => message.role === 'assistant')).toHaveLength(2);
    });
    infoSpy.mockRestore();
  });

  it('keeps an active-page stream error on the failed path', async () => {
    installDiagnosticWindow();
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const streams = createStreamMock();
    await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();

    const { sendPromise } = await beginTurn('Real stream failure');
    const streamError = new TypeError('active network failure');
    await act(async () => {
      streams[0].callbacks.onError?.(streamError);
      streams[0].reject(streamError);
      await sendPromise;
    });

    await waitFor(() => expect(storedSessions[0]?.turnStatus).toBe('failed'));
    expect(storedSessions[0]).toMatchObject({
      turnStatus: 'failed',
      chatPhase: 'idle',
    });
    expect(storedSessions[0].pendingTurn).toBeDefined();
    const observed = ef77Events(infoSpy).find(event =>
      event.event === 'failure_source_observed'
      && event.source === 'chatStream.onError'
    );
    expect(observed).toMatchObject({
      failurePath: 'stream_error_mark_failed',
      mounted: true,
      transportTerminated: false,
      terminationReason: null,
    });
    expect(ef77Events(infoSpy).some(event =>
      event.event === 'write_started'
      && event.writerSource === 'ChatContext.markTurnFailed'
      && event.transitionReason === 'turn_failed'
    )).toBe(true);
    infoSpy.mockRestore();
  });

  it('keeps chatStart failure on the existing failed semantics', async () => {
    installDiagnosticWindow();
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    mockedChatStart.mockRejectedValueOnce(new TypeError('chatStart active failure'));
    await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();

    let sendResult: boolean | undefined;
    await act(async () => {
      sendResult = await capturedContext?.sendMessage('chatStart failure message');
    });

    expect(sendResult).toBe(true);
    expect(mockedChatStream).not.toHaveBeenCalled();
    expect(storedSessions[0]).toMatchObject({
      turnStatus: 'failed',
      chatPhase: 'idle',
    });
    expect(storedSessions[0].pendingTurn).toBeDefined();
    const observed = ef77Events(infoSpy).find(event =>
      event.event === 'failure_source_observed'
      && event.source === 'sendMessageCore.outerCatch'
    );
    expect(observed).toMatchObject({
      failurePath: 'outer_catch_mark_failed',
      mounted: true,
      transportTerminated: false,
      terminationReason: null,
    });
    infoSpy.mockRestore();
  });

  it('does not render loading or Retry for an idle turn whose last message is from the user', async () => {
    const sessionId = 'session-idle-last-user';
    storedSessions = [{
      id: sessionId,
      roleId: 'clever-fox',
      messages: [{
        id: 'user-idle-1',
        role: 'user',
        content: 'Synthetic idle turn',
        timestamp: 1,
      }],
      createdAt: 1,
      updatedAt: 1,
      conversationId: 'conversation-idle-1',
      chatPhase: 'idle',
      turnStatus: 'idle',
    }];
    storage.current_session_id = sessionId;

    const recoveredProvider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();

    await waitFor(() => {
      expect(capturedContext?.chatPhase).toBe('idle');
      expect(capturedContext?.turnStatus).toBe('idle');
      expect(capturedContext?.isLoading).toBe(false);
      expect(capturedContext?.isThinking).toBe(false);
    });
    expect(recoveredProvider.queryByText(/正在思考中/)).toBeNull();
    expect(recoveredProvider.queryByText('重新生成')).toBeNull();
    expect(capturedContext?.messages[0].turnId).toBeUndefined();
    expect(capturedContext?.messages[0].responseLayer).toBeUndefined();
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
    const originalTurnId = storedSessions[0].pendingTurn!.turnId;
    const originalResponseMessageIds = storedSessions[0].pendingTurn!.responseMessageIds;

    await firstProvider.unmount();
    const recoveredProvider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();
    await waitFor(() => expect(recoveredProvider.getByText('重新生成')).toBeTruthy());

    jest.useFakeTimers();
    await act(async () => {
      fireEvent.press(recoveredProvider.getByText('重新生成'));
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(mockedChatStream).toHaveBeenCalledTimes(2);
    expect(capturedContext?.turnStatus).toBe('generating');
    expect(capturedContext?.chatPhase).toBe('responding');
    expect(capturedContext?.isLoading).toBe(true);

    await act(async () => {
      streams[1].callbacks.onChunk?.(JSON.stringify({ type: 'timeline' }));
      await jest.advanceTimersByTimeAsync(32001);
    });

    expect(EF38_STREAM_TIMEOUT_MS).toBeGreaterThan(32000);
    expect(capturedContext?.turnStatus).toBe('generating');
    jest.useRealTimers();

    await act(async () => {
      streams[1].callbacks.onChunk?.(JSON.stringify({ content: '重试回复' }));
      streams[1].callbacks.onDone?.();
      streams[1].resolve();
      await streams[1].promise;
    });

    await waitFor(() => {
      expect(capturedContext?.chatPhase).toBe('done');
      expect(capturedContext?.turnStatus).toBe('completed');
      expect(capturedContext?.messages).toHaveLength(3);
      expect(capturedContext?.messages[0].id).toBe(originalUserMessageId);
      expect(capturedContext?.messages.every(message => message.turnId === originalTurnId)).toBe(true);
      expect(capturedContext?.messages
        .filter(message => message.role === 'assistant')
        .map(message => message.id))
        .toEqual([
          originalResponseMessageIds?.reaction,
          originalResponseMessageIds?.deep,
        ]);
      expect(capturedContext?.messages.map(message => message.content))
        .toEqual(['Hello', '', '重试回复']);
    });

    await act(async () => {
      streams[0].resolve();
      await abandonedSend;
    });
  });

  it('times out a stalled Retry, revokes its transport, and rejects late callbacks before the next Retry completes', async () => {
    const streams = createStreamMock();
    const firstProvider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();

    const { sendPromise: abandonedSend } = await beginTurn('Timeout race message');
    await firstProvider.unmount();
    const recoveredProvider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();
    await waitFor(() => expect(recoveredProvider.getByText('重新生成')).toBeTruthy());

    await act(async () => {
      streams[0].resolve();
      await abandonedSend;
    });
    jest.useFakeTimers();
    await act(async () => {
      fireEvent.press(recoveredProvider.getByText('重新生成'));
      await Promise.resolve();
    });
    expect(mockedChatStream).toHaveBeenCalledTimes(2);
    const pendingAtRetry = storedSessions[0].pendingTurn;

    await act(async () => {
      await jest.advanceTimersByTimeAsync(EF38_STREAM_TIMEOUT_MS);
    });
    jest.useRealTimers();
    await waitFor(() => expect(capturedContext?.turnStatus).toBe('interrupted'));
    expect(capturedContext?.pendingTurn).toEqual(pendingAtRetry);
    expect(recoveredProvider.getByText('重新生成')).toBeTruthy();
    expect(streams[1].signal?.aborted).toBe(true);

    await act(async () => {
      fireEvent.press(recoveredProvider.getByText('重新生成'));
    });
    await waitFor(() => expect(mockedChatStream).toHaveBeenCalledTimes(3));

    await act(async () => {
      streams[1].callbacks.onChunk?.(JSON.stringify({ content: 'STALE_ASSISTANT_CONTENT' }));
      streams[1].callbacks.onDone?.();
      streams[1].resolve();
      await streams[1].promise;
    });
    expect(capturedContext?.turnStatus).toBe('generating');
    expect(capturedContext?.messages.some(message => message.content.includes('STALE_ASSISTANT_CONTENT'))).toBe(false);

    await act(async () => {
      streams[2].callbacks.onChunk?.(JSON.stringify({ content: 'Current retry response' }));
      streams[2].callbacks.onDone?.();
      streams[2].resolve();
      await streams[2].promise;
    });

    await waitFor(() => expect(capturedContext?.turnStatus).toBe('completed'));
    expect(capturedContext?.messages.map(message => message.content)).toEqual([
      'Timeout race message',
      '',
      'Current retry response',
    ]);
    expect(capturedContext?.pendingTurn).toBeUndefined();
    expect(capturedContext?.messages.filter(message => message.role === 'user')).toHaveLength(1);
    expect(capturedContext?.messages.filter(message => message.role === 'assistant')).toHaveLength(2);
  });

  it('EF-104: creates four owned entities and keeps multi-chunk Deep isolated', async () => {
    const companionText = 'COMPANION_TYPING_ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    mockedChatStart.mockResolvedValueOnce({
      ...chatStartResponse,
      reactionLayer: 'R',
      companionLayer: companionText,
      reactionTimeline: [{ displayAt: 0, text: 'R' }],
      companionTimeline: [{ displayAt: 1, text: companionText }],
    });
    const streams = createStreamMock();
    await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();

    const { sendPromise } = await beginTurn('Owned turn');
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1100));
    });
    await waitFor(() => {
      expect(capturedContext?.messages.some(message => message.responseLayer === 'companion')).toBe(true);
    });

    const beforeDeep = capturedContext!.messages.map(message => ({ ...message }));
    const expectedLayerIds = capturedContext!.pendingTurn?.responseMessageIds;
    await act(async () => {
      streams[0].callbacks.onChunk?.(JSON.stringify({ content: 'D1' }));
      streams[0].callbacks.onChunk?.(JSON.stringify({ content: 'D2' }));
      streams[0].callbacks.onChunk?.(JSON.stringify({ content: 'D3' }));
      streams[0].callbacks.onDone?.();
      streams[0].resolve();
      await streams[0].promise;
      await sendPromise;
    });

    await waitFor(() => expect(capturedContext?.turnStatus).toBe('completed'));
    const entities = capturedContext!.messages;
    expect(entities).toHaveLength(4);
    const [user, reaction, companion, deep] = entities;
    expect(new Set(entities.map(message => message.id)).size).toBe(4);
    expect(new Set(entities.map(message => message.turnId)).size).toBe(1);
    expect([reaction.responseLayer, companion.responseLayer, deep.responseLayer]).toEqual([
      'reaction',
      'companion',
      'deep',
    ]);
    expect(reaction.content).toBe(beforeDeep.find(message => message.responseLayer === 'reaction')?.content);
    expect(companion.content).toBe(companionText);
    expect(reaction.content).not.toMatch(/D1|D2|D3/);
    expect(companion.content).not.toMatch(/D1|D2|D3/);
    expect(deep.content).toBe('D1D2D3');
    expect(entities.filter(message => message.responseLayer === 'deep')).toHaveLength(1);
    expect([reaction.id, companion.id, deep.id]).toEqual([
      expectedLayerIds?.reaction,
      expectedLayerIds?.companion,
      expectedLayerIds?.deep,
    ]);
    expect(user.role).toBe('user');
  });

  it('EF-104: stale Turn1 callbacks cannot mutate Turn2 entities', async () => {
    const streams = createStreamMock();
    await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();

    const first = await beginTurn('Turn one');
    await completeStream(streams[0], 'Turn1 Deep');
    await act(async () => { await first.sendPromise; });
    const turn1Messages = capturedContext!.messages.map(message => ({ ...message }));
    const turn1Id = turn1Messages[0].turnId;

    const second = await beginTurn('Turn two');
    const turn2Id = capturedContext!.pendingTurn?.turnId;
    const turn2Before = capturedContext!.messages
      .filter(message => message.turnId === turn2Id)
      .map(message => ({ ...message }));

    await act(async () => {
      streams[0].callbacks.onChunk?.(JSON.stringify({ content: ' late' }));
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    expect(capturedContext!.messages.filter(message => message.turnId === turn2Id)).toEqual(turn2Before);
    expect(capturedContext!.messages
      .filter(message => message.turnId === turn1Id && message.responseLayer !== 'deep'))
      .toEqual(turn1Messages.filter(message => message.responseLayer !== 'deep'));

    await completeStream(streams[1], 'Turn2 Deep');
    await act(async () => { await second.sendPromise; });
    const finalTurn2 = capturedContext!.messages.filter(message => message.turnId === turn2Id);
    expect(finalTurn2.some(message => message.content.includes('late'))).toBe(false);
    expect(finalTurn2.find(message => message.responseLayer === 'deep')?.content).toBe('Turn2 Deep');
  });

  it('EF-104: session switch revokes late callback ownership', async () => {
    storedSessions = [
      {
        id: 'session-a', roleId: 'clever-fox', messages: [], createdAt: 1, updatedAt: 1,
        conversationId: 'conversation-a', turnStatus: 'idle', chatPhase: 'idle',
      },
      {
        id: 'session-b', roleId: 'clever-fox', messages: [
          { id: 'legacy-b', role: 'assistant', content: 'Session B history', timestamp: 1 },
        ], createdAt: 1, updatedAt: 1, conversationId: 'conversation-b', turnStatus: 'completed', chatPhase: 'done',
      },
    ];
    storage.current_session_id = 'session-a';
    const streams = createStreamMock();
    await render(<ChatProvider><Harness /></ChatProvider>);
    await waitForHydration();

    const active = await beginTurn('Session A turn');
    await act(async () => capturedContext?.selectSession('session-b'));
    expect(capturedContext?.messages.map(message => message.content)).toEqual(['Session B history']);

    await act(async () => {
      streams[0].callbacks.onChunk?.(JSON.stringify({ content: 'Late A Deep' }));
      streams[0].callbacks.onDone?.();
      streams[0].resolve();
      await streams[0].promise;
      await active.sendPromise;
    });

    expect(capturedContext?.messages.map(message => message.content)).toEqual(['Session B history']);
    expect(capturedContext?.messages.some(message => message.content.includes('Late A Deep'))).toBe(false);
    expect(storedSessions.find(session => session.id === 'session-b')?.messages)
      .toEqual([{ id: 'legacy-b', role: 'assistant', content: 'Session B history', timestamp: 1 }]);
  });
});
