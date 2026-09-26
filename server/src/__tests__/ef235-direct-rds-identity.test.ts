import { jest } from '@jest/globals';
import {
  PostgresIdentityDb,
  registerProtectedIdentityDb,
  verifyConversationOwner,
  type IdentityDbSqlExecutor,
} from '../storage/database/identity-db';
import { parseRdsRuntimeConfig } from '../storage/database/rds-runtime-config';

const CONVERSATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';

function executorReturning(result: { rowCount: number; rows: Record<string, unknown>[] }) {
  const query = jest.fn(async () => result);
  return {
    query,
    executor: { query } as unknown as IdentityDbSqlExecutor,
  };
}

describe('EF-235 direct RDS identity ownership boundary', () => {
  test('creates a conversation owner binding with parameterized SQL only', async () => {
    const { query, executor } = executorReturning({ rowCount: 1, rows: [] });
    const db = new PostgresIdentityDb(executor);

    await db.createOwnerBinding(CONVERSATION, OWNER_A);

    expect(query).toHaveBeenCalledTimes(1);
    const [statement, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(statement).toContain('INSERT INTO conversation_owner_bindings');
    expect(statement).toContain('VALUES ($1, $2, $3, NULL)');
    expect(statement).not.toContain(CONVERSATION);
    expect(statement).not.toContain(OWNER_A);
    expect(values.slice(0, 2)).toEqual([CONVERSATION, OWNER_A]);
  });

  test('finds and accepts the same anonymous owner', async () => {
    const { executor } = executorReturning({
      rowCount: 1,
      rows: [{ owner_principal_id: OWNER_A }],
    });
    const db = new PostgresIdentityDb(executor);
    registerProtectedIdentityDb(db);

    await expect(db.findOwnerByConversationRef(CONVERSATION)).resolves.toBe(OWNER_A);
    await expect(verifyConversationOwner(CONVERSATION, OWNER_A)).resolves.toBe(true);
  });

  test('rejects a different anonymous owner without a write or fallback', async () => {
    const { query, executor } = executorReturning({
      rowCount: 1,
      rows: [{ owner_principal_id: OWNER_A }],
    });
    const db = new PostgresIdentityDb(executor);
    registerProtectedIdentityDb(db);

    await expect(verifyConversationOwner(CONVERSATION, OWNER_B)).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain('SELECT owner_principal_id');
  });

  test('does not accept legacy Supabase variables as identity configuration', () => {
    expect(parseRdsRuntimeConfig({
      COZE_SUPABASE_URL: 'https://synthetic.invalid',
      COZE_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-value',
    }).ok).toBe(false);
  });
});
