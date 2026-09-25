import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const findAnonymousSessionRecord = jest.fn();
jest.unstable_mockModule('../storage/database/identity-db', () => ({
  findAnonymousSessionRecord,
  hasRegisteredIdentityDb: jest.fn(() => true),
  verifyConversationOwner: jest.fn(),
}));

const {
  hashAnonymousSecret,
  requireAnonymousSession,
  getVerifiedAnonymousSession,
} = await import('../security/anonymousSession');
const { parseRdsRuntimeConfig } = await import('../storage/database/rds-runtime-config');

const TOKEN = 'A'.repeat(43);
const OWNER = '11111111-1111-4111-8111-111111111111';

function sessionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: OWNER,
    credentialHash: hashAnonymousSecret(TOKEN),
    transport: 'native',
    csrfHash: null,
    expiresAt: Date.now() + 60_000,
    revokedAt: null,
    ...overrides,
  };
}

function makeApp() {
  const app = express();
  app.get('/protected', requireAnonymousSession, (_req, res) => {
    res.json({ owner: getVerifiedAnonymousSession(res).id });
  });
  return loopbackOnly(app);
}

function loopbackOnly(app: express.Express) {
  const listen = app.listen.bind(app);
  app.listen = ((port: number, callback?: () => void) => listen(port, '127.0.0.1', callback)) as typeof app.listen;
  return app;
}

describe('EF-75 native anonymous session verification', () => {
  beforeEach(() => findAnonymousSessionRecord.mockReset());

  test('accepts only an active server-issued native credential', async () => {
    findAnonymousSessionRecord.mockResolvedValue(sessionRecord());
    const response = await request(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ owner: OWNER });
  });

  test.each([
    ['missing', undefined, {}],
    ['malformed', 'Bearer short', {}],
    ['expired', `Bearer ${TOKEN}`, { expiresAt: Date.now() - 1 }],
    ['revoked', `Bearer ${TOKEN}`, { revokedAt: Date.now() }],
    ['wrong transport', `Bearer ${TOKEN}`, { transport: 'web' }],
  ])('%s credential fails with the same non-disclosing response', async (_label, header, row) => {
    findAnonymousSessionRecord.mockResolvedValue(sessionRecord(row));
    const pending = request(makeApp()).get('/protected');
    if (header) pending.set('Authorization', header);
    const response = await pending;
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'anonymous_session_invalid' });
  });

  test('browser metadata cannot enter native bearer mode', async () => {
    findAnonymousSessionRecord.mockResolvedValue(sessionRecord());
    const response = await request(makeApp())
      .get('/protected')
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('Origin', 'https://dev.douhaoyu.cn');
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'request_not_allowed' });
  });

  test('accepts only a dedicated, well-formed RDS runtime login configuration', () => {
    const valid = parseRdsRuntimeConfig({
      EF_IDENTITY_RDS_HOST: 'rds.internal',
      EF_IDENTITY_RDS_PORT: '5432',
      EF_IDENTITY_RDS_DATABASE: 'emotionflow_identity_dev',
      EF_IDENTITY_RDS_USER: 'ef_identity_runtime',
      EF_IDENTITY_RDS_PASSWORD: 'synthetic-password-value',
      EF_IDENTITY_RDS_SSL_CA: 'synthetic-ca-value',
    });
    expect(valid.ok).toBe(true);
    expect(parseRdsRuntimeConfig({
      EF_IDENTITY_RDS_HOST: 'rds.internal',
      EF_IDENTITY_RDS_PORT: '5432',
      EF_IDENTITY_RDS_DATABASE: 'emotionflow_identity_dev',
      EF_IDENTITY_RDS_USER: 'bootstrap-admin',
      EF_IDENTITY_RDS_PASSWORD: 'synthetic-password-value',
      EF_IDENTITY_RDS_SSL_CA: 'synthetic-ca-value',
    }).ok).toBe(false);
    expect(parseRdsRuntimeConfig({}).ok).toBe(false);
  });
});
