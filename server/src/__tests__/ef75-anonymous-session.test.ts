import { jest } from '@jest/globals';
import http from 'node:http';
import express from 'express';
import request from 'supertest';

const getSupabaseClient = jest.fn();
jest.unstable_mockModule('../storage/database/supabase-client', () => ({ getSupabaseClient }));

const {
  hashAnonymousSecret,
  requireAnonymousSession,
  getVerifiedAnonymousSession,
} = await import('../security/anonymousSession');

const TOKEN = 'A'.repeat(43);
const OWNER = '11111111-1111-4111-8111-111111111111';

const loopbackServers: http.Server[] = [];

async function loopbackRequest(app: express.Express) {
  const server = http.createServer(app);
  loopbackServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port: 0, host: '127.0.0.1' }, resolve);
  });
  return request(server);
}

afterEach(async () => {
  await Promise.all(loopbackServers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

function clientWithSession(overrides: Record<string, unknown> = {}) {
  const row = {
    id: OWNER,
    credential_hash: hashAnonymousSecret(TOKEN),
    transport: 'native',
    csrf_hash: null,
    expires_at: Date.now() + 60_000,
    revoked_at: null,
    ...overrides,
  };
  const chain: Record<string, unknown> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => ({ data: row, error: null }));
  return { from: jest.fn(() => chain) };
}

function makeApp() {
  const app = express();
  app.get('/protected', requireAnonymousSession, (_req, res) => {
    res.json({ owner: getVerifiedAnonymousSession(res).id });
  });
  return app;
}

describe('EF-75 native anonymous session verification', () => {
  beforeEach(() => getSupabaseClient.mockReset());

  test('accepts only an active server-issued native credential', async () => {
    getSupabaseClient.mockReturnValue(clientWithSession());
    const response = await (await loopbackRequest(makeApp()))
      .get('/protected')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ owner: OWNER });
  });

  test.each([
    ['missing', undefined, {}],
    ['malformed', 'Bearer short', {}],
    ['expired', `Bearer ${TOKEN}`, { expires_at: Date.now() - 1 }],
    ['revoked', `Bearer ${TOKEN}`, { revoked_at: Date.now() }],
    ['wrong transport', `Bearer ${TOKEN}`, { transport: 'web' }],
  ])('%s credential fails with the same non-disclosing response', async (_label, header, row) => {
    getSupabaseClient.mockReturnValue(clientWithSession(row));
    const pending = (await loopbackRequest(makeApp())).get('/protected');
    if (header) pending.set('Authorization', header);
    const response = await pending;
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'anonymous_session_invalid' });
  });

  test('browser metadata cannot enter native bearer mode', async () => {
    getSupabaseClient.mockReturnValue(clientWithSession());
    const response = await (await loopbackRequest(makeApp()))
      .get('/protected')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('Origin', 'https://dev.douhaoyu.cn');
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'request_not_allowed' });
  });
});
