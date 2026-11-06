import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatProvider, useChat } from '../contexts/ChatContext';
import { INSTALLATION_IDENTITY_STORAGE_KEY } from '../stores/installationIdentity';
import { getAnonymousRequestOptions } from '../stores/anonymousSession';
import * as sessionStore from '../stores/sessionStore';
import { chatStart, chatStream } from '../api/cozeApi';
import type { ChatSession } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(), clear: jest.fn(),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { EXPO_PUBLIC_BACKEND_BASE_URL: 'https://synthetic.invalid' } } },
}));
jest.mock('../api/cozeApi', () => ({ chatStart: jest.fn(), chatStream: jest.fn() }));
jest.mock('../constants/roles', () => ({
  roles: [{ id: 'test-role', name: 'Test Role' }],
  getRoleById: jest.fn((id: string) => ({ id, name: 'Test Role' })),
}));
jest.mock('../stores/anonymousSession', () => ({ getAnonymousRequestOptions: jest.fn() }));
jest.mock('../stores/sessionStore', () => ({
  saveChatSessions: jest.fn().mockResolvedValue(undefined),
  getChatSessions: jest.fn(), createConversation: jest.fn(),
  fetchConversation: jest.fn(), persistMessage: jest.fn(),
}));

const actualStore = jest.requireActual<typeof sessionStore>('../stores/sessionStore');
const userId = '11111111-1111-4111-8111-111111111111';
const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const identityRaw = JSON.stringify({ schemaVersion: 1, userId });
const localMessages = [{ id: 'local', role: 'user' as const, content: 'local history', timestamp: 1 }];
const session: ChatSession = {
  id: 'session-local', roleId: 'test-role', messages: localMessages,
  createdAt: 1, updatedAt: 1, conversationId, canonicalConversationUserId: userId,
};
const otherSession: ChatSession = {
  ...session, id: 'session-other', conversationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  messages: [{ ...localMessages[0], id: 'other-local', content: 'other local history' }],
};
const backendResult = {
  conversation: { id: conversationId, roleId: 'test-role' },
  messages: [{ id: 'backend', role: 'assistant', content: 'backend history', timestamp: 2 }],
};
const wrapper = ({ children }: { children: React.ReactNode }) => <ChatProvider>{children}</ChatProvider>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function flush() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
}

