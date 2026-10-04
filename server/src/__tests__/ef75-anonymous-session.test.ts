import express from 'express';
import request from 'supertest';

const {
  EF75_WEB_COOKIE_NAME,
  EF75_WEB_CSRF_COOKIE_NAME,
  EF75_WEB_ORIGIN,
  requireAnonymousSession,
  getVerifiedAnonymousSession,
} = await import('../security/anonymousSession');

const GUEST = '11111111-1111-4111-8111-111111111111';
const CSRF = 'C'.repeat(43);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.get('/protected', requireAnonymousSession, (_req, res) => {
    res.json({ owner: getVerifiedAnonymousSession(res).id });
  });
  app.post('/protected', requireAnonymousSession, (_req, res) => res.json({ ok: true }));
  return app;
}

describe('EF-75 DEV web guest session verification', () => {
  test('accepts an opaque HttpOnly guest cookie for a side-effect-free request', async () => {
    const response = await request(makeApp())
      .get('/protected')
      .set('Cookie', `${EF75_WEB_COOKIE_NAME}=${GUEST}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ owner: GUEST });
  });

  test.each([
    ['missing', undefined],
    ['malformed', 'not-a-uuid'],
    ['duplicate', `${GUEST}; ${EF75_WEB_COOKIE_NAME}=${GUEST}`],
  ])('rejects a %s guest cookie without disclosing session state', async (_label, value) => {
    const pending = request(makeApp()).get('/protected');
    if (value) pending.set('Cookie', `${EF75_WEB_COOKIE_NAME}=${value}`);
    const response = await pending;
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'anonymous_session_invalid' });
  });

  test('requires same-origin JSON and matching CSRF values for mutation', async () => {
    const response = await request(makeApp())
      .post('/protected')
      .set('Origin', EF75_WEB_ORIGIN)
      .set('Content-Type', 'application/json')
      .set('Cookie', `${EF75_WEB_COOKIE_NAME}=${GUEST}; ${EF75_WEB_CSRF_COOKIE_NAME}=${CSRF}`)
      .set('X-EF-CSRF', CSRF)
      .send({});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  test('rejects bearer credentials and cross-origin mutation', async () => {
    const response = await request(makeApp())
      .post('/protected')
      .set('Authorization', 'Bearer synthetic')
      .set('Origin', 'https://evil.example')
      .set('Content-Type', 'application/json')
      .set('Cookie', `${EF75_WEB_COOKIE_NAME}=${GUEST}; ${EF75_WEB_CSRF_COOKIE_NAME}=${CSRF}`)
      .set('X-EF-CSRF', CSRF)
      .send({});
    expect([401, 403]).toContain(response.status);
  });
});
