import express from 'express';
import request from 'supertest';

const { default: anonymousSessionsRouter } = await import('../routes/anonymousSessions');
const {
  EF75_WEB_COOKIE_NAME,
  EF75_WEB_CSRF_COOKIE_NAME,
  EF75_WEB_ORIGIN,
  requireAnonymousSession,
} = await import('../security/anonymousSession');

function makeApp(withProtected = false) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/anonymous-sessions', anonymousSessionsRouter);
  if (withProtected) app.post('/protected', requireAnonymousSession, (_req, res) => res.json({ ok: true }));
  return app;
}

describe('EF-75 DEV web guest cookie and CSRF boundary', () => {
  test('issues two exact host-only cookies and never returns guest identity in JSON', async () => {
    const response = await request(makeApp())
      .post('/api/v1/anonymous-sessions/web')
      .set('Origin', EF75_WEB_ORIGIN)
      .set('X-EF-Client', 'web')
      .set('Content-Type', 'application/json')
      .send({});
    expect(response.status).toBe(201);
    const cookies = response.headers['set-cookie'] ?? [];
    expect(cookies[0]).toMatch(new RegExp(`^${EF75_WEB_COOKIE_NAME}=[0-9a-f-]{36};`));
    expect(cookies[0]).toContain('Secure');
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain('SameSite=Strict');
    expect(cookies[1]).toMatch(new RegExp(`^${EF75_WEB_CSRF_COOKIE_NAME}=[A-Za-z0-9_-]{43};`));
    expect(cookies[1]).toContain('Secure');
    expect(cookies[1]).not.toContain('HttpOnly');
    expect(response.body).toEqual({ csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expiresAt: expect.any(Number) });
    expect(JSON.stringify(response.body)).not.toContain(cookies[0].split('=')[1].split(';')[0]);
  });

  test.each([undefined, 'https://evil.example', 'null'])('rejects non-exact browser Origin: %s', async origin => {
    const pending = request(makeApp()).post('/api/v1/anonymous-sessions/web').set('X-EF-Client', 'web').set('Content-Type', 'application/json').send({});
    if (origin) pending.set('Origin', origin);
    const response = await pending;
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'request_not_allowed' });
  });

  test('keeps mutation behind exact origin and matching double-submit CSRF', async () => {
    const created = await request(makeApp()).post('/api/v1/anonymous-sessions/web').set('Origin', EF75_WEB_ORIGIN).set('X-EF-Client', 'web').set('Content-Type', 'application/json').send({});
    const cookies = created.headers['set-cookie'];
    const response = await request(makeApp(true)).post('/protected').set('Origin', EF75_WEB_ORIGIN).set('Content-Type', 'application/json').set('Cookie', cookies).set('X-EF-CSRF', created.body.csrfToken).send({});
    expect(response.status).toBe(200);
    const blocked = await request(makeApp(true)).post('/protected').set('Origin', 'https://evil.example').set('Content-Type', 'application/json').set('Cookie', cookies).set('X-EF-CSRF', created.body.csrfToken).send({});
    expect(blocked.status).toBe(403);
  });

  test('keeps native session issuance fail-closed during DEV web recovery', async () => {
    const response = await request(makeApp()).post('/api/v1/anonymous-sessions/native').send({});
    expect(response.status).toBe(501);
    expect(response.body).toEqual({ error: 'native_guest_session_not_available' });
  });
});
