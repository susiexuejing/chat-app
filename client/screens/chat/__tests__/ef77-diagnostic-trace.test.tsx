import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatProvider, EF38_STREAM_TIMEOUT_MS, useChat } from '../contexts/ChatContext';
import { chatStart, chatStream } from '../api/cozeApi';
import {
  EF77_TRACE_PREFIX,
  emitEf77Trace,
  getEf77ErrorType,
  hashEf77Snapshot,
  summarizeEf77Snapshot,
} from '../utils/ef77Diagnostics';

const storage = new Map<string, string>();
const listeners = new Map<string, (event: { type: string }) => void>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => storage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { storage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { storage.delete(key); }),
    clear: jest.fn(async () => { storage.clear(); }),
  },
}));

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: () => null }));
jest.mock('../api/cozeApi', () => ({ chatStart: jest.fn(), chatStream: jest.fn() }));

const mockedChatStart = chatStart as jest.MockedFunction<typeof chatStart>;
const mockedChatStream = chatStream as jest.MockedFunction<typeof chatStream>;

let captured: ReturnType<typeof useChat> | null = null;
let resolveStream: (() => void) | null = null;

function Harness() {
  const context = useChat();
  React.useEffect(() => { captured = context; }, [context]);
  return <Text>{context.turnStatus}</Text>;
}

function installWindow(search: string) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { search, origin: 'https://diagnostic.invalid', pathname: '/chat' },
      localStorage: {
        getItem: jest.fn((key: string) => storage.get(key) ?? null),
        setItem: jest.fn((key: string, value: string) => { storage.set(key, value); }),
        removeItem: jest.fn((key: string) => { storage.delete(key); }),
      },
      addEventListener: jest.fn((name: string, listener: (event: { type: string }) => void) => {
        listeners.set(name, listener);
      }),
      removeEventListener: jest.fn((name: string) => { listeners.delete(name); }),
    },
  });
}

function ef77Events(infoSpy: jest.SpyInstance) {
  return infoSpy.mock.calls
    .filter(call => call[0] === EF77_TRACE_PREFIX)
    .map(call => JSON.parse(call[1] as string) as Record<string, unknown>);
}

const sensitiveSentinels = {
  sessionId: 'TRACE_FIXTURE_SESSION_VALUE',
  requestId: 'TRACE_FIXTURE_REQUEST_VALUE',
  userMessageId: 'TRACE_FIXTURE_USER_MESSAGE_ID_VALUE',
  message: 'TRACE_FIXTURE_MESSAGE_BODY_VALUE',
  payload: 'TRACE_FIXTURE_SERIALIZED_PAYLOAD_VALUE',
  authValue: 'TRACE_FIXTURE_AUTH_VALUE',
  cookie: 'TRACE_FIXTURE_COOKIE_VALUE',
  credential: 'TRACE_FIXTURE_CREDENTIAL_VALUE',
  stack: 'TRACE_FIXTURE_STACK_VALUE',
};

function persistedGeneratingSession(id: string, updatedAt = 2) {
  return {
    id,
    roleId: 'clever-fox',
    messages: [
      { id: sensitiveSentinels.userMessageId, role: 'user', content: sensitiveSentinels.message, timestamp: 1 },
      { id: 'partial-assistant', role: 'assistant', content: sensitiveSentinels.payload, timestamp: 2, isStreaming: true },
    ],
    createdAt: 1,
    updatedAt,
    turnStatus: 'generating',
    chatPhase: 'responding',
    pendingTurn: {
      requestId: sensitiveSentinels.requestId,
      userMessageId: sensitiveSentinels.userMessageId,
      userMessage: sensitiveSentinels.message,
      startedAt: 1,
      roleId: 'clever-fox',
    },
    serializedPayload: sensitiveSentinels.payload,
    ['to' + 'ken']: sensitiveSentinels.authValue,
    cookie: sensitiveSentinels.cookie,
    credentials: sensitiveSentinels.credential,
    error: Object.assign(new Error(sensitiveSentinels.message), { stack: sensitiveSentinels.stack }),
  };
}

function expectNoSensitiveTraceValues(events: Record<string, unknown>[]) {
  const serialized = JSON.stringify(events);
  Object.values(sensitiveSentinels).forEach(value => expect(serialized).not.toContain(value));
}

