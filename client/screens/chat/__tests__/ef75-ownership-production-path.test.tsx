import { createConversation, fetchConversation, persistMessage } from '../stores/sessionStore';
import { getAnonymousRequestOptions } from '../stores/anonymousSession';

jest.mock('../stores/anonymousSession', () => ({
  getAnonymousRequestOptions: jest.fn(async (_baseUrl: string, method: string) => ({
    credentials: 'include',
    headers: method === 'POST' ? { 'X-EF-CSRF': 'csrf-proof' } : {},
  })),
}));

describe('EF-75 protected conversation client production path', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    process.env.EXPO_PUBLIC_BACKEND_BASE_URL = 'https://dev.douhaoyu.cn';
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

  it('creates a canonical conversation on DEV when the public backend variable is empty', async () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { protocol: 'https:', hostname: 'dev.douhaoyu.cn' } },
    });
    process.env.EXPO_PUBLIC_BACKEND_BASE_URL = '';
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) } as Response);

    try {
      await expect(createConversation('11111111-1111-4111-8111-111111111111', 'clever-fox'))
        .resolves.toEqual({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://dev.douhaoyu.cn/api/v1/conversations',
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      );
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    }
  });
});
