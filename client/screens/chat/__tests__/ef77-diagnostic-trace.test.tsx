import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatProvider, useChat } from '../contexts/ChatContext';
import { chatStart, chatStream } from '../api/cozeApi';
import {
  EF77_TRACE_PREFIX,
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

describe('EF-77 diagnostic trace', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.clear();
    listeners.clear();
    captured = null;
    resolveStream = null;
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

  it('summarizes presence metadata without returning message or identity values', () => {
    const secretMessage = 'PRIVATE_MESSAGE_DO_NOT_LOG';
    const secretRequestId = 'SECRET_REQUEST_ID';
    const secretUserMessageId = 'SECRET_USER_MESSAGE_ID';
    const raw = JSON.stringify([{
      id: 'session-synthetic',
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
    const output = JSON.stringify(summarizeEf77Snapshot(raw, 'session-synthetic'));
    expect(output).not.toContain(secretMessage);
    expect(output).not.toContain(secretRequestId);
    expect(output).not.toContain(secretUserMessageId);
    expect(output).toContain('"requestIdPresent":true');
    expect(output).toContain('"userMessageIdPresent":true');
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
    expect(correlated.length).toBeGreaterThanOrEqual(9);
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

  it('emits no EF-77 trace and installs no pagehide handler when disabled', async () => {
    installWindow('');
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const provider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitFor(() => expect(captured?.isHydrated).toBe(true));
    expect(ef77Events(infoSpy)).toEqual([]);
    expect(listeners.has('pagehide')).toBe(false);
    await provider.unmount();
    infoSpy.mockRestore();
  });
});
