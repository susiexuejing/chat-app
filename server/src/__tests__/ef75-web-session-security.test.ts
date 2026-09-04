import { jest } from '@jest/globals';
import http from 'node:http';
import express from 'express';
import request from 'supertest';

const getSupabaseClient = jest.fn();
jest.unstable_mockModule('../storage/database/supabase-client', () => ({ getSupabaseClient }));

const { default: anonymousSessionsRouter } = await import('../routes/anonymousSessions');
const {
  EF75_WEB_COOKIE_NAME,
  EF75_WEB_ORIGIN,
  hashAnonymousSecret,
  requireAnonymousSession,
} = await import('../security/anonymousSession');

const WEB_TOKEN = 'W'.repeat(43);
const CSRF = 'C'.repeat(43);

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

function chain(result: { data?: unknown; error?: unknown } = {}) {
  const value = { data: result.data ?? null, error: result.error ?? null };
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'update']) query[method] = jest.fn(() => query);
  query.insert = jest.fn(async () => value);
  query.maybeSingle = jest.fn(async () => value);
  query.then = (resolve: (arg: unknown) => unknown) => Promise.resolve(value).then(resolve);
  return query;
}

function makeApp(withProtected = false) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/anonymous-sessions', anonymousSessionsRouter);
  if (withProtected) {
    app.get('/protected', requireAnonymousSession, (_req, res) => res.json({ ok: true }));
    app.post('/protected', requireAnonymousSession, (_req, res) => res.json({ ok: true }));
  }
  return app;
}

