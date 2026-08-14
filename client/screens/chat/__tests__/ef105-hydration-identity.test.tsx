import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatProvider, useChat } from '../contexts/ChatContext';
import { INSTALLATION_IDENTITY_STORAGE_KEY } from '../stores/installationIdentity';
import * as sessionStore from '../stores/sessionStore';
import type { ChatSession } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}));

jest.mock('../api/cozeApi', () => ({ chatStart: jest.fn(), chatStream: jest.fn() }));
jest.mock('../constants/roles', () => ({
  roles: [{ id: 'test-role', name: 'Test Role' }],
  getRoleById: jest.fn((id: string) => ({ id, name: 'Test Role' })),
}));
jest.mock('../stores/sessionStore', () => ({
  saveChatSessions: jest.fn().mockResolvedValue(undefined),
  getChatSessions: jest.fn(),
  createConversation: jest.fn(),
  fetchConversation: jest.fn(),
  persistMessage: jest.fn(),
}));

const currentUserId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const canonicalConversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const localMessages = [
  { id: 'local-message', role: 'user' as const, content: 'local history', timestamp: 1 },
];

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChatProvider>{children}</ChatProvider>
);

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'session-local',
    roleId: 'test-role',
    messages: localMessages,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

async function settleHydration(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 150));
  });
}

describe('EF-105 hydration identity proof', () => {
  let identityRaw: string | null;
  let identityReadError: Error | null;
  let activeSession: ChatSession;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let traceSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    identityRaw = JSON.stringify({ schemaVersion: 1, userId: currentUserId });
    identityReadError = null;
    activeSession = session({
      conversationId: canonicalConversationId,
      canonicalConversationUserId: currentUserId,
    });
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    traceSpy = jest.spyOn(console, 'trace').mockImplementation(() => undefined);
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => {
      if (key === INSTALLATION_IDENTITY_STORAGE_KEY) {
        if (identityReadError) throw identityReadError;
        return identityRaw;
      }
      if (key === 'current_session_id') return activeSession.id;
      if (key === 'current_role_id') return activeSession.roleId;
      return null;
    });
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (sessionStore.getChatSessions as jest.Mock).mockImplementation(async () => [activeSession]);
    (sessionStore.fetchConversation as jest.Mock).mockResolvedValue({
      conversation: { id: canonicalConversationId, roleId: 'test-role' },
      messages: [
        { id: 'backend-message', role: 'assistant', content: 'backend history', timestamp: 2 },
      ],
    });
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
    traceSpy.mockRestore();
  });

  it('hydrates a proven matching mapping and reconciles backend history', async () => {
    const { result, unmount } = await renderHook(() => useChat(), { wrapper });
    await settleHydration();
    expect(sessionStore.fetchConversation).toHaveBeenCalledWith(canonicalConversationId);
    expect(result.current?.messages.map(message => message.content)).toEqual(['backend history']);
    unmount();
  });

  it.each([
    ['missing mapping', {}],
    ['pre-EF-105 UUID', { conversationId: canonicalConversationId }],
    ['provisional mapping', { conversationId: 'conv_legacy' }],
    ['mismatched identity', {
      conversationId: canonicalConversationId,
      canonicalConversationUserId: otherUserId,
    }],
  ])('does not hydrate %s and preserves local history', async (_label, mapping) => {
    activeSession = session(mapping);
    const { result, unmount } = await renderHook(() => useChat(), { wrapper });
    await settleHydration();
    expect(sessionStore.fetchConversation).not.toHaveBeenCalled();
    expect(result.current?.messages).toEqual(localMessages);
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(
      INSTALLATION_IDENTITY_STORAGE_KEY,
      expect.anything(),
    );
    unmount();
  });

  it.each([
    ['missing identity', null],
    ['corrupt identity', '{broken'],
  ])('does not hydrate for %s or rewrite storage', async (_label, storedIdentity) => {
    identityRaw = storedIdentity;
    const { result, unmount } = await renderHook(() => useChat(), { wrapper });
    await settleHydration();
    expect(sessionStore.fetchConversation).not.toHaveBeenCalled();
    expect(result.current?.messages).toEqual(localMessages);
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(
      INSTALLATION_IDENTITY_STORAGE_KEY,
      expect.anything(),
    );
    unmount();
  });

  it('does not enter the identity write path when the identity is missing', async () => {
    identityRaw = null;
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string) => {
      if (key === INSTALLATION_IDENTITY_STORAGE_KEY) {
        throw new Error('synthetic identity write failure');
      }
    });
    const { result, unmount } = await renderHook(() => useChat(), { wrapper });
    await settleHydration();
    expect(sessionStore.fetchConversation).not.toHaveBeenCalled();
    expect(result.current?.messages).toEqual(localMessages);
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(
      INSTALLATION_IDENTITY_STORAGE_KEY,
      expect.anything(),
    );
    unmount();
  });

  it('fails closed on identity read failure and a later successful read can hydrate', async () => {
    identityReadError = new Error('synthetic identity read failure');
    const first = await renderHook(() => useChat(), { wrapper });
    await settleHydration();
    expect(sessionStore.fetchConversation).not.toHaveBeenCalled();
    expect(first.result.current?.messages).toEqual(localMessages);
    first.unmount();

    jest.clearAllMocks();
    identityReadError = null;
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => {
      if (key === INSTALLATION_IDENTITY_STORAGE_KEY) return identityRaw;
      if (key === 'current_session_id') return activeSession.id;
      if (key === 'current_role_id') return activeSession.roleId;
      return null;
    });
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (sessionStore.getChatSessions as jest.Mock).mockResolvedValue([activeSession]);
    (sessionStore.fetchConversation as jest.Mock).mockResolvedValue({
      conversation: { id: canonicalConversationId, roleId: 'test-role' },
      messages: [
        { id: 'backend-message', role: 'assistant', content: 'backend history', timestamp: 2 },
      ],
    });
    const second = await renderHook(() => useChat(), { wrapper });
    await settleHydration();
    expect(sessionStore.fetchConversation).toHaveBeenCalledWith(canonicalConversationId);
    expect(second.result.current?.messages.map(message => message.content)).toEqual(['backend history']);
    second.unmount();
  });

  it('never includes raw stable identity values in hydration diagnostics', async () => {
    activeSession = session({
      conversationId: canonicalConversationId,
      canonicalConversationUserId: otherUserId,
    });
    const { unmount } = await renderHook(() => useChat(), { wrapper });
    await settleHydration();
    const diagnostics = JSON.stringify([
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
      ...logSpy.mock.calls,
      ...traceSpy.mock.calls,
    ]);
    expect(diagnostics).not.toContain(currentUserId);
    expect(diagnostics).not.toContain(otherUserId);
    expect(diagnostics).not.toContain(canonicalConversationId);
    unmount();
  });
});
