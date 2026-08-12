import React from 'react';
import { Text, View } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatProvider, useChat } from '../contexts/ChatContext';
import { chatStart, chatStream } from '../api/cozeApi';
import { getChatSessions } from '../stores/sessionStore';
import type { ChatSession } from '../types';

const mockStorage = new Map<string, string>();
const mockCommittedSessionSnapshots: ChatSession[][] = [];
let mockDelayedStaleWrite: (() => void) | null = null;
let mockDelayNextSessionWrite = false;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      if (key === 'chat_sessions' && mockDelayNextSessionWrite) {
        mockDelayNextSessionWrite = false;
        return new Promise<void>((resolve) => {
          mockDelayedStaleWrite = () => {
            mockStorage.set(key, value);
            mockCommittedSessionSnapshots.push(JSON.parse(value));
            resolve();
          };
        });
      }

      mockStorage.set(key, value);
      if (key === 'chat_sessions') {
        mockCommittedSessionSnapshots.push(JSON.parse(value));
      }
      return Promise.resolve();
    }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
    clear: jest.fn(async () => { mockStorage.clear(); }),
  },
}));

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: () => null }));

jest.mock('../api/cozeApi', () => ({
  chatStart: jest.fn(),
  chatStream: jest.fn(),
}));

const mockedChatStart = chatStart as jest.MockedFunction<typeof chatStart>;
const mockedChatStream = chatStream as jest.MockedFunction<typeof chatStream>;

interface CapturedContext {
  isHydrated: boolean;
  turnStatus: string;
  isLoading: boolean;
  canRetry: boolean;
  sendMessage: (text: string) => Promise<boolean>;
}

let capturedContext: CapturedContext | null = null;

function Harness() {
  const context = useChat();
  capturedContext = {
    isHydrated: context.isHydrated,
    turnStatus: context.turnStatus,
    isLoading: context.isLoading,
    canRetry: context.canRetry,
    sendMessage: context.sendMessage,
  };

  return (
    <View>
      <Text testID="turn-status">{context.turnStatus}</Text>
      {context.canRetry ? <Text>Retry visible</Text> : null}
    </View>
  );
}

describe('EF-38 runtime persistence integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
    mockCommittedSessionSnapshots.length = 0;
    mockDelayedStaleWrite = null;
    mockDelayNextSessionWrite = false;
    capturedContext = null;

    mockedChatStart.mockResolvedValue({
      sessionId: 'backend-synthetic-session',
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
  });

  it('preserves a committed generating turn when an older whole-array write completes later', async () => {
    const sessionId = 'session-synthetic-runtime-race';
    const initialSession: ChatSession = {
      id: sessionId,
      roleId: 'smart-fox',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      conversationId: 'conversation-synthetic-runtime-race',
      chatPhase: 'idle',
      turnStatus: 'idle',
    };
    mockStorage.set('chat_sessions', JSON.stringify([initialSession]));
    mockStorage.set('current_session_id', sessionId);

    let resolveStream: (() => void) | null = null;
    mockedChatStream.mockImplementation(() => new Promise<void>((resolve) => {
      resolveStream = resolve;
    }));

    // Hydration's generic persistence effect captures the old idle array. Keep
    // that write in flight so it can finish after the explicit generating write.
    mockDelayNextSessionWrite = true;
    const firstProvider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitFor(() => expect(capturedContext?.isHydrated).toBe(true));
    await waitFor(() => expect(mockDelayedStaleWrite).not.toBeNull());

    let abandonedSend: Promise<boolean> | undefined;
    await act(async () => {
      abandonedSend = capturedContext?.sendMessage('Synthetic runtime turn');
      await Promise.resolve();
    });

    await waitFor(() => {
      const committedGenerating = mockCommittedSessionSnapshots.some(sessions =>
        sessions.some(session =>
          session.id === sessionId
          && session.turnStatus === 'generating'
          && !!session.pendingTurn?.requestId
          && !!session.pendingTurn?.userMessageId
        )
      );
      expect(committedGenerating).toBe(true);
      expect(capturedContext?.turnStatus).toBe('generating');
    });

    // Reproduce the production failure: the earlier idle snapshot commits last.
    await act(async () => { mockDelayedStaleWrite?.(); });
    expect((await getChatSessions())[0]).toMatchObject({
      id: sessionId,
      turnStatus: 'idle',
      chatPhase: 'idle',
    });

    await firstProvider.unmount();
    await act(async () => {
      resolveStream?.();
      await abandonedSend;
    });

    const recoveredProvider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitFor(() => expect(capturedContext?.isHydrated).toBe(true));

    // This is the required closed loop. It fails before the persistence fix
    // because hydration sees the stale idle snapshot instead of generating.
    await waitFor(() => {
      expect(capturedContext?.turnStatus).toBe('interrupted');
      expect(capturedContext?.isLoading).toBe(false);
      expect(capturedContext?.canRetry).toBe(true);
    });
    expect(recoveredProvider.getByText('Retry visible')).toBeTruthy();
  });
});
