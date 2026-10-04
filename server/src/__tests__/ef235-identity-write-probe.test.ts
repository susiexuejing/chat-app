import { describe, expect, it } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import {
  EF235_IDENTITY_WRITE_PROBE_PATH,
  ef235IdentityWriteProbeHandler,
  isLoopbackAddress,
  runEf235IdentityWriteProbe,
} from '../diagnostics/ef235IdentityWriteProbe';

function dependencies(overrides: Record<string, unknown> = {}) {
  const deletedSessions: string[] = [];
  const deletedBindings: string[] = [];
  let conversationDeletes = 0;
  const table = {
    insert: async () => ({ error: null }),
    delete: () => ({
      eq: async () => {
        conversationDeletes += 1;
        return { error: null, count: 1 };
      },
    }),
  };
  return {
    deletedSessions,
    deletedBindings,
    conversationDeletes: () => conversationDeletes,
    value: {
      createAnonymousSessionRecord: async () => undefined,
      deleteAnonymousSessionForProbe: async (id: string) => {
        deletedSessions.push(id);
        return true;
      },
      createConversationOwnerBinding: async () => undefined,
      deleteConversationOwnerBindingForProbe: async (conversationId: string) => {
        deletedBindings.push(conversationId);
        return true;
      },
      conversationTable: () => table,
      ...overrides,
    },
  };
}

describe('EF-235 fixed identity write probe', () => {
  it('returns only the closed eight-field receipt after all three write/cleanup pairs pass', async () => {
    const fixture = dependencies();
    const receipt = await runEf235IdentityWriteProbe(fixture.value as never);

    expect(Object.keys(receipt)).toEqual([
      'anonymous_session_write', 'owner_binding_write', 'conversation_store_write',
      'failure_boundary', 'schema_state', 'grant_state', 'side_effects', 'secret_exposed',
    ]);
    expect(receipt).toEqual({
      anonymous_session_write: 'pass',
      owner_binding_write: 'pass',
      conversation_store_write: 'pass',
      failure_boundary: 'none',
      schema_state: 'present',
      grant_state: 'allowed',
      side_effects: 'rolled_back_only',
      secret_exposed: 'no',
    });
    expect(fixture.deletedSessions).toHaveLength(1);
    expect(fixture.deletedBindings).toHaveLength(1);
    expect(fixture.conversationDeletes()).toBe(1);
  });

  it('stops before later boundaries when identity cleanup is not confirmed', async () => {
    let bindingStarted = false;
    const fixture = dependencies({
      deleteAnonymousSessionForProbe: async () => false,
      createConversationOwnerBinding: async () => { bindingStarted = true; },
    });
    const receipt = await runEf235IdentityWriteProbe(fixture.value as never);

    expect(receipt).toMatchObject({
      anonymous_session_write: 'fail',
      owner_binding_write: 'not_run',
      conversation_store_write: 'not_run',
      failure_boundary: 'anonymous_session',
      side_effects: 'not_clean',
      secret_exposed: 'no',
    });
    expect(bindingStarted).toBe(false);
    expect(fixture.conversationDeletes()).toBe(0);
  });

  it('classifies a schema failure without returning database details', async () => {
    const fixture = dependencies({
      createConversationOwnerBinding: async () => { throw { code: '42P01', detail: 'must not escape' }; },
    });
    const receipt = await runEf235IdentityWriteProbe(fixture.value as never);

    expect(receipt).toMatchObject({
      anonymous_session_write: 'pass',
      owner_binding_write: 'fail',
      conversation_store_write: 'not_run',
      failure_boundary: 'owner_binding',
      schema_state: 'missing',
      grant_state: 'unknown',
      secret_exposed: 'no',
    });
    expect(JSON.stringify(receipt)).not.toContain('must not escape');
  });

  it('classifies a denied conversation write and leaves no conversation cleanup attempt', async () => {
    const fixture = dependencies({
      conversationTable: () => ({
        insert: async () => ({ error: { code: '42501', message: 'hidden' } }),
        delete: () => ({ eq: async () => ({ error: null, count: 1 }) }),
      }),
    });
    const receipt = await runEf235IdentityWriteProbe(fixture.value as never);

    expect(receipt).toMatchObject({
      conversation_store_write: 'fail',
      failure_boundary: 'conversation_store',
      grant_state: 'denied',
      side_effects: 'rolled_back_only',
      secret_exposed: 'no',
    });
    expect(JSON.stringify(receipt)).not.toContain('hidden');
  });

  it('uses a strict loopback allowlist', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('10.0.0.7')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });

  it('fails closed for non-DEV, query, body, and caller-header requests before any probe runs', async () => {
    const app = express();
    app.use(express.json());
    app.post(EF235_IDENTITY_WRITE_PROBE_PATH, ef235IdentityWriteProbeHandler);
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    await request(app).post(EF235_IDENTITY_WRITE_PROBE_PATH).expect(404);
    process.env.NODE_ENV = 'development';
    await request(app).post(`${EF235_IDENTITY_WRITE_PROBE_PATH}?x=1`).expect(404);
    await request(app).post(EF235_IDENTITY_WRITE_PROBE_PATH).set('x-probe', '1').expect(404);
    await request(app).post(EF235_IDENTITY_WRITE_PROBE_PATH).send({ not: 'allowed' }).expect(404);
    process.env.NODE_ENV = originalNodeEnv;
  });
});
