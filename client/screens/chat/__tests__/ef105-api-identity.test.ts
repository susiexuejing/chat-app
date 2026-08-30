import { Platform } from 'react-native';
import { chatStart, chatStream } from '../api/cozeApi';

jest.mock('../stores/anonymousSession', () => ({
  getAnonymousRequestOptions: jest.fn(async (_baseUrl: string, method: string) => ({
    credentials: 'include',
    headers: method === 'POST' ? { 'X-EF-CSRF': 'csrf-proof' } : {},
  })),
}));

const userId = '11111111-1111-4111-8111-111111111111';
const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const responseRunId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const clientSessionId = 'session_local_1';

describe('EF-105 API identity transport', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  });

  it('sends no installation owner id and uses the protected web session', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ sessionId: responseRunId }),
    } as Response);

    await chatStart('clever-fox', 'hello', conversationId, 'req-1');

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(request.body as string);
    expect(body).toEqual({
      roleId: 'clever-fox',
      message: 'hello',
      conversationId,
      requestId: 'req-1',
    });
    expect(request.credentials).toBe('include');
    expect(request.headers).toEqual({
      'Content-Type': 'application/json',
      'X-EF-CSRF': 'csrf-proof',
    });
    expect(JSON.stringify(body)).not.toContain(userId);
    expect(body.clientSessionId).toBeUndefined();
  });

  it('keeps all owner identity out of the web URL and JavaScript headers', async () => {
    const read = jest.fn().mockResolvedValue({ done: true, value: undefined });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: () => ({ read }) },
    } as unknown as Response);

    await chatStream(responseRunId, {});

    const url = String(fetchMock.mock.calls[0][0]);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(url).toContain(`sessionId=${responseRunId}`);
    expect(url).not.toContain(userId);
    expect(url).not.toContain(conversationId);
    expect(url).not.toContain(clientSessionId);
    expect(request.credentials).toBe('include');
    expect(request.headers).toEqual({});
    expect(new Set([userId, conversationId, responseRunId]).size).toBe(3);
  });
});
