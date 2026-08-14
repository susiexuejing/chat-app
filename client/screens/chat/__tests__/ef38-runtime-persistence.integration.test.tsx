import React from 'react';
import { Text, View } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatProvider, useChat } from '../contexts/ChatContext';
import { chatStart, chatStream } from '../api/cozeApi';
import { getChatSessions, saveChatSessions } from '../stores/sessionStore';
import type { ChatSession } from '../types';

const mockStorage = new Map<string, string>();
const mockCommittedSessionSnapshots: ChatSession[][] = [];
let mockDelayedStaleWrite: (() => void) | null = null;
let mockDelayNextSessionWrite = false;
let mockSessionWritesToFail = 0;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      if (key === 'chat_sessions' && mockSessionWritesToFail > 0) {
        mockSessionWritesToFail -= 1;
        return Promise.reject(new Error('synthetic storage failure'));
      }
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

jest.mock('../stores/sessionStore', () => ({
  ...jest.requireActual('../stores/sessionStore'),
  createConversation: jest.fn(async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })),
}));

const mockedChatStart = chatStart as jest.MockedFunction<typeof chatStart>;
const mockedChatStream = chatStream as jest.MockedFunction<typeof chatStream>;

interface CapturedContext {
  isHydrated: boolean;
  turnStatus: string;
  isLoading: boolean;
  canRetry: boolean;
  sessions: ChatSession[];
  sendMessage: (text: string) => Promise<boolean>;
  deleteSession: (sessionId: string) => Promise<void>;
}

let capturedContext: CapturedContext | null = null;

function Harness() {
  const context = useChat();
  React.useEffect(() => {
    capturedContext = {
      isHydrated: context.isHydrated,
      turnStatus: context.turnStatus,
      isLoading: context.isLoading,
      canRetry: context.canRetry,
      sessions: context.sessions,
      sendMessage: context.sendMessage,
      deleteSession: context.deleteSession,
    };
  }, [context]);

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
    mockSessionWritesToFail = 0;
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

  it('does not resubmit a hydrated snapshot that can overwrite a committed generating turn', async () => {
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
    await saveChatSessions([initialSession]);
    mockStorage.set('current_session_id', sessionId);

    let resolveStream: (() => void) | null = null;
    mockedChatStream.mockImplementation(() => new Promise<void>((resolve) => {
      resolveStream = resolve;
    }));

    // Arm a trap for any write-back of the old hydrated array. A read-only
    // hydration must not submit this stale idle snapshot for persistence.
    mockDelayNextSessionWrite = true;
    const firstProvider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitFor(() => expect(capturedContext?.isHydrated).toBe(true));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockDelayedStaleWrite).toBeNull();
    mockDelayNextSessionWrite = false;

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

    expect((await getChatSessions())[0]).toMatchObject({
      id: sessionId,
      turnStatus: 'generating',
      chatPhase: 'responding',
    });

    await firstProvider.unmount();
    await act(async () => {
      resolveStream?.();
      await abandonedSend;
    });

    const recoveredProvider = await render(<ChatProvider><Harness /></ChatProvider>);
    await waitFor(() => expect(capturedContext?.isHydrated).toBe(true));

    // The durable generating state is converted by real hydration.
    await waitFor(() => {
      expect(capturedContext?.turnStatus).toBe('interrupted');
      expect(capturedContext?.isLoading).toBe(false);
      expect(capturedContext?.canRetry).toBe(true);
    });
    expect(recoveredProvider.getByText('Retry visible')).toBeTruthy();
  });

  it('persists session deletion explicitly without the removed generic effect', async () => {
    const sessions: ChatSession[] = [
      {
        id: 'session-synthetic-keep',
        roleId: 'smart-fox',
        messages: [],
        createdAt: 1,
        updatedAt: 2,
        chatPhase: 'done',
        turnStatus: 'completed',
      },
      {
        id: 'session-synthetic-delete',
        roleId: 'smart-fox',
        messages: [],
        createdAt: 1,
        updatedAt: 1,
        chatPhase: 'done',
        turnStatus: 'completed',
      },
    ];
    await saveChatSessions(sessions);
    mockStorage.set('current_session_id', sessions[0].id);

    await render(<ChatProvider><Harness /></ChatProvider>);
    await waitFor(() => expect(capturedContext?.isHydrated).toBe(true));

    await act(async () => {
      await capturedContext?.deleteSession('session-synthetic-delete');
    });

    expect(capturedContext?.sessions.map(session => session.id))
      .toEqual(['session-synthetic-keep']);
    expect((await getChatSessions()).map(session => session.id))
      .toEqual(['session-synthetic-keep']);
  });

  it('rejects a turn transition when its durable write cannot be verified', async () => {
    mockStorage.set('current_role_id', 'clever-fox');
    mockedChatStream.mockResolvedValue();
    await render(<ChatProvider><Harness /></ChatProvider>);
    await waitFor(() => expect(capturedContext?.isHydrated).toBe(true));

    // The legacy helper absorbs the first adapter rejection; the canonical
    // write must still reject and propagate the second one.
    mockSessionWritesToFail = 2;
    await expect(capturedContext?.sendMessage('Synthetic failed durability turn'))
      .rejects.toThrow(/durable write failed/);
    expect(await getChatSessions()).toEqual([]);
  });
});