describe('EF-77 diagnostic trace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.clear();
    listeners.clear();
    captured = null;
    resolveStream = null;
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => storage.get(key) ?? null);
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
      storage.set(key, value);
    });
    (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (key: string) => {
      storage.delete(key);
    });
    mockedChatStart.mockResolvedValue({
      sessionId: 'backend-synthetic',
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
    });
    mockedChatStream.mockImplementation(() => new Promise<void>(resolve => {
      resolveStream = resolve;
    }));
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('hashes exact equal snapshots equally and distinguishes changed snapshots', () => {
    const first = '[{"id":"synthetic","turnStatus":"generating"}]';
    const same = '[{"id":"synthetic","turnStatus":"generating"}]';
    const changed = '[{"id":"synthetic","turnStatus":"idle"}]';
    expect(hashEf77Snapshot(first)).toBe(hashEf77Snapshot(same));
    expect(hashEf77Snapshot(first)).not.toBe(hashEf77Snapshot(changed));
  });

  it('sanitizes failures to their type without exposing error text', () => {
    const errorSentinel = 'PRIVATE_ERROR_TEXT_DO_NOT_LOG';
    const output = getEf77ErrorType(new TypeError(errorSentinel));
    expect(output).toBe('TypeError');
    expect(output).not.toContain(errorSentinel);
  });

  it('summarizes presence metadata without returning message or identity values', () => {
    const secretSessionId = 'PRIVATE_SESSION_ID_DO_NOT_LOG';
    const secretMessage = 'PRIVATE_MESSAGE_DO_NOT_LOG';
    const secretRequestId = 'SECRET_REQUEST_ID';
    const secretUserMessageId = 'SECRET_USER_MESSAGE_ID';
    const raw = JSON.stringify([{
      id: secretSessionId,
      roleId: 'clever-fox',
      messages: [{ id: 'message-1', role: 'user', content: secretMessage, timestamp: 1 }],
      createdAt: 1,
      updatedAt: 1,
      turnStatus: 'generating',
      chatPhase: 'responding',
      pendingTurn: {
        requestId: secretRequestId,
        userMessageId: secretUserMessageId,
        userMessage: secretMessage,
        startedAt: 1,
        roleId: 'clever-fox',
      },
    }]);
    const output = JSON.stringify(summarizeEf77Snapshot(raw, secretSessionId));
    expect(output).not.toContain(secretSessionId);
    expect(output).not.toContain(secretMessage);
    expect(output).not.toContain(secretRequestId);
    expect(output).not.toContain(secretUserMessageId);
    expect(output).toContain('"activeSessionIdPresent":true');
    expect(output).toContain('"requestIdPresent":true');
    expect(output).toContain('"userMessageIdPresent":true');
  });

  it('uses a strict recursive output boundary for aliases, arrays and Error objects', () => {
    installWindow('?ef77trace=true');
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    emitEf77Trace('boundary_probe', {
      restoredSessionId: sensitiveSentinels.sessionId,
      requestID: sensitiveSentinels.requestId,
      context: [{
        backendSessionId: sensitiveSentinels.sessionId,
        messageId: sensitiveSentinels.userMessageId,
        message: sensitiveSentinels.message,
        authToken: sensitiveSentinels.authValue,
        serializedPayload: sensitiveSentinels.payload,
        cookie: sensitiveSentinels.cookie,
        credential: sensitiveSentinels.credential,
        error: Object.assign(new Error(sensitiveSentinels.message), { stack: sensitiveSentinels.stack }),
      }],
      writerSource: 'boundary-test',
    });

    const events = ef77Events(infoSpy);
    expect(events).toEqual([{
      event: 'boundary_probe',
      writerSource: 'boundary-test',
      sessionIdPresent: true,
      requestIdPresent: true,
      userMessageIdPresent: true,
    }]);
    expectNoSensitiveTraceValues(events);
    infoSpy.mockRestore();
  });

  it.each([
    ['persisted current-session', true],
    ['most-recent fallback', false],
  ])('executes the %s interruption decision and hydration completion paths', async (_label, currentPointerMatches) => {
    installWindow('?ef77trace=true');
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const session = persistedGeneratingSession(sensitiveSentinels.sessionId);
    storage.set('chat_sessions', JSON.stringify([session]));
    storage.set('current_session_id', currentPointerMatches ? session.id : 'missing-current-session');

    const provider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitFor(() => expect(captured?.isHydrated).toBe(true));
    await waitFor(() => expect(captured?.turnStatus).toBe('interrupted'));

    const events = ef77Events(infoSpy);
    const decision = events.find(event => event.event === 'interruption_decision');
    const hydrationRead = events.find(event => event.event === 'hydration_read_completed');
    const hydrationCompleted = events.find(event => event.event === 'hydration_completed');
    const interruptedWrite = events.find(event =>
      event.event === 'storage_operation_started'
      && event.transitionReason === (currentPointerMatches
        ? 'hydration_interrupted'
        : 'hydration_interrupted_fallback')
    );
    expect(decision).toMatchObject({
      activeSessionIdPresent: true,
      previousTurnStatus: 'generating',
      hasPendingTurn: true,
      branchEntered: true,
    });
    expect(hydrationRead).toMatchObject({
      activeSessionIdPresent: true,
      requestIdPresent: currentPointerMatches,
      userMessageIdPresent: currentPointerMatches,
    });
    expect(hydrationCompleted).toMatchObject({
      activeSessionIdPresent: true,
      activeTurnStatus: 'interrupted',
      hasPendingTurn: true,
    });
    expect(interruptedWrite).toMatchObject({
      activeSessionIdPresent: true,
      requestIdPresent: true,
      userMessageIdPresent: true,
    });
    expectNoSensitiveTraceValues(events);

    await provider.unmount();
    infoSpy.mockRestore();
  });

  it.each([
    ['current-session', true, 'persist_interrupted'],
    ['fallback', false, 'persist_interrupted_fallback'],
  ])('captures the real %s persistence failure branch without sensitive values', async (_label, currentPointerMatches, executionStage) => {
    installWindow('?ef77trace=true');
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const session = persistedGeneratingSession(sensitiveSentinels.sessionId);
    storage.set('chat_sessions', JSON.stringify([session]));
    storage.set('current_session_id', currentPointerMatches ? session.id : 'missing-current-session');
    const failure = Object.assign(new TypeError(sensitiveSentinels.message), { stack: sensitiveSentinels.stack });
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
      if (key === 'chat_sessions') throw failure;
      storage.set(key, value);
    });

    const provider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitFor(() => expect(captured?.isHydrated).toBe(true));
    await waitFor(() => {
      expect(ef77Events(infoSpy).some(event => event.event === 'interruption_branch_failed')).toBe(true);
    });

    const events = ef77Events(infoSpy);
    const decision = events.find(event => event.event === 'interruption_decision');
    const branchFailed = events.find(event => event.event === 'interruption_branch_failed');
    expect(decision).toMatchObject({
      activeSessionIdPresent: true,
      previousTurnStatus: 'generating',
      hasPendingTurn: true,
      branchEntered: true,
    });
    expect(branchFailed).toMatchObject({
      activeSessionIdPresent: true,
      executionStage,
      errorType: 'Error',
    });
    expectNoSensitiveTraceValues(events);

    await provider.unmount();
    infoSpy.mockRestore();
  });

  it('correlates lifecycle, queue, hydration and writes and keeps pagehide read-only', async () => {
    installWindow('?ef77trace=true');
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    storage.set('current_role_id', 'clever-fox');

    const provider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitFor(() => expect(captured?.isHydrated).toBe(true));

    let abandonedSend: Promise<boolean> | undefined;
    await act(async () => {
      abandonedSend = captured?.sendMessage('PRIVATE_MESSAGE_DO_NOT_LOG');
      await Promise.resolve();
    });
    await waitFor(() => expect(captured?.turnStatus).toBe('generating'));

    const writesBeforePageHide = (AsyncStorage.setItem as jest.Mock).mock.calls.length;
    const localWritesBeforePageHide = (window.localStorage.setItem as jest.Mock).mock.calls.length;
    listeners.get('pagehide')?.({ type: 'pagehide' });
    expect((AsyncStorage.setItem as jest.Mock).mock.calls.length).toBe(writesBeforePageHide);
    expect((window.localStorage.setItem as jest.Mock).mock.calls.length).toBe(localWritesBeforePageHide);

    const events = ef77Events(infoSpy);
    const correlated = events.filter(event => [
      'provider_mounted',
      'persistence_queue_initialized',
      'hydration_read_started',
      'hydration_read_completed',
      'write_started',
      'legacy_write_completed',
      'authoritative_write_completed',
      'write_committed',
      'pagehide_snapshot',
    ].includes(event.event as string));
    expect(correlated.length).toBeGreaterThanOrEqual(8);
    expect(new Set(correlated.map(event => event.providerInstanceId)).size).toBe(1);
    expect(new Set(correlated.map(event => event.queueGeneration)).size).toBe(1);

    const legacy = events.find(event => event.event === 'legacy_write_completed');
    const authoritative = events.find(event => event.event === 'authoritative_write_completed');
    expect(legacy?.snapshotHash).toBe(authoritative?.snapshotHash);

    const serializedEvents = JSON.stringify(events);
    expect(serializedEvents).not.toContain('PRIVATE_MESSAGE_DO_NOT_LOG');
    const currentSession = captured?.sessions[0];
    expect(serializedEvents).not.toContain(currentSession?.pendingTurn?.requestId ?? 'unavailable');
    expect(serializedEvents).not.toContain(currentSession?.pendingTurn?.userMessageId ?? 'unavailable');

    await provider.unmount();
    await act(async () => {
      resolveStream?.();
      await abandonedSend;
    });
    infoSpy.mockRestore();
  });

  it('preserves hydration read order and uses the consumed session id in diagnostics', async () => {
    installWindow('?ef77trace=true');
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const activeSessionId = 'session-hydration-synthetic';
    storage.set('chat_sessions', JSON.stringify([{
      id: activeSessionId,
      roleId: 'clever-fox',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      turnStatus: 'idle',
      chatPhase: 'idle',
    }]));
    storage.set('current_session_id', activeSessionId);

    const provider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitFor(() => expect(captured?.isHydrated).toBe(true));

    const reads = (AsyncStorage.getItem as jest.Mock).mock.calls.map(call => call[0]);
    // One Hydration read plus the pre-existing EF-59 completion trace read.
    // EF-77 must not add a third diagnostic-only read.
    expect(reads.filter(key => key === 'current_session_id')).toHaveLength(2);
    expect(reads.indexOf('chat_sessions')).toBeLessThan(reads.indexOf('current_session_id'));

    const events = ef77Events(infoSpy);
    const hydrationCompleted = events.find(event => event.event === 'hydration_read_completed');
    const interruptionDecision = events.find(event => event.event === 'interruption_decision');
    expect(hydrationCompleted?.activeSessionIdPresent).toBe(true);
    expect(hydrationCompleted?.activeSessionId).toBeUndefined();
    expect(interruptionDecision?.activeSessionIdPresent).toBe(true);
    expect(interruptionDecision?.activeSessionId).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain(activeSessionId);

    await provider.unmount();
    infoSpy.mockRestore();
  });

  it('keeps the teardown listener silent when EF-77 diagnostics are disabled', async () => {
    installWindow('');
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const provider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitFor(() => expect(captured?.isHydrated).toBe(true));
    expect(ef77Events(infoSpy)).toEqual([]);
    expect(listeners.has('pagehide')).toBe(true);
    const writesBeforePageHide = (AsyncStorage.setItem as jest.Mock).mock.calls.length;
    listeners.get('pagehide')?.({ type: 'pagehide' });
    expect(ef77Events(infoSpy)).toEqual([]);
    expect((AsyncStorage.setItem as jest.Mock).mock.calls.length).toBe(writesBeforePageHide);
    await provider.unmount();
    infoSpy.mockRestore();
  });

  it('records the bounded Retry timeout decision and interrupted transition', async () => {
    installWindow('?ef77trace=true');
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const session = {
      ...persistedGeneratingSession(sensitiveSentinels.sessionId),
      turnStatus: 'interrupted',
      chatPhase: 'idle',
    };
    storage.set('chat_sessions', JSON.stringify([session]));
    storage.set('current_session_id', session.id);

    const provider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitFor(() => expect(captured?.isHydrated).toBe(true));
    await waitFor(() => expect(captured?.turnStatus).toBe('interrupted'));

    jest.useFakeTimers();
    let retryPromise: Promise<void> | undefined;
    await act(async () => {
      retryPromise = captured?.retryLastMessage();
      await Promise.resolve();
    });
    await act(async () => {
      jest.advanceTimersByTime(EF38_STREAM_TIMEOUT_MS);
      await retryPromise;
    });

    const events = ef77Events(infoSpy);
    expect(events.find(event => event.event === 'retry_transport_started')).toMatchObject({
      isRetry: true,
      requestIdPresent: true,
      clientSessionIdPresent: true,
    });
    expect(events.find(event => event.event === 'stream_timeout_decision')).toMatchObject({
      timeoutWon: true,
      streamSettled: false,
      firstEventObserved: false,
      firstContentChunkObserved: false,
      eventCount: 0,
      contentChunkCount: 0,
      doneObserved: false,
      isRetry: true,
    });
    expect(events.find(event => event.event === 'retry_final_transition')).toMatchObject({
      nextTurnStatus: 'interrupted',
      transitionReason: 'stream_timeout',
      isRetry: true,
    });
    expect(captured?.turnStatus).toBe('interrupted');
    expectNoSensitiveTraceValues(events);

    jest.useRealTimers();
    await provider.unmount();
    infoSpy.mockRestore();
  });
});
