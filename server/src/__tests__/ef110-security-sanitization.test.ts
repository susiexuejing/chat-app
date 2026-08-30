import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const getSupabaseClient = jest.fn();

jest.unstable_mockModule('../storage/database/supabase-client', () => ({
  getSupabaseClient,
}));

const VERIFIED_OWNER_ID = '33333333-3333-4333-8333-333333333333';
jest.unstable_mockModule('../security/anonymousSession', () => ({
  requireAnonymousSession: (_req: unknown, res: { locals: Record<string, unknown> }, next: () => void) => {
    res.locals.anonymousSession = {
      id: VERIFIED_OWNER_ID,
      transport: 'native',
      expiresAt: Date.now() + 60_000,
      csrfHash: null,
    };
    next();
  },
  getVerifiedAnonymousSession: (res: { locals: { anonymousSession: unknown } }) =>
    res.locals.anonymousSession,
}));

const { default: conversationsRouter } = await import('../routes/conversations');

type QueryResult = { data: unknown; error: unknown };
type QueryPlan = {
  single?: QueryResult;
  maybeSingle?: QueryResult;
  terminal?: QueryResult;
};

const EMPTY_RESULT: QueryResult = { data: null, error: null };

function createQueryChain(plan: QueryPlan = {}) {
  const chain: Record<string, jest.Mock | ((...args: unknown[]) => PromiseLike<unknown>)> = {};
  const returnChain = jest.fn(() => chain);

  for (const method of ['insert', 'select', 'eq', 'order', 'update', 'lt']) {
    chain[method] = returnChain;
  }

  chain.single = jest.fn(async () => plan.single ?? EMPTY_RESULT);
  chain.maybeSingle = jest.fn(async () => plan.maybeSingle ?? EMPTY_RESULT);
  chain.limit = jest.fn(async () => plan.terminal ?? { data: [], error: null });
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(plan.terminal ?? { data: [], error: null }).then(resolve, reject);

  return chain;
}

function createClient(...plans: QueryPlan[]) {
  const remaining = [...plans];
  return {
    from: jest.fn(() => {
      const plan = remaining.shift();
      if (!plan) throw new Error('Unexpected from() call in EF-110 fixture');
      return createQueryChain(plan);
    }),
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/conversations', conversationsRouter);
  return app;
}

const SENTINELS = [
  'session-sentinel-110',
  'response-run-sentinel-110',
  'request-sentinel-110',
  'conversation-sentinel-110',
  'message-sentinel-110',
  'user-sentinel-110',
  'USER-CONTENT-SENTINEL-110',
  'MODEL-CONTENT-SENTINEL-110',
  'provider-fragment-sentinel-110',
  'database-detail-sentinel-110',
  'token-sentinel-110',
  'Cookie=sentinel-110',
  'credential-sentinel-110',
  'secret-sentinel-110',
  '/private/path/sentinel-110',
  'STACK-SENTINEL-110',
] as const;

function sensitiveError(): Error {
  const error = new Error(SENTINELS.join(' '));
  error.stack = `STACK-SENTINEL-110 at /private/path/sentinel-110:42`;
  return error;
}

function expectNoSensitiveData(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const sentinel of SENTINELS) {
    expect(serialized).not.toContain(sentinel);
  }
}

function expectSafe500(response: request.Response): void {
  expect(response.status).toBe(500);
  expect(response.body).toEqual({
    error: 'internal_server_error',
  });
  expectNoSensitiveData(response.body);
}

