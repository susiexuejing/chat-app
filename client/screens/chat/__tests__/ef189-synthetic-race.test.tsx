import React from 'react';
import { View } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { isSendIntentCurrent, ChatProvider, useChat, type SendIntentState } from '../contexts/ChatContext';
import { chatStart, chatStream } from '../api/cozeApi';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
  },
}));

jest.mock('../api/cozeApi', () => ({
  chatStart: jest.fn(),
  chatStream: jest.fn(),
}));

jest.mock('../stores/sessionStore', () => ({
  ...jest.requireActual('../stores/sessionStore'),
  createConversation: jest.fn(async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })),
}));

const mockedChatStart = chatStart as jest.MockedFunction<typeof chatStart>;
const mockedChatStream = chatStream as jest.MockedFunction<typeof chatStream>;

type CapturedContext = ReturnType<typeof useChat>;
let capturedContext: CapturedContext | null = null;

function Harness() {
  const context = useChat();
  React.useEffect(() => {
    capturedContext = context;
  }, [context]);
  return <View />;
}

type Completion = { name: string; resolve: () => void };

function deferred(name: string): Completion & { promise: Promise<void> } {
  let resolve!: () => void;
  const promise = new Promise<void>(res => { resolve = res; });
  return { name, promise, resolve };
}

describe('EF-189 deterministic New Chat/send completion race', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedContext = null;
    mockedChatStream.mockResolvedValue();
  });

  it.each([
    ['old completion before new completion', ['old', 'new']],
    ['new completion before old completion', ['new', 'old']],
  ])('%s keeps the new intent authoritative', async (_label, order) => {
    const oldSend = deferred('old');
    const newSend = deferred('new');
    const sends = new Map([['old', oldSend], ['new', newSend]]);
    const persistence: string[] = [];
    const streams: string[] = [];
    const history: string[] = [];

    let state: SendIntentState = { generation: 1, sessionId: 'S_old', mounted: true };
    const oldIntent = { intentGeneration: 1, sessionId: 'S_old' };
    persistence.push('S_old:pending');

    // New Chat/C_new revokes the old intent before S_new is selected.
    state = { generation: 2, sessionId: null, mounted: true };
    state = { generation: 2, sessionId: 'S_new', mounted: true };
    const newIntent = { intentGeneration: 2, sessionId: 'S_new' };
    persistence.push('S_new:pending');

    const complete = async (name: string) => {
      const run = sends.get(name)!;
      await run.promise;
      const intent = name === 'old' ? oldIntent : newIntent;
      const accepted = isSendIntentCurrent(intent, state);
      if (accepted) {
        streams.push(name);
        persistence.push(`${intent.sessionId}:completed`);
        history.push(`${intent.sessionId}:${name}`);
      }
      return accepted;
    };

    const completions = order.map(name => complete(name));
    for (const name of order) {
      sends.get(name)!.resolve();
      await Promise.resolve();
    }
    const accepted = await Promise.all(completions);

    expect(accepted).toEqual(order.map(name => name === 'new'));
    expect(streams).toEqual(['new']);
    expect(persistence).toEqual(['S_old:pending', 'S_new:pending', 'S_new:completed']);
    expect(history).toEqual(['S_new:new']);
    expect(isSendIntentCurrent(oldIntent, state)).toBe(false);
    expect(isSendIntentCurrent(newIntent, state)).toBe(true);
  });

  it('drops a deferred stale send in the real provider before it can start a stream', async () => {
    let releaseOldChatStart!: (value: Awaited<ReturnType<typeof chatStart>>) => void;
    const oldChatStart = new Promise<Awaited<ReturnType<typeof chatStart>>>(resolve => {
      releaseOldChatStart = resolve;
    });
    const successfulStart = {
      sessionId: 'backend-synthetic-session',
      emotionTag: 'neutral',
      eventKeyword: '',
      reactionLayer: 'synthetic reaction',
      frontFlowText: '',
      flowContext: {
        flowType: null,
        flowStage: null,
        flowStrength: null,
        flowConfidence: null,
        flowRisk: null,
      },
    };
    mockedChatStart.mockImplementationOnce(() => oldChatStart).mockResolvedValue(successfulStart);

    await render(<ChatProvider><Harness /></ChatProvider>);
    await waitFor(() => expect(capturedContext?.isHydrated).toBe(true));

    // C_old is established, then S_old is held after its turn state exists
    // but before any response/stream side effect is released.
    await act(async () => {
      capturedContext?.createNewChat();
    });
    let oldSend!: Promise<boolean>;
    await act(async () => {
      oldSend = capturedContext!.sendMessage('synthetic-old');
    });
    await waitFor(() => expect(mockedChatStart).toHaveBeenCalledTimes(1));

    // New Chat revokes S_old while its response-start completion is deferred.
    await act(async () => {
      capturedContext?.createNewChat();
    });
    expect(capturedContext?.currentSessionId).toBeNull();

    await act(async () => {
      releaseOldChatStart(successfulStart);
      await oldSend;
    });

    // The stale completion cannot start a stream or reselect C_old.
    expect(mockedChatStream).not.toHaveBeenCalled();
    expect(capturedContext?.currentSessionId).toBeNull();

    // The first send under the new intent is the only stream that may start.
    await act(async () => {
      await capturedContext?.sendMessage('synthetic-new');
    });
    expect(mockedChatStream).toHaveBeenCalledTimes(1);
    expect(capturedContext?.currentSessionId).not.toBeNull();
  });
});