describe('EF-75 web HttpOnly cookie and CSRF boundary', () => {
  beforeEach(() => getSupabaseClient.mockReset());

  test('issues an exact host-only cookie and never returns the bearer in JSON', async () => {
    const insert = chain();
    getSupabaseClient.mockReturnValue({ from: jest.fn(() => insert) });
    const response = await (await loopbackRequest(makeApp()))
      .post('/api/v1/anonymous-sessions/web')
      .set('Origin', EF75_WEB_ORIGIN)
      .set('X-EF-Client', 'web')
      .set('Content-Type', 'application/json')
      .send({});
    expect(response.status).toBe(201);
    const cookie = response.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(new RegExp(`^${EF75_WEB_COOKIE_NAME}=[A-Za-z0-9_-]{43};`));
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=2592000');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Domain=');
    expect(response.body).toEqual({
      csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresAt: expect.any(Number),
    });
    expect(JSON.stringify(response.body)).not.toContain(cookie.split('=')[1].split(';')[0]);
  });

  test.each([undefined, 'https://evil.example', 'null'])(
    'rejects missing or non-exact browser Origin: %s',
    async origin => {
      const pending = (await loopbackRequest(makeApp()))
        .post('/api/v1/anonymous-sessions/web')
        .set('X-EF-Client', 'web')
        .set('Content-Type', 'application/json')
        .send({});
      if (origin) pending.set('Origin', origin);
      const response = await pending;
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'request_not_allowed' });
      expect(getSupabaseClient).not.toHaveBeenCalled();
    },
  );

  test('requires exact Origin, cookie-only transport, JSON and matching CSRF', async () => {
    const row = {
      id: '22222222-2222-4222-8222-222222222222',
      credential_hash: hashAnonymousSecret(WEB_TOKEN),
      transport: 'web',
      csrf_hash: hashAnonymousSecret(CSRF),
      expires_at: Date.now() + 60_000,
      revoked_at: null,
    };
    getSupabaseClient.mockReturnValue({ from: jest.fn(() => chain({ data: row })) });
    const response = await (await loopbackRequest(makeApp(true)))
      .post('/protected')
      .set('Origin', EF75_WEB_ORIGIN)
      .set('Cookie', `${EF75_WEB_COOKIE_NAME}=${WEB_TOKEN}`)
      .set('X-EF-CSRF', CSRF)
      .set('Content-Type', 'application/json')
      .send({});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  test('allows a side-effect-free cookie GET without Origin', async () => {
    const row = {
      id: '22222222-2222-4222-8222-222222222222',
      credential_hash: hashAnonymousSecret(WEB_TOKEN),
      transport: 'web',
      csrf_hash: hashAnonymousSecret(CSRF),
      expires_at: Date.now() + 60_000,
      revoked_at: null,
    };
    getSupabaseClient.mockReturnValue({ from: jest.fn(() => chain({ data: row })) });
    const response = await (await loopbackRequest(makeApp(true)))
      .get('/protected')
      .set('Cookie', `${EF75_WEB_COOKIE_NAME}=${WEB_TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  test.each([undefined, 'https://evil.example'])(
    'rejects a mutation with missing or non-exact Origin: %s',
    async origin => {
      const row = {
        id: '22222222-2222-4222-8222-222222222222',
        credential_hash: hashAnonymousSecret(WEB_TOKEN),
        transport: 'web',
        csrf_hash: hashAnonymousSecret(CSRF),
        expires_at: Date.now() + 60_000,
        revoked_at: null,
      };
      getSupabaseClient.mockReturnValue({ from: jest.fn(() => chain({ data: row })) });
      const pending = (await loopbackRequest(makeApp(true)))
        .post('/protected')
        .set('Cookie', `${EF75_WEB_COOKIE_NAME}=${WEB_TOKEN}`)
        .set('X-EF-CSRF', CSRF)
        .set('Content-Type', 'application/json')
        .send({});
      if (origin) pending.set('Origin', origin);
      const response = await pending;
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'request_not_allowed' });
    },
  );

  test('rejects a cross-origin cookie GET', async () => {
    const row = {
      id: '22222222-2222-4222-8222-222222222222',
      credential_hash: hashAnonymousSecret(WEB_TOKEN),
      transport: 'web',
      csrf_hash: hashAnonymousSecret(CSRF),
      expires_at: Date.now() + 60_000,
      revoked_at: null,
    };
    getSupabaseClient.mockReturnValue({ from: jest.fn(() => chain({ data: row })) });
    const response = await (await loopbackRequest(makeApp(true)))
      .get('/protected')
      .set('Origin', 'https://evil.example')
      .set('Cookie', `${EF75_WEB_COOKIE_NAME}=${WEB_TOKEN}`);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'request_not_allowed' });
  });

  test.each([
    ['wrong csrf', `${EF75_WEB_COOKIE_NAME}=${WEB_TOKEN}`, 'X'.repeat(43), undefined],
    ['duplicate cookie', `${EF75_WEB_COOKIE_NAME}=${WEB_TOKEN}; ${EF75_WEB_COOKIE_NAME}=${WEB_TOKEN}`, CSRF, undefined],
    ['mixed bearer and cookie', `${EF75_WEB_COOKIE_NAME}=${WEB_TOKEN}`, CSRF, `Bearer ${'N'.repeat(43)}`],
  ])('rejects %s without disclosing session state', async (_label, cookie, csrf, bearer) => {
    const row = {
      id: '22222222-2222-4222-8222-222222222222',
      credential_hash: hashAnonymousSecret(WEB_TOKEN),
      transport: 'web',
      csrf_hash: hashAnonymousSecret(CSRF),
      expires_at: Date.now() + 60_000,
      revoked_at: null,
    };
    getSupabaseClient.mockReturnValue({ from: jest.fn(() => chain({ data: row })) });
    const pending = (await loopbackRequest(makeApp(true)))
      .post('/protected')
      .set('Origin', EF75_WEB_ORIGIN)
      .set('Cookie', cookie)
      .set('X-EF-CSRF', csrf)
      .set('Content-Type', 'application/json')
      .send({});
    if (bearer) pending.set('Authorization', bearer);
    const response = await pending;
    expect([401, 403]).toContain(response.status);
    expect(JSON.stringify(response.body)).not.toContain(WEB_TOKEN);
  });
});
