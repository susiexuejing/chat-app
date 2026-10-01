import { Pool } from 'pg';
import { readRdsRuntimeConfig, type RdsRuntimeConfig } from './rds-runtime-config';

export type AnonymousTransport = 'native' | 'web';

export interface AnonymousSessionRecord {
  id: string;
  credentialHash: string;
  transport: AnonymousTransport;
  csrfHash: string | null;
  expiresAt: number;
  revokedAt: number | null;
}

export interface NewAnonymousSessionRecord extends AnonymousSessionRecord {
  createdAt: number;
}

interface SqlResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rowCount: number | null;
  rows: Row[];
}

export interface IdentityDbSqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[],
  ): Promise<SqlResult<Row>>;
}

export interface IdentityDb {
  createAnonymousSession(session: NewAnonymousSessionRecord): Promise<void>;
  findAnonymousSession(
    credentialHash: string,
    transport: AnonymousTransport,
  ): Promise<AnonymousSessionRecord | null>;
  updateAnonymousSessionCsrf(
    id: string,
    transport: 'web',
    csrfHash: string,
  ): Promise<void>;
  revokeAnonymousSession(id: string): Promise<void>;
  createOwnerBinding(conversationRef: string, ownerPrincipalId: string): Promise<void>;
  findOwnerByConversationRef(conversationRef: string): Promise<string | null>;
  revokeOwnerBinding(conversationRef: string, ownerPrincipalId: string): Promise<boolean>;
}

interface AnonymousSessionSqlRow extends Record<string, unknown> {
  id: string;
  credential_hash: string;
  transport: string;
  csrf_hash: string | null;
  expires_at: number | string;
  revoked_at: number | string | null;
}

interface OwnerBindingSqlRow extends Record<string, unknown> {
  owner_principal_id: string;
}

