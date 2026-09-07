import React from 'react';
import { View } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { isSendIntentCurrent, ChatProvider, useChat, type SendIntentState } from '../contexts/ChatContext';
import { chatStart, chatStream } from '../api/cozeApi';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), clear: jest.fn(async () => undefined) } }));
jest.mock('../api/cozeApi', () => ({ chatStart: jest.fn(), chatStream: jest.fn() }));
jest.mock('../stores/sessionStore', () => ({ ...jest.requireActual('../stores/sessionStore'), createConversation: jest.fn(async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })) }));

const mockedChatStart = chatStart as jest.MockedFunction<typeof chatStart>;
const mockedChatStream = chatStream as jest.MockedFunction<typeof chatStream>;
type CapturedContext = ReturnType<typeof useChat>;
let capturedContext: CapturedContext | null = null;
function Harness() { const context = useChat(); React.useEffect(() => { capturedContext = context; }, [context]); return <View />; }
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(res => { resolve = res; }), resolve }; }

describe('EF-189 deterministic New Chat/send completion race', () => {
  beforeEach(() => { jest.clearAllMocks(); capturedContext = null; mockedChatStream.mockResolvedValue(); });

  it.each([['old completion before new completion', ['old', 'new']], ['new completion before old completion', ['new', 'old']]])('%s keeps the new intent authoritative', async (_label, order) => {
    let state: SendIntentState = { generation: 1, sessionId: 'S_old', mounted: true };
    const oldIntent = { intentGeneration: 1, sessionId: 'S_old' };
    state = { generation: 2, sessionId: null, mounted: true };
    state = { generation: 2, sessionId: 'S_new', mounted: true };
    const newIntent = { intentGeneration: 2, sessionId: 'S_new' };
    const accepted = order.map(name => isSendIntentCurrent(name === 'old' ? oldIntent : newIntent, state));
    expect(accepted).toEqual(order.map(name => name === 'new'));
    expect(isSendIntentCurrent(oldIntent, state)).toBe(false);
    expect(isSendIntentCurrent(newIntent, state)).toBe(true);
  });

  it('drops a deferred stale send in the real provider before it can start a stream', async () => {
    const oldStart = deferred<Awaited<ReturnType<typeof chatStart>>>();
    const successfulStart = { sessionId: 'backend-synthetic-session', emotionTag: 'neutral', eventKeyword: '', reactionLayer: 'synthetic reaction', frontFlowText: '', flowContext: { flowType: null, flowStage: null, flowStrength: null, flowConfidence: null, flowRisk: null } };
    mockedChatStart.mockImplementationOnce(() => oldStart.promise).mockResolvedValue(successfulStart);
    await render(<ChatProvider><Harness /></ChatProvider>);
    await waitFor(() => expect(capturedContext?.isHydrated).toBe(true));
    await act(async () => { capturedContext?.createNewChat(); });
    let oldSend!: Promise<boolean>;
    await act(async () => { oldSend = capturedContext!.sendMessage('synthetic-old'); });
    await waitFor(() => expect(mockedChatStart).toHaveBeenCalledTimes(1));
    await act(async () => { capturedContext?.createNewChat(); });
    expect(capturedContext?.currentSessionId).toBeNull();
    await act(async () => { oldStart.resolve(successfulStart); await oldSend; });
    expect(mockedChatStream).not.toHaveBeenCalled();
    expect(capturedContext?.currentSessionId).toBeNull();
    await act(async () => { await capturedContext?.sendMessage('synthetic-new'); });
    expect(mockedChatStream).toHaveBeenCalledTimes(1);
    expect(capturedContext?.currentSessionId).not.toBeNull();
  });
});
