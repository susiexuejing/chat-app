import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const getSupabaseClient = jest.fn();
jest.unstable_mockModule('../storage/database/supabase-client', () => ({ getSupabaseClient }));
const verifyOwnedConversation = jest.fn(async (owner: string, conversation: string) =>
  owner === 'owner-a' && conversation === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' ? 'owned' : 'missing');

jest.unstable_mockModule('../security/anonymousSession', () => ({
  requireAnonymousSession: (req: { get: (name: string) => string | undefined }, res: { locals: Record<string, unknown> }, next: () => void) => {
    res.locals.anonymousSession = {
      id: req.get('x-test-owner') ?? 'owner-b',
      transport: 'native',
      expiresAt: Date.now() + 60_000,
      csrfHash: null,
    };
    next();
  },
  getVerifiedAnonymousSession: (res: { locals: { anonymousSession: unknown } }) => res.locals.anonymousSession,
  verifyOwnedConversation,
}));

const { default: conversationsRouter } = await import('../routes/conversations');
const CONVERSATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeOwnershipClient() {
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  return {
    calls,
    from: jest.fn((table: string) => {
      const filters: Array<[string, unknown]> = [];
      calls.push({ table, filters });
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'order', 'lt', 'limit', 'update', 'insert']) {
        chain[method] = jest.fn(() => chain);
      }
      chain.eq = jest.fn((field: string, value: unknown) => {
        filters.push([field, value]);
        return chain;
      });
      chain.maybeSingle = jest.fn(async () => {
        if (table === 'conversations') {
          const owner = filters.find(([field]) => field === 'owner_session_id')?.[1];
          const id = filters.find(([field]) => field === 'id')?.[1];
          return {
            data: owner === 'owner-a' && id === CONVERSATION
              ? { id: CONVERSATION, role_id: 'clever-fox', state: 'active', created_at: 1, updated_at: 1, last_message_at: null }
              : null,
            error: null,
          };
        }
        return { data: null, error: null };
      });
      chain.then = (resolve: (arg: unknown) => unknown) => Promise.resolve({
        data: table === 'messages' ? [{
          id: 'message-a', conversation_id: CONVERSATION, role: 'user', content: 'private-a',
          status: 'sent', request_id: 'shared-request', timestamp: 1,
        }] : null,
        error: null,
      }).then(resolve);
      return chain;
    }),
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/conversations', conversationsRouter);
  return app;
}

describe('EF-75 conversation and message ownership', () => {
  beforeEach(() => verifyOwnedConversation.mockClear());

  test('User B direct-id substitution is indistinguishable from a missing or legacy conversation', async () => {
    const client = makeOwnershipClient();
    getSupabaseClient.mockReturnValue(client);
    const b = await request(makeApp())
      .get(`/api/v1/conversations/${CONVERSATION}`)
      .set('X-Test-Owner', 'owner-b');
    const missing = await request(makeApp())
      .get('/api/v1/conversations/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
      .set('X-Test-Owner', 'owner-b');
    const legacy = await request(makeApp())
      .get(`/api/v1/conversations/${CONVERSATION}`)
      .set('X-Test-Owner', 'legacy-owner');
    expect(b.status).toBe(404);
    expect(b.body).toEqual({ error: 'resource_not_found' });
    expect(missing.body).toEqual(b.body);
    expect(legacy.body).toEqual(b.body);
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });

  test('User A read is owner-filtered before any messages are returned', async () => {
    const client = makeOwnershipClient();
    getSupabaseClient.mockReturnValue(client);
    const response = await request(makeApp())
      .get(`/api/v1/conversations/${CONVERSATION}`)
      .set('X-Test-Owner', 'owner-a');
    expect(response.status).toBe(200);
    expect(response.body.conversation).not.toHaveProperty('userId');
    expect(response.body.messages[0].content).toBe('private-a');
    expect(verifyOwnedConversation).toHaveBeenCalledWith('owner-a', CONVERSATION);
    expect(client.calls[0].filters).toEqual(expect.arrayContaining([
      ['id', CONVERSATION],
      ['owner_session_id', 'owner-a'],
    ]));
  });

  test('message mutation and idempotency are scoped to the owned conversation', async () => {
    const client = makeOwnershipClient();
    getSupabaseClient.mockReturnValue(client);
    const response = await request(makeApp())
      .post(`/api/v1/conversations/${CONVERSATION}/messages`)
      .set('X-Test-Owner', 'owner-b')
      .send({ role: 'user', content: 'attempt', requestId: 'shared-request' });
    expect(response.status).toBe(404);
    expect(client.calls).toHaveLength(1);

    const aClient = makeOwnershipClient();
    getSupabaseClient.mockReturnValue(aClient);
    await request(makeApp())
      .post(`/api/v1/conversations/${CONVERSATION}/messages`)
      .set('X-Test-Owner', 'owner-a')
      .send({ role: 'user', content: 'attempt', requestId: 'shared-request' });
    const idempotency = aClient.calls.find(call => call.table === 'messages');
    expect(idempotency?.filters).toEqual(expect.arrayContaining([
      ['request_id', 'shared-request'],
      ['conversation_id', CONVERSATION],
    ]));
  });
});
