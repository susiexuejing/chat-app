import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const getSupabaseClient = jest.fn();

jest.unstable_mockModule('../storage/database/supabase-client.js', () => ({
  getSupabaseClient,
}));

const { default: conversationsRouter } = await import('../routes/conversations.js');

type SupabaseCallPlan = {
  singleResult?: any;
  maybeSingleResult?: any;
  limitResult?: any;
  eqResult?: any;
};

type FromBuilder = {
  insert: jest.Mock;
  select: jest.Mock;
  eq: jest.Mock;
  maybeSingle: jest.Mock;
  single: jest.Mock;
  order: jest.Mock;
  limit: jest.Mock;
  update: jest.Mock;
};

function createQueryChain(plan: SupabaseCallPlan = {}): FromBuilder {
  const chain: FromBuilder = {
    insert: jest.fn(),
    select: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn(),
    single: jest.fn(),
    order: jest.fn(),
    limit: jest.fn(),
    update: jest.fn(),
  };

  chain.insert.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.eq.mockReturnValue(plan.eqResult ?? chain);
  chain.order.mockReturnValue(chain);

  chain.maybeSingle.mockReturnValue(
    plan.maybeSingleResult ?? {
      data: null,
      error: null,
    }
  );

  chain.single.mockReturnValue(
    plan.singleResult ?? {
      data: null,
      error: null,
    }
  );

  chain.limit.mockReturnValue(
    plan.limitResult ?? {
      data: [],
      error: null,
    }
  );

  return chain;
}

