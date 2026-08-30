import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const authenticateAnonymousRequest = jest.fn(async (req: { get: (name: string) => string | undefined }) => {
  const value = req.get('authorization');
  if (value === 'Bearer owner-a-token') {
    return { ok: true, session: { id: 'owner-a', transport: 'native', expiresAt: Date.now() + 60_000, csrfHash: null } };
  }
  if (value === 'Bearer owner-b-token') {
    return { ok: true, session: { id: 'owner-b', transport: 'native', expiresAt: Date.now() + 60_000, csrfHash: null } };
  }
  return { ok: false, kind: 'invalid' };
});
const verifyOwnedConversation = jest.fn(async (owner: string, conversation: string) =>
  owner === 'owner-a' && conversation === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' ? 'owned' : 'missing');

jest.unstable_mockModule('../security/anonymousSession', () => ({
  EF75_WEB_ORIGIN: 'https://dev.douhaoyu.cn',
  authenticateAnonymousRequest,
  verifyOwnedConversation,
  sendAnonymousFailure: (res: { status: (code: number) => { json: (body: unknown) => unknown } }, kind: string) =>
    res.status(kind === 'request_not_allowed' ? 403 : kind === 'internal' ? 500 : 401)
      .json({ error: kind === 'request_not_allowed' ? 'request_not_allowed' : kind === 'internal' ? 'internal_server_error' : 'anonymous_session_invalid' }),
}));
jest.unstable_mockModule('../routes/anonymousSessions', () => ({ default: express.Router() }));
jest.unstable_mockModule('../routes/conversations', () => ({ default: express.Router() }));

const { app } = await import('../index');
const CONVERSATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('EF-75 chat start/stream production ownership path', () => {
  beforeEach(() => {
    authenticateAnonymousRequest.mockClear();
    verifyOwnedConversation.mockClear();
  });

  test('chat/start verifies the persisted conversation before creating a response run', async () => {
    const response = await request(app)
      .post('/api/v1/chat/start')
      .set('Authorization', 'Bearer owner-b-token')
      .send({ roleId: 'clever-fox', message: '你好', conversationId: CONVERSATION });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'resource_not_found' });
    expect(verifyOwnedConversation).toHaveBeenCalledWith('owner-b', CONVERSATION);
  });

  test('a response-run id cannot be substituted by another anonymous owner', async () => {
    const started = await request(app)
      .post('/api/v1/chat/start')
      .set('Authorization', 'Bearer owner-a-token')
      .send({ roleId: 'clever-fox', message: '你好', conversationId: CONVERSATION });
    expect(started.status).toBe(200);
    const substituted = await request(app)
      .get(`/api/v1/chat/stream?sessionId=${started.body.sessionId}`)
      .set('Authorization', 'Bearer owner-b-token');
    expect(substituted.status).toBe(404);
    expect(substituted.body).toEqual({ error: 'resource_not_found' });
  });

  test('debug session surface is no longer externally routed', async () => {
    const response = await request(app).get('/api/v1/debug/last-prompt');
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('sessions');
  });

  test('cross-origin reads receive no credentialed CORS grant', async () => {
    const response = await request(app)
      .get('/api/v1/version')
      .set('Origin', 'https://evil.example');
    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  test('the configured HTTPS Origin receives the exact credentialed CORS grant', async () => {
    const response = await request(app)
      .get('/api/v1/version')
      .set('Origin', 'https://dev.douhaoyu.cn');
    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://dev.douhaoyu.cn');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
});
