import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const getSupabaseClient = jest.fn();
jest.unstable_mockModule('../storage/database/supabase-client', () => ({ getSupabaseClient }));
const verifyOwnedConversation = jest.fn(async (owner: string, conversation: string) =>
  owner === 'owner-a' && conversation === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' ? 'owned' : 'missing');
const createOwnerBinding = jest.fn(async () => undefined);
const revokeOwnerBinding = jest.fn(async (conversation: string, owner: string) =>
  conversation === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' && owner === 'owner-a' ? 'owned' : 'missing');

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
  requireOwnerBindingRuntime: (_req: unknown, _res: unknown, next: () => void) => next(),
  getVerifiedAnonymousSession: (res: { locals: { anonymousSession: unknown } }) => res.locals.anonymousSession,
  verifyOwnedConversation,
}));
jest.unstable_mockModule('../storage/database/rds-owner-binding-store', () => ({
  createOwnerBinding,
  revokeOwnerBinding,
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
      for (const method of ['select', 'order', 'lt', 'limit', 'update', 'insert', 'delete']) {
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

function makeCreateClient(result: { data: Record<string, unknown> | null; error: unknown }) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  return {
    calls,
    from: jest.fn((table: string) => {
      const filters: Array<[string, unknown]> = [];
      calls.push({ table, filters });
      const chain: Record<string, unknown> = {};
      chain.insert = jest.fn(() => chain);
      chain.select = jest.fn(() => chain);
      chain.eq = jest.fn((field: string, value: unknown) => {
        filters.push([field, value]);
        return chain;
      });
      chain.single = jest.fn(async () => result);
      return chain;
    }),
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/conversations', conversationsRouter);
  return loopbackOnly(app);
}

function loopbackOnly(app: express.Express) {
  const listen = app.listen.bind(app);
  app.listen = ((port: number, callback?: () => void) => listen(port, '127.0.0.1', callback)) as typeof app.listen;
  return app;
}

describe('EF-75 conversation and message ownership', () => {
  beforeEach(() => {
    verifyOwnedConversation.mockClear();
    createOwnerBinding.mockReset().mockResolvedValue(undefined);
    revokeOwnerBinding.mockReset().mockResolvedValue('owned');
    getSupabaseClient.mockReset();
  });
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
    expect(createOwnerBinding).not.toHaveBeenCalled();
    expect(revokeOwnerBinding).not.toHaveBeenCalled();
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
    expect(client.calls).toHaveLength(0);

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

  test('delete revokes the exact owner binding before removing only that owner\'s conversation', async () => {
    const client = makeOwnershipClient();
    getSupabaseClient.mockReturnValue(client);
    const denied = await request(makeApp())
      .delete(`/api/v1/conversations/${CONVERSATION}`)
      .set('X-Test-Owner', 'owner-b');
    expect(denied.status).toBe(404);
    expect(client.calls).toHaveLength(0);

    const ownedClient = makeOwnershipClient();
    getSupabaseClient.mockReturnValue(ownedClient);
    const deleted = await request(makeApp())
      .delete(`/api/v1/conversations/${CONVERSATION}`)
      .set('X-Test-Owner', 'owner-a');
    expect(deleted.status).toBe(204);
    expect(revokeOwnerBinding).toHaveBeenCalledWith(CONVERSATION, 'owner-a');
    expect(ownedClient.calls[0].filters).toEqual(expect.arrayContaining([
      ['id', CONVERSATION],
      ['owner_session_id', 'owner-a'],
    ]));
  });

  test('binding creation failure writes no conversation', async () => {
    createOwnerBinding.mockRejectedValueOnce(new Error('binding_unavailable'));
    const response = await request(makeApp())
      .post('/api/v1/conversations')
      .set('X-Test-Owner', 'owner-a')
      .send({ roleId: 'clever-fox' });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'internal_server_error' });
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });

  test('conversation persistence failure revokes the exact binding before a safe error', async () => {
    const client = makeCreateClient({ data: null, error: new Error('write_failed') });
    getSupabaseClient.mockReturnValue(client);
    const response = await request(makeApp())
      .post('/api/v1/conversations')
      .set('X-Test-Owner', 'owner-a')
      .send({ roleId: 'clever-fox' });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'internal_server_error' });
    expect(createOwnerBinding).toHaveBeenCalledWith(expect.any(String), 'owner-a');
    expect(revokeOwnerBinding).toHaveBeenCalledWith(
      createOwnerBinding.mock.calls[0][0],
      'owner-a',
    );
  });

  test('normal creation binds only the verified server owner', async () => {
    const client = makeCreateClient({
      data: {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', role_id: 'clever-fox', state: 'active',
        created_at: 1, updated_at: 1, last_message_at: null,
      },
      error: null,
    });
    getSupabaseClient.mockReturnValue(client);
    const response = await request(makeApp())
      .post('/api/v1/conversations')
      .set('X-Test-Owner', 'owner-a')
      .send({ roleId: 'clever-fox', userId: 'forged-client-owner' });
    expect(response.status).toBe(201);
    expect(createOwnerBinding).toHaveBeenCalledWith(expect.any(String), 'owner-a');
    expect(client.calls).toHaveLength(1);
  });
});
