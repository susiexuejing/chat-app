/**
 * EM-43 Client Tests: chatStart serialization
 * 
 * Tests that chatStart correctly serializes the request body with
 * roleId, message, conversationId, and requestId.
 */

import { chatStart } from '../api/cozeApi';

// Mock global fetch
const mockFetch = jest.fn();
(globalThis as any).fetch = mockFetch;

describe('EM-43: chatStart serialization', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        sessionId: 'test-session-id',
        emotion: 'neutral',
        event: null,
        keywords: [],
      }),
    });
  });

  it('sends correct URL with /api/v1 prefix', async () => {
    await chatStart('role-1', 'hello', 'conv-123', 'req-456');
    
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toContain('/api/v1/chat/start');
  });

  it('sends POST method', async () => {
    await chatStart('role-1', 'hello', 'conv-123', 'req-456');
    
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].method).toBe('POST');
  });

  it('sends correct Content-Type header', async () => {
    await chatStart('role-1', 'hello', 'conv-123', 'req-456');
    
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].headers['Content-Type']).toBe('application/json');
  });

  it('sends roleId in request body', async () => {
    await chatStart('role-1', 'hello', 'conv-123', 'req-456');
    
    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.roleId).toBe('role-1');
  });

  it('sends message in request body', async () => {
    await chatStart('role-1', 'hello world', 'conv-123', 'req-456');
    
    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.message).toBe('hello world');
  });

  it('sends conversationId in request body', async () => {
    await chatStart('role-1', 'hello', 'conv-123', 'req-456');
    
    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.conversationId).toBe('conv-123');
  });

  it('sends requestId in request body', async () => {
    await chatStart('role-1', 'hello', 'conv-123', 'req-456');
    
    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.requestId).toBe('req-456');
  });

  it('sends all required fields in request body', async () => {
    await chatStart('role-abc', 'test message', 'conv-xyz', 'req-123');
    
    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    
    expect(body).toEqual({
      roleId: 'role-abc',
      message: 'test message',
      conversationId: 'conv-xyz',
      requestId: 'req-123',
    });
  });
});
