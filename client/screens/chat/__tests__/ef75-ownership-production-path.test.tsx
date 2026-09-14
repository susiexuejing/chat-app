import { createConversation, fetchConversation, persistMessage } from '../stores/sessionStore';
import { getAnonymousRequestOptions } from '../stores/anonymousSession';
import { Platform } from 'react-native';

jest.mock('../stores/anonymousSession', () => ({
  getAnonymousRequestOptions: jest.fn(async (_baseUrl: string, method: string) => ({
    credentials: 'include',
    headers: method === 'POST' ? { 'X-EF-CSRF': 'csrf-proof' } : {},
  })),
}));

describe('EF-75 protected conversation client production path', () => {
  const originalPlatform = Platform.OS;
  const originalBackendBaseUrl = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
    process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'https://dev.douhaoyu.cn';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
    if (originalBackendBaseUrl === undefined) {
      delete process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_BACKEND_BASE_URL = originalBackendBaseUrl;
    }
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  });

  it('never transports client installation identity as owner authority', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: conversationId }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'message' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ conversation: { id: conversationId }, messages: [] }) } as Response);

    await createConversation(userId, 'clever-fox');
    await persistMessage(conversationId, { role: 'user', content: 'hello', status: 'sent' });
    await fetchConversation(conversationId);

    const serialized = JSON.stringify(fetchSpy.mock.calls);
    expect(serialized).not.toContain(userId);
    expect(serialized).not.toContain('X-EmotionFlow-User-Id');
    expect(serialized).not.toContain('X-EmotionFlow-Conversation-Id');
    expect(fetchSpy.mock.calls[0][1]).toEqual(expect.objectContaining({
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-EF-CSRF': 'csrf-proof' },
      body: JSON.stringify({ roleId: 'clever-fox' }),
    }));
    expect(getAnonymousRequestOptions).toHaveBeenCalledTimes(3);
  });

  it('uses the current HTTPS origin on web when no backend address is configured', async () => {
    delete process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { origin: 'https://dev.douhaoyu.cn' } },
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, json: async () => ({ id: 'conversation' }) } as Response);

    await createConversation('browser-installation-id', 'clever-fox');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://dev.douhaoyu.cn/api/v1/conversations',
      expect.objectContaining({
        credentials: 'include',
        body: JSON.stringify({ roleId: 'clever-fox' }),
      }),
    );
    expect(getAnonymousRequestOptions).toHaveBeenCalledWith('https://dev.douhaoyu.cn', 'POST');
    expect(JSON.stringify(fetchSpy.mock.calls)).not.toContain('browser-installation-id');
  });

  it('fails closed without a request for an unsafe web origin', async () => {
    delete process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { origin: 'null' } },
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await expect(createConversation('browser-installation-id', 'clever-fox')).resolves.toBeNull();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getAnonymousRequestOptions).not.toHaveBeenCalled();
  });

  it('fails closed without a request on native when no backend address is configured', async () => {
    delete process.env.EXPO_PUBLIC_BACKEND_BASE_URL;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { origin: 'https://dev.douhaoyu.cn' } },
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await expect(createConversation('browser-installation-id', 'clever-fox')).resolves.toBeNull();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getAnonymousRequestOptions).not.toHaveBeenCalled();
  });
});
