import { Platform } from 'react-native';
import { chatStart, chatStream } from '../api/cozeApi';

const userId = '11111111-1111-4111-8111-111111111111';
const conversationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const responseRunId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const clientSessionId = 'session_local_1';

describe('EF-105 API identity transport', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  });

  it('sends installation userId and canonical conversationId through chat/start', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ sessionId: responseRunId }),
    } as Response);

    await chatStart('clever-fox', 'hello', conversationId, 'req-1', undefined, userId);

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(request.body as string);
    expect(body).toEqual({
      roleId: 'clever-fox',
      message: 'hello',
      userId,
      conversationId,
      requestId: 'req-1',
    });
    expect(body.clientSessionId).toBeUndefined();
  });

  it('keeps stable identity out of the web URL and sends it in dedicated headers', async () => {
    const read = jest.fn().mockResolvedValue({ done: true, value: undefined });
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: () => ({ read }) },
    } as unknown as Response);

    await chatStream(responseRunId, {}, undefined, undefined, { userId, conversationId });

    const url = String(fetchMock.mock.calls[0][0]);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(url).toContain(`sessionId=${responseRunId}`);
    expect(url).not.toContain(userId);
    expect(url).not.toContain(conversationId);
    expect(url).not.toContain(clientSessionId);
    expect(request.headers).toEqual({
      'X-EmotionFlow-User-Id': userId,
      'X-EmotionFlow-Conversation-Id': conversationId,
    });
    expect(new Set([userId, conversationId, responseRunId]).size).toBe(3);
  });
});