describe('EF-384 hydration lifetime isolation', () => {
  let identityRead: () => Promise<string | null>;
  let sessionIdRead: () => Promise<string | null>;
  let spies: jest.SpyInstance[];
  let fetchMock: jest.Mock;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    spies = ['log', 'warn', 'error', 'trace', 'info'].map(method =>
      jest.spyOn(console, method as 'log').mockImplementation(() => undefined));
    identityRead = async () => identityRaw;
    sessionIdRead = async () => session.id;
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => {
      if (key === INSTALLATION_IDENTITY_STORAGE_KEY) return identityRead();
      if (key === 'current_session_id') return sessionIdRead();
      if (key === 'current_role_id') return session.roleId;
      return null;
    });
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (sessionStore.getChatSessions as jest.Mock).mockResolvedValue([session, otherSession]);
    (sessionStore.fetchConversation as jest.Mock).mockResolvedValue(backendResult);
    (getAnonymousRequestOptions as jest.Mock).mockResolvedValue({ credentials: 'include', headers: {} });
    fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => backendResult });
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    spies.forEach(spy => spy.mockRestore());
  });

  it('does not start backend hydration when identity resolves after unmount', async () => {
    const pending = deferred<string | null>();
    identityRead = () => pending.promise;
    const { result, unmount } = await renderHook(() => useChat(), { wrapper });
    await flush();
    expect(result.current?.isHydrated).toBe(true);
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(INSTALLATION_IDENTITY_STORAGE_KEY);
    await unmount();
    pending.resolve(identityRaw);
    await flush();
    expect(sessionStore.fetchConversation).not.toHaveBeenCalled();
  });

  it('aborts and ignores a response arriving after unmount', async () => {
    const pending = deferred<typeof backendResult>();
    (sessionStore.fetchConversation as jest.Mock).mockReturnValue(pending.promise);
    const { unmount } = await renderHook(() => useChat(), { wrapper });
    await flush();
    const signal = (sessionStore.fetchConversation as jest.Mock).mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    await unmount();
    expect(signal.aborted).toBe(true);
    const messages = jest.fn(() => backendResult.messages);
    pending.resolve({ ...backendResult, get messages() { return messages(); } });
    await flush();
    // A mounted-state assertion alone cannot detect React silently dropping a stale update.
    expect(messages).not.toHaveBeenCalled();
  });

  it('keeps normal mounted backend history reconciliation', async () => {
    const { result, unmount } = await renderHook(() => useChat(), { wrapper });
    await flush();
    expect(sessionStore.fetchConversation).toHaveBeenCalledTimes(1);
    expect(result.current?.messages.map(message => message.content)).toEqual(['backend history']);
    await unmount();
  });

  it('ignores history when a same-session send starts before dependency cleanup', async () => {
    const history = deferred<typeof backendResult>();
    const sendIdentity = deferred<string | null>();
    (sessionStore.fetchConversation as jest.Mock).mockReturnValue(history.promise);
    const { result, unmount } = await renderHook(() => useChat(), { wrapper });
    await flush();
    const signal = (sessionStore.fetchConversation as jest.Mock).mock.calls[0][1] as AbortSignal;
    // Pause the send before it updates sessions, so effect cleanup cannot mask
    // the same-session race. withSendGuard has already accepted the live send.
    identityRead = () => sendIdentity.promise;
    let send: Promise<boolean> | undefined;
    const messages = jest.fn(() => backendResult.messages);
    await act(async () => {
      send = result.current!.sendMessage('new live message');
      history.resolve({ ...backendResult, get messages() { return messages(); } });
    });
    await flush();
    expect(signal.aborted).toBe(false);
    expect(result.current?.currentSessionId).toBe(session.id);
    expect(result.current?.messages).toEqual(localMessages);
    expect(messages).not.toHaveBeenCalled();
    expect(chatStart).not.toHaveBeenCalled();
    expect(chatStream).not.toHaveBeenCalled();
    // Finish the controlled send without initiating any transport or persistence.
    await unmount();
    sendIdentity.resolve(identityRaw);
    await act(async () => { await send; });
    expect(chatStart).not.toHaveBeenCalled();
    expect(chatStream).not.toHaveBeenCalled();
  });

  it('does not overwrite a newly selected session with the old response', async () => {
    const pending = deferred<typeof backendResult>();
    (sessionStore.fetchConversation as jest.Mock).mockReturnValue(pending.promise);
    const { result, unmount } = await renderHook(() => useChat(), { wrapper });
    await flush();
    const signal = (sessionStore.fetchConversation as jest.Mock).mock.calls[0][1] as AbortSignal;
    await act(async () => { result.current?.selectSession(otherSession.id); });
    pending.resolve(backendResult);
    await flush();
    expect(signal.aborted).toBe(true);
    expect(result.current?.messages).toEqual(otherSession.messages);
    expect(sessionStore.fetchConversation).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it('releases superseded identity proof without letting its late result clear the new attempt', async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    const reads = jest.fn().mockReturnValueOnce(first.promise).mockReturnValue(second.promise);
    identityRead = reads;
    const { result, unmount } = await renderHook(() => useChat(), { wrapper });
    await flush();
    await act(async () => { result.current?.selectSession(otherSession.id); });
    first.resolve(null);
    await flush();
    expect(sessionStore.fetchConversation).not.toHaveBeenCalled();
    second.resolve(identityRaw);
    await flush();
    expect(sessionStore.fetchConversation).toHaveBeenCalledTimes(1);
    expect(sessionStore.fetchConversation).toHaveBeenCalledWith(otherSession.conversationId, expect.any(AbortSignal));
    await unmount();
  });

  it('starts no recovery writes after a late persisted session pointer read', async () => {
    const pointer = deferred<string | null>();
    sessionIdRead = () => pointer.promise;
    (sessionStore.getChatSessions as jest.Mock).mockResolvedValue([{ ...session, turnStatus: 'generating' }]);
    const { unmount } = await renderHook(() => useChat(), { wrapper });
    await flush();
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('current_session_id');
    await unmount();
    (AsyncStorage.setItem as jest.Mock).mockClear();
    pointer.resolve('missing-pointer');
    await flush();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStore.saveChatSessions).not.toHaveBeenCalled();
    expect(sessionStore.fetchConversation).not.toHaveBeenCalled();
  });

  it('starts no next read when the session list arrives after unmount', async () => {
    const sessions = deferred<ChatSession[]>();
    (sessionStore.getChatSessions as jest.Mock).mockReturnValue(sessions.promise);
    const { unmount } = await renderHook(() => useChat(), { wrapper });
    await unmount();
    (AsyncStorage.getItem as jest.Mock).mockClear();
    (AsyncStorage.setItem as jest.Mock).mockClear();
    sessions.resolve([session]);
    await flush();
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('can hydrate a fresh mount after cancelling the previous identity read', async () => {
    const pending = deferred<string | null>();
    identityRead = () => pending.promise;
    const first = await renderHook(() => useChat(), { wrapper });
    await flush();
    await first.unmount();
    identityRead = async () => identityRaw;
    const second = await renderHook(() => useChat(), { wrapper });
    await flush();
    pending.resolve(identityRaw);
    await flush();
    expect(sessionStore.fetchConversation).toHaveBeenCalledTimes(1);
    expect(second.result.current?.messages.map(message => message.content)).toEqual(['backend history']);
    await second.unmount();
  });

  it('lets already accepted recovery persistence finish after unmount', async () => {
    const write = deferred<void>();
    let savedSessions: string | null = null;
    const read = (AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) =>
      key === 'chat_sessions' ? Promise.resolve(savedSessions) : read(key));
    (AsyncStorage.setItem as jest.Mock).mockImplementation((key: string, value: string) => {
      if (key === 'chat_sessions') {
        savedSessions = value;
        return write.promise;
      }
      return Promise.resolve();
    });
    (sessionStore.getChatSessions as jest.Mock).mockResolvedValue([{ ...session, turnStatus: 'generating' }]);
    const { unmount } = await renderHook(() => useChat(), { wrapper });
    await flush();
    expect(savedSessions).not.toBeNull();
    expect(JSON.parse(savedSessions!)[0].turnStatus).toBe('interrupted');
    await unmount();
    const acceptedWrites = (AsyncStorage.setItem as jest.Mock).mock.calls.length;
    write.resolve(undefined);
    await flush();
    expect((AsyncStorage.setItem as jest.Mock).mock.calls).toHaveLength(acceptedWrites);
    expect(sessionStore.fetchConversation).not.toHaveBeenCalled();
  });

  it('does not start fetch after anonymous request options resolve following cancellation', async () => {
    const auth = deferred<{ credentials: string; headers: Record<string, string> }>();
    (getAnonymousRequestOptions as jest.Mock).mockReturnValue(auth.promise);
    const controller = new AbortController();
    const result = actualStore.fetchConversation(conversationId, controller.signal);
    expect(getAnonymousRequestOptions).toHaveBeenCalledTimes(1);
    controller.abort();
    auth.resolve({ credentials: 'include', headers: {} });
    expect(await result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes the signal to fetch and discards late JSON', async () => {
    const body = deferred<typeof backendResult>();
    fetchMock.mockResolvedValue({ ok: true, json: () => body.promise });
    const controller = new AbortController();
    const result = actualStore.fetchConversation(conversationId, controller.signal);
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: controller.signal }));
    controller.abort();
    body.resolve(backendResult);
    expect(await result).toBeNull();
  });

  it('does not clean up corrupt storage after the owning hydration is cancelled', async () => {
    const storage = deferred<string | null>();
    (AsyncStorage.getItem as jest.Mock).mockReturnValue(storage.promise);
    const controller = new AbortController();
    const result = actualStore.getChatSessions(undefined, controller.signal);
    controller.abort();
    storage.resolve('undefined');
    expect(await result).toEqual([]);
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });
});