describe('EF-110 conversation HTTP failure serialization', () => {
  let consoleError: jest.SpiedFunction<typeof console.error>;
  let consoleLog: jest.SpiedFunction<typeof console.log>;
  let consoleWarn: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    getSupabaseClient.mockReset();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    const logOutput = [
      ...consoleError.mock.calls,
      ...consoleLog.mock.calls,
      ...consoleWarn.mock.calls,
    ];
    expectNoSensitiveData(logOutput);
    consoleError.mockRestore();
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
  });

  test('create storage failure is generic and diagnosable', async () => {
    getSupabaseClient.mockReturnValue(createClient({
      single: { data: null, error: sensitiveError() },
    }));

    const response = await request(makeApp())
      .post('/api/v1/conversations')
      .send({ userId: SENTINELS[5], roleId: 'clever-fox' });

    expectSafe500(response);
  });

  test('conversation lookup failure is generic and diagnosable', async () => {
    getSupabaseClient.mockReturnValue(createClient({
      maybeSingle: { data: null, error: sensitiveError() },
    }));

    const response = await request(makeApp())
      .get(`/api/v1/conversations/${SENTINELS[3]}`);

    expectSafe500(response);
  });

  test('conversation message-query failure is generic and diagnosable', async () => {
    getSupabaseClient.mockReturnValue(createClient(
      {
        maybeSingle: {
          data: {
            id: SENTINELS[3],
            user_id: SENTINELS[5],
            role_id: 'clever-fox',
            state: 'active',
            created_at: 1,
            updated_at: 1,
            last_message_at: 1,
          },
          error: null,
        },
      },
      { terminal: { data: null, error: sensitiveError() } },
    ));

    const response = await request(makeApp())
      .get(`/api/v1/conversations/${SENTINELS[3]}`);

    expectSafe500(response);
  });

  test('message conversation-verification failure is generic and diagnosable', async () => {
    getSupabaseClient.mockReturnValue(createClient({
      maybeSingle: { data: null, error: sensitiveError() },
    }));

    const response = await request(makeApp())
      .post(`/api/v1/conversations/${SENTINELS[3]}/messages`)
      .send({ role: 'user', content: SENTINELS[6] });

    expectSafe500(response);
  });

  test('idempotency guard failure is generic and diagnosable', async () => {
    getSupabaseClient.mockReturnValue(createClient(
      { maybeSingle: { data: { id: SENTINELS[3] }, error: null } },
      { maybeSingle: { data: null, error: sensitiveError() } },
    ));

    const response = await request(makeApp())
      .post(`/api/v1/conversations/${SENTINELS[3]}/messages`)
      .send({ role: 'user', content: SENTINELS[6], requestId: SENTINELS[2] });

    expectSafe500(response);
  });

  test('message insert failure is generic and diagnosable', async () => {
    getSupabaseClient.mockReturnValue(createClient(
      { maybeSingle: { data: { id: SENTINELS[3] }, error: null } },
      { single: { data: null, error: sensitiveError() } },
    ));

    const response = await request(makeApp())
      .post(`/api/v1/conversations/${SENTINELS[3]}/messages`)
      .send({ role: 'user', content: SENTINELS[6] });

    expectSafe500(response);
  });

  test('conversation update failure is generic and diagnosable', async () => {
    getSupabaseClient.mockReturnValue(createClient(
      { maybeSingle: { data: { id: SENTINELS[3] }, error: null } },
      {
        single: {
          data: {
            id: SENTINELS[4],
            conversation_id: SENTINELS[3],
            role: 'user',
            content: SENTINELS[6],
            status: 'sent',
            request_id: null,
            timestamp: 1,
          },
          error: null,
        },
      },
      { terminal: { data: null, error: sensitiveError() } },
    ));

    const response = await request(makeApp())
      .post(`/api/v1/conversations/${SENTINELS[3]}/messages`)
      .send({ role: 'user', content: SENTINELS[6] });

    expectSafe500(response);
  });

  test('paginated message verification failure is generic and diagnosable', async () => {
    getSupabaseClient.mockReturnValue(createClient({
      maybeSingle: { data: null, error: sensitiveError() },
    }));

    const response = await request(makeApp())
      .get(`/api/v1/conversations/${SENTINELS[3]}/messages`);

    expectSafe500(response);
  });

  test('paginated message-query failure is generic and diagnosable', async () => {
    getSupabaseClient.mockReturnValue(createClient(
      { maybeSingle: { data: { id: SENTINELS[3] }, error: null } },
      { terminal: { data: null, error: sensitiveError() } },
    ));

    const response = await request(makeApp())
      .get(`/api/v1/conversations/${SENTINELS[3]}/messages?limit=10`);

    expectSafe500(response);
  });

  test('successful create response omits the internal owner identity', async () => {
    const stored = {
      id: 'synthetic-conversation-id',
      user_id: 'synthetic-user-id',
      role_id: 'clever-fox',
      state: 'active',
      created_at: 100,
      updated_at: 100,
      last_message_at: null,
    };
    getSupabaseClient.mockReturnValue(createClient({
      single: { data: stored, error: null },
    }));

    const response = await request(makeApp())
      .post('/api/v1/conversations')
      .send({ userId: stored.user_id, roleId: stored.role_id });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: stored.id,
      roleId: stored.role_id,
      state: stored.state,
      createdAt: stored.created_at,
      updatedAt: stored.updated_at,
      lastMessageAt: stored.last_message_at,
    });
  });

  test('idempotent message response remains byte-for-byte compatible', async () => {
    const existing = {
      id: 'synthetic-message-id',
      conversation_id: 'synthetic-conversation-id',
      role: 'user',
      content: 'synthetic-content',
      status: 'sent',
      request_id: 'synthetic-request-id',
      timestamp: 100,
    };
    getSupabaseClient.mockReturnValue(createClient(
      { maybeSingle: { data: { id: existing.conversation_id }, error: null } },
      { maybeSingle: { data: existing, error: null } },
    ));

    const response = await request(makeApp())
      .post(`/api/v1/conversations/${existing.conversation_id}/messages`)
      .send({ role: 'user', content: existing.content, requestId: existing.request_id });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: existing.id,
      conversationId: existing.conversation_id,
      role: existing.role,
      content: existing.content,
      status: existing.status,
      requestId: existing.request_id,
      timestamp: existing.timestamp,
    });
  });
});