function createClient(...plans: SupabaseCallPlan[]) {
  const queue = [...plans];
  return {
    from: jest.fn(() => {
      const plan = queue.shift();
      if (!plan) {
        throw new Error('Unexpected from() call count in test plan');
      }
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

function expectSafeEnvelope(response: request.Response, expectedCode: string) {
  expect(response.status).toBe(500);
  expect(response.body).toEqual({
    error: expectedCode,
    code: expectedCode,
    retryable: true,
  });
}

function assertNoForbiddenSentinel(input: unknown) {
  const text = JSON.stringify(input);
  const forbidden = [
    'session-xyz',
    'request-xyz',
    'conversation-xyz',
    'message-xyz',
    'user-xyz',
    'provider-db-error',
    '/internal/credentials',
    'token-abc123',
    'cookie-abc',
    'credential-secret',
    'Stack trace',
  ];

  for (const token of forbidden) {
    expect(text).not.toContain(token);
  }
}

describe('EF-110 Security Sanitization - Conversation routes', () => {
  beforeEach(() => {
    getSupabaseClient.mockReset();
  });

  const baseNow = Date.UTC(2026, 7, 20, 2, 0, 0);

  test('POST /api/v1/conversations create failure -> conversation_storage_error', async () => {
    const sensitiveError = 'provider-db-error user-xyz session-xyz request-xyz credential-secret path=/internal/credentials token-abc123 cookie-abc';

    getSupabaseClient.mockReturnValue(
      createClient({
        singleResult: {
          data: null,
          error: { message: sensitiveError },
        },
      })
    );

    const app = makeApp();
    const response = await request(app)
      .post('/api/v1/conversations')
      .send({ userId: 'safe-user', roleId: 'clever-fox' });

    expectSafeEnvelope(response, 'conversation_storage_error');
    assertNoForbiddenSentinel(response.body);
  });

  test('GET /api/v1/conversations/:id lookup failure -> conversation_lookup_error', async () => {
    const sensitiveError = 'provider-db-error user-xyz session-xyz request-xyz';

    getSupabaseClient.mockReturnValue(
      createClient({
        maybeSingleResult: {
          data: null,
          error: { message: sensitiveError },
        },
      })
    );

    const app = makeApp();
    const response = await request(app).get('/api/v1/conversations/conv-xyz');

    expectSafeEnvelope(response, 'conversation_lookup_error');
    assertNoForbiddenSentinel(response.body);
  });

  test('GET /api/v1/conversations/:id messages query failure -> messages_query_error', async () => {
    const sensitiveError = 'provider-db-error conversation-xyz message-xyz';

    getSupabaseClient.mockReturnValue(
      createClient(
        {
          maybeSingleResult: {
            data: {
              id: 'conv-xyz',
              user_id: 'user-xyz',
              role_id: 'clever-fox',
              state: 'active',
              created_at: baseNow,
              updated_at: baseNow,
              last_message_at: baseNow,
            },
            error: null,
          },
        },
        {
          limitResult: {
            data: null,
            error: { message: sensitiveError },
          },
        },
      )
    );

    const app = makeApp();
    const response = await request(app).get('/api/v1/conversations/conv-xyz');

    expectSafeEnvelope(response, 'messages_query_error');
    assertNoForbiddenSentinel(response.body);
  });

  test('POST /api/v1/conversations/:id/messages verify failure -> conversation_verify_error', async () => {
    const sensitiveError = 'provider-db-error conversation-xyz';

    getSupabaseClient.mockReturnValue(
      createClient({
        maybeSingleResult: {
          data: null,
          error: { message: sensitiveError },
        },
      })
    );

    const app = makeApp();
    const response = await request(app)
      .post('/api/v1/conversations/conv-xyz/messages')
      .send({
        role: 'user',
        content: 'Safe user text',
      });

    expectSafeEnvelope(response, 'conversation_verify_error');
    assertNoForbiddenSentinel(response.body);
  });

  test('POST /api/v1/conversations/:id/messages idempotency failure -> idempotency_guard_error', async () => {
    const sensitiveError = 'provider-db-error request-xyz';

    getSupabaseClient.mockReturnValue(
      createClient(
        {
          maybeSingleResult: {
            data: {
              id: 'conv-xyz',
              user_id: 'user-xyz',
              role_id: 'clever-fox',
            },
            error: null,
          },
        },
        {
          maybeSingleResult: {
            data: null,
            error: { message: sensitiveError },
          },
        }
      )
    );

    const app = makeApp();
    const response = await request(app)
      .post('/api/v1/conversations/conv-xyz/messages')
      .send({
        role: 'user',
        content: 'Safe user text',
        requestId: 'req-xyz',
      });

    expectSafeEnvelope(response, 'idempotency_guard_error');
    assertNoForbiddenSentinel(response.body);
  });

  test('POST /api/v1/conversations/:id/messages insert failure -> message_insert_error', async () => {
    const sensitiveError = 'provider-db-error session-xyz conversation-xyz';

    getSupabaseClient.mockReturnValue(
      createClient(
        {
          maybeSingleResult: {
            data: {
              id: 'conv-xyz',
              user_id: 'user-xyz',
              role_id: 'clever-fox',
            },
            error: null,
          },
        },
        {
          maybeSingleResult: {
            data: null,
            error: null,
          },
        },
        {
          singleResult: {
            data: null,
            error: {
              message: sensitiveError,
            },
          },
        },
      )
    );

    const app = makeApp();
    const response = await request(app)
      .post('/api/v1/conversations/conv-xyz/messages')
      .send({
        role: 'user',
        content: 'Safe user text',
        requestId: 'req-xyz',
      });

    expectSafeEnvelope(response, 'message_insert_error');
    assertNoForbiddenSentinel(response.body);
  });

  test('POST /api/v1/conversations/:id/messages update failure -> conversation_update_error', async () => {
    const sensitiveError = 'provider-db-error conversation-xyz user-xyz path=/internal/credentials';

    getSupabaseClient.mockReturnValue(
      createClient(
        {
          maybeSingleResult: {
            data: {
              id: 'conv-xyz',
              user_id: 'user-xyz',
              role_id: 'clever-fox',
            },
            error: null,
          },
        },
        {
          singleResult: {
            data: {
              id: 'msg-xyz',
              conversation_id: 'conv-xyz',
              role: 'user',
              content: 'Safe user text',
              status: 'sent',
              request_id: 'req-xyz',
              timestamp: baseNow,
            },
            error: null,
          },
        },
        {
          eqResult: {
            error: { message: sensitiveError },
          },
        }
      )
    );

    const app = makeApp();
    const response = await request(app)
      .post('/api/v1/conversations/conv-xyz/messages')
      .send({
        role: 'user',
        content: 'Safe user text',
      });

    expectSafeEnvelope(response, 'conversation_update_error');
    assertNoForbiddenSentinel(response.body);
  });

  test('GET /api/v1/conversations/:id/messages query failure never leaks forbidden tokens to logs', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const sensitiveError = 'provider-db-error user-xyz session-xyz request-xyz conversation-xyz message-xyz token-abc123 credential-secret /internal/credentials';

    getSupabaseClient.mockReturnValue(
      createClient(
        {
          maybeSingleResult: {
            data: {
              id: 'conv-xyz',
              user_id: 'user-xyz',
              role_id: 'clever-fox',
              state: 'active',
              created_at: baseNow,
              updated_at: baseNow,
              last_message_at: baseNow,
            },
            error: null,
          },
        },
        {
          limitResult: {
            data: null,
            error: { message: sensitiveError },
          },
        }
      )
    );

    const app = makeApp();

    try {
      await request(app).get('/api/v1/conversations/conv-xyz/messages?limit=10');
    } finally {
      const combinedLogs = [
        ...consoleError.mock.calls,
        ...consoleLog.mock.calls,
        ...consoleWarn.mock.calls,
      ];

      const serialized = combinedLogs.map((args) => JSON.stringify(args)).join('\n');
      assertNoForbiddenSentinel(serialized);

      consoleError.mockRestore();
      consoleLog.mockRestore();
      consoleWarn.mockRestore();
    }
  });
});
