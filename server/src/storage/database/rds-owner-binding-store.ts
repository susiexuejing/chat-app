import { Pool } from 'pg';
import { readRdsRuntimeConfig, type RdsRuntimeConfig } from './rds-runtime-config';

/** EF-107 protected owner-binding boundary. */
export type OwnerBindingResult = 'owned' | 'missing' | 'internal';

export interface RdsOwnerBindingStore {
  createBinding(conversationRef: string, ownerPrincipalId: string): Promise<void>;
  hasExactOwnerBinding(conversationRef: string, ownerPrincipalId: string): Promise<boolean>;
  revokeBinding(conversationRef: string, ownerPrincipalId: string): Promise<boolean>;
}

let protectedStore: RdsOwnerBindingStore | undefined;

class PostgresOwnerBindingStore implements RdsOwnerBindingStore {
  constructor(private readonly pool: Pool) {}

  async createBinding(conversationRef: string, ownerPrincipalId: string): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO conversation_owner_bindings
        (conversation_ref, owner_principal_id, created_at, revoked_at)
       VALUES ($1, $2, $3, NULL)
       ON CONFLICT (conversation_ref) DO NOTHING`,
      [conversationRef, ownerPrincipalId, Date.now()],
    );
    if (result.rowCount !== 1) throw new Error('owner_binding_create_rejected');
  }

  async hasExactOwnerBinding(conversationRef: string, ownerPrincipalId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM conversation_owner_bindings
       WHERE conversation_ref = $1
         AND owner_principal_id = $2
         AND revoked_at IS NULL
       LIMIT 1`,
      [conversationRef, ownerPrincipalId],
    );
    return result.rowCount === 1;
  }

  async revokeBinding(conversationRef: string, ownerPrincipalId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE conversation_owner_bindings
       SET revoked_at = $3
       WHERE conversation_ref = $1
         AND owner_principal_id = $2
         AND revoked_at IS NULL`,
      [conversationRef, ownerPrincipalId, Date.now()],
    );
    return result.rowCount === 1;
  }
}

function createRuntimeStore(config: RdsRuntimeConfig): RdsOwnerBindingStore {
  return new PostgresOwnerBindingStore(new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: { rejectUnauthorized: true },
  }));
}

/**
 * Registers only an explicit, server-dedicated RDS login. Missing or invalid
 * configuration remains unregistered and is rejected by protected routes.
 */
export function registerRuntimeOwnerBindingStore(): boolean {
  const result = readRdsRuntimeConfig();
  if (!result.ok) return false;
  registerProtectedOwnerBindingStore(createRuntimeStore(result.config));
  return true;
}

export function hasRegisteredOwnerBindingStore(): boolean {
  return protectedStore !== undefined;
}

/** Called only by protected workload bootstrap code, never by a request. */
export function registerProtectedOwnerBindingStore(store: RdsOwnerBindingStore): void {
  protectedStore = store;
}

function storeOrThrow(): RdsOwnerBindingStore {
  if (!protectedStore) throw new Error('protected_owner_binding_store_unavailable');
  return protectedStore;
}

export async function createOwnerBinding(
  conversationRef: string,
  ownerPrincipalId: string,
): Promise<void> {
  await storeOrThrow().createBinding(conversationRef, ownerPrincipalId);
}

export async function verifyExactOwnerBinding(
  conversationRef: string,
  ownerPrincipalId: string,
): Promise<OwnerBindingResult> {
  try {
    return await storeOrThrow().hasExactOwnerBinding(conversationRef, ownerPrincipalId)
      ? 'owned'
      : 'missing';
  } catch {
    return 'internal';
  }
}

export async function revokeOwnerBinding(
  conversationRef: string,
  ownerPrincipalId: string,
): Promise<OwnerBindingResult> {
  try {
    return await storeOrThrow().revokeBinding(conversationRef, ownerPrincipalId)
      ? 'owned'
      : 'missing';
  } catch {
    return 'internal';
  }
}