function finiteTimestamp(value: number | string): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class PostgresIdentityDb implements IdentityDb {
  private readonly sql: IdentityDbSqlExecutor;

  constructor(sql: IdentityDbSqlExecutor) {
    this.sql = sql;
  }

  async createAnonymousSession(session: NewAnonymousSessionRecord): Promise<void> {
    const result = await this.sql.query(
      `INSERT INTO anonymous_sessions
        (id, credential_hash, transport, csrf_hash, created_at, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        session.id,
        session.credentialHash,
        session.transport,
        session.csrfHash,
        session.createdAt,
        session.expiresAt,
        session.revokedAt,
      ],
    );
    if (result.rowCount !== 1) throw new Error('anonymous_session_storage_failed');
  }

  async findAnonymousSession(
    credentialHash: string,
    transport: AnonymousTransport,
  ): Promise<AnonymousSessionRecord | null> {
    const result = await this.sql.query<AnonymousSessionSqlRow>(
      `SELECT id, credential_hash, transport, csrf_hash, expires_at, revoked_at
       FROM anonymous_sessions
       WHERE credential_hash = $1
         AND transport = $2
       LIMIT 1`,
      [credentialHash, transport],
    );
    if (result.rowCount !== 1 || result.rows.length !== 1) return null;

    const row = result.rows[0];
    const expiresAt = finiteTimestamp(row.expires_at);
    const revokedAt = row.revoked_at === null ? null : finiteTimestamp(row.revoked_at);
    if ((row.transport !== 'native' && row.transport !== 'web')
      || expiresAt === null
      || (row.revoked_at !== null && revokedAt === null)) {
      throw new Error('anonymous_session_record_invalid');
    }
    return {
      id: row.id,
      credentialHash: row.credential_hash,
      transport: row.transport,
      csrfHash: row.csrf_hash,
      expiresAt,
      revokedAt,
    };
  }

  async updateAnonymousSessionCsrf(
    id: string,
    transport: 'web',
    csrfHash: string,
  ): Promise<void> {
    const result = await this.sql.query(
      `UPDATE anonymous_sessions
       SET csrf_hash = $3
       WHERE id = $1
         AND transport = $2
         AND revoked_at IS NULL`,
      [id, transport, csrfHash],
    );
    if (result.rowCount !== 1) throw new Error('anonymous_csrf_storage_failed');
  }

  async revokeAnonymousSession(id: string): Promise<void> {
    const result = await this.sql.query(
      `UPDATE anonymous_sessions
       SET revoked_at = $2
       WHERE id = $1
         AND revoked_at IS NULL`,
      [id, Date.now()],
    );
    if (result.rowCount !== 1) throw new Error('anonymous_session_revoke_failed');
  }

  async createOwnerBinding(conversationRef: string, ownerPrincipalId: string): Promise<void> {
    const result = await this.sql.query(
      `INSERT INTO conversation_owner_bindings
        (conversation_ref, owner_principal_id, created_at, revoked_at)
       VALUES ($1, $2, $3, NULL)
       ON CONFLICT (conversation_ref) DO NOTHING`,
      [conversationRef, ownerPrincipalId, Date.now()],
    );
    if (result.rowCount !== 1) throw new Error('owner_binding_create_rejected');
  }

  async findOwnerByConversationRef(conversationRef: string): Promise<string | null> {
    const result = await this.sql.query<OwnerBindingSqlRow>(
      `SELECT owner_principal_id
       FROM conversation_owner_bindings
       WHERE conversation_ref = $1
         AND revoked_at IS NULL
       LIMIT 1`,
      [conversationRef],
    );
    if (result.rowCount !== 1 || result.rows.length !== 1) return null;
    return result.rows[0].owner_principal_id;
  }

  async revokeOwnerBinding(conversationRef: string, ownerPrincipalId: string): Promise<boolean> {
    const result = await this.sql.query(
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

let protectedIdentityDb: IdentityDb | undefined;

function createRuntimeIdentityDb(config: RdsRuntimeConfig): IdentityDb {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: {
      ca: config.sslCa,
      rejectUnauthorized: true,
    },
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 4,
    application_name: 'emotionflow_identity',
  });
  const sql: IdentityDbSqlExecutor = {
    async query<Row extends Record<string, unknown>>(
      text: string,
      values: readonly unknown[],
    ): Promise<SqlResult<Row>> {
      const result = await pool.query<Row>(text, [...values]);
      return { rowCount: result.rowCount, rows: result.rows };
    },
  };
  return new PostgresIdentityDb(sql);
}

/**
 * Registers only the dedicated identity RDS configuration. Missing or invalid
 * configuration leaves identity access unavailable; there is no Supabase or
 * alternate database fallback.
 */
export function registerRuntimeIdentityDb(): boolean {
  const result = readRdsRuntimeConfig();
  if (!result.ok) return false;
  protectedIdentityDb = createRuntimeIdentityDb(result.config);
  return true;
}

export function registerProtectedIdentityDb(identityDb: IdentityDb): void {
  protectedIdentityDb = identityDb;
}

export function hasRegisteredIdentityDb(): boolean {
  return protectedIdentityDb !== undefined;
}

function identityDbOrThrow(): IdentityDb {
  if (!protectedIdentityDb) throw new Error('protected_identity_db_unavailable');
  return protectedIdentityDb;
}

export async function createAnonymousSessionRecord(
  session: NewAnonymousSessionRecord,
): Promise<void> {
  await identityDbOrThrow().createAnonymousSession(session);
}

export async function findAnonymousSessionRecord(
  credentialHash: string,
  transport: AnonymousTransport,
): Promise<AnonymousSessionRecord | null> {
  return identityDbOrThrow().findAnonymousSession(credentialHash, transport);
}

export async function updateAnonymousSessionCsrf(
  id: string,
  csrfHash: string,
): Promise<void> {
  await identityDbOrThrow().updateAnonymousSessionCsrf(id, 'web', csrfHash);
}

export async function revokeAnonymousSession(id: string): Promise<void> {
  await identityDbOrThrow().revokeAnonymousSession(id);
}

export async function createConversationOwnerBinding(
  conversationRef: string,
  ownerPrincipalId: string,
): Promise<void> {
  await identityDbOrThrow().createOwnerBinding(conversationRef, ownerPrincipalId);
}

export async function findConversationOwner(
  conversationRef: string,
): Promise<string | null> {
  return identityDbOrThrow().findOwnerByConversationRef(conversationRef);
}

export async function verifyConversationOwner(
  conversationRef: string,
  ownerPrincipalId: string,
): Promise<boolean> {
  return (await findConversationOwner(conversationRef)) === ownerPrincipalId;
}

export async function revokeConversationOwnerBinding(
  conversationRef: string,
  ownerPrincipalId: string,
): Promise<boolean> {
  return identityDbOrThrow().revokeOwnerBinding(conversationRef, ownerPrincipalId);
}
