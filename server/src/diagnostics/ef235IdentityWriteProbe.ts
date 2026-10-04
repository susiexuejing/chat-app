import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import {
  createAnonymousSessionRecord,
  createConversationOwnerBinding,
  deleteAnonymousSessionForProbe,
  deleteConversationOwnerBindingForProbe,
} from '../storage/database/identity-db';
import { getRuntimeSupabaseClientOnly } from '../storage/database/supabase-client';

export const EF235_IDENTITY_WRITE_PROBE_PATH = '/api/v1/internal/ef235/identity-write-probe';

type WriteResult = 'pass' | 'fail' | 'not_run';
type FailureBoundary = 'none' | 'anonymous_session' | 'owner_binding' | 'conversation_store';
type SchemaState = 'present' | 'missing' | 'unknown';
type GrantState = 'allowed' | 'denied' | 'unknown';
type SideEffects = 'none' | 'rolled_back_only' | 'not_clean';

/** This is the complete, closed response contract for the host connector. */
export interface Ef235IdentityWriteProbeReceipt {
  anonymous_session_write: WriteResult;
  owner_binding_write: WriteResult;
  conversation_store_write: WriteResult;
  failure_boundary: FailureBoundary;
  schema_state: SchemaState;
  grant_state: GrantState;
  side_effects: SideEffects;
  secret_exposed: 'no';
}

interface ProbeSupabaseTable {
  insert(values: Record<string, unknown>): PromiseLike<{ error: unknown }>;
  delete(options: { count: 'exact' }): { eq(column: string, value: string): PromiseLike<{ error: unknown; count: number | null }> };
}

interface ProbeDependencies {
  createAnonymousSessionRecord: typeof createAnonymousSessionRecord;
  deleteAnonymousSessionForProbe: typeof deleteAnonymousSessionForProbe;
  createConversationOwnerBinding: typeof createConversationOwnerBinding;
  deleteConversationOwnerBindingForProbe: typeof deleteConversationOwnerBindingForProbe;
  conversationTable(): ProbeSupabaseTable;
}

const runtimeDependencies: ProbeDependencies = {
  createAnonymousSessionRecord,
  deleteAnonymousSessionForProbe,
  createConversationOwnerBinding,
  deleteConversationOwnerBindingForProbe,
  conversationTable: () => getRuntimeSupabaseClientOnly().from('conversations') as unknown as ProbeSupabaseTable,
};

function emptyReceipt(): Ef235IdentityWriteProbeReceipt {
  return {
    anonymous_session_write: 'not_run',
    owner_binding_write: 'not_run',
    conversation_store_write: 'not_run',
    failure_boundary: 'none',
    schema_state: 'unknown',
    grant_state: 'unknown',
    side_effects: 'none',
    secret_exposed: 'no',
  };
}

function errorClassification(error: unknown): Pick<Ef235IdentityWriteProbeReceipt, 'schema_state' | 'grant_state'> {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code : undefined;
  if (code === '42P01' || code === 'PGRST205') return { schema_state: 'missing', grant_state: 'unknown' };
  if (code === '42501' || code === 'PGRST301') return { schema_state: 'unknown', grant_state: 'denied' };
  return { schema_state: 'unknown', grant_state: 'unknown' };
}

function successfulCleanup(receipt: Ef235IdentityWriteProbeReceipt): void {
  receipt.side_effects = 'rolled_back_only';
  receipt.schema_state = 'present';
  receipt.grant_state = 'allowed';
}

function failed(receipt: Ef235IdentityWriteProbeReceipt, boundary: FailureBoundary, error: unknown): void {
  receipt.failure_boundary = boundary;
  Object.assign(receipt, errorClassification(error));
}

/**
 * Fixed, parameter-free DEV probe. Synthetic identifiers never leave this
 * process. Each successful write is hard-deleted in finally before proceeding
 * to another storage boundary. It intentionally does not offer a transaction
 * across identity RDS and Supabase.
 */
export async function runEf235IdentityWriteProbe(
  dependencies: ProbeDependencies = runtimeDependencies,
): Promise<Ef235IdentityWriteProbeReceipt> {
  const receipt = emptyReceipt();
  const sessionId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const now = Date.now();
  const credentialHash = crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex');

  let sessionCreated = false;
  try {
    await dependencies.createAnonymousSessionRecord({
      id: sessionId,
      credentialHash,
      transport: 'web',
      csrfHash: null,
      createdAt: now,
      expiresAt: now + 60_000,
      revokedAt: null,
    });
    sessionCreated = true;
  } catch (error) {
    receipt.anonymous_session_write = 'fail';
    failed(receipt, 'anonymous_session', error);
    return receipt;
  } finally {
    if (sessionCreated) {
      try {
        if (!await dependencies.deleteAnonymousSessionForProbe(sessionId)) {
          receipt.anonymous_session_write = 'fail';
          receipt.failure_boundary = 'anonymous_session';
          receipt.side_effects = 'not_clean';
        } else {
          receipt.anonymous_session_write = 'pass';
          successfulCleanup(receipt);
        }
      } catch (error) {
        receipt.anonymous_session_write = 'fail';
        failed(receipt, 'anonymous_session', error);
        receipt.side_effects = 'not_clean';
      }
    }
  }
  if (receipt.side_effects === 'not_clean') return receipt;

  let bindingCreated = false;
  try {
    await dependencies.createConversationOwnerBinding(conversationId, ownerId);
    bindingCreated = true;
  } catch (error) {
    receipt.owner_binding_write = 'fail';
    failed(receipt, 'owner_binding', error);
    return receipt;
  } finally {
    if (bindingCreated) {
      try {
        if (!await dependencies.deleteConversationOwnerBindingForProbe(conversationId, ownerId)) {
          receipt.owner_binding_write = 'fail';
          receipt.failure_boundary = 'owner_binding';
          receipt.side_effects = 'not_clean';
        } else {
          receipt.owner_binding_write = 'pass';
          successfulCleanup(receipt);
        }
      } catch (error) {
        receipt.owner_binding_write = 'fail';
        failed(receipt, 'owner_binding', error);
        receipt.side_effects = 'not_clean';
      }
    }
  }
  if (receipt.side_effects === 'not_clean') return receipt;

  let conversationCreated = false;
  try {
    const insertResult = await dependencies.conversationTable().insert({
      id: conversationId,
      user_id: ownerId,
      owner_session_id: ownerId,
      role_id: 'clever-fox',
      state: 'active',
      created_at: now,
      updated_at: now,
      last_message_at: null,
    });
    if (insertResult.error) throw insertResult.error;
    conversationCreated = true;
  } catch (error) {
    receipt.conversation_store_write = 'fail';
    failed(receipt, 'conversation_store', error);
    return receipt;
  } finally {
    if (conversationCreated) {
      try {
        const deleteResult = await dependencies.conversationTable().delete({ count: 'exact' }).eq('id', conversationId);
        if (deleteResult.error || deleteResult.count !== 1) {
          receipt.conversation_store_write = 'fail';
          receipt.failure_boundary = 'conversation_store';
          receipt.side_effects = 'not_clean';
        } else {
          receipt.conversation_store_write = 'pass';
          successfulCleanup(receipt);
        }
      } catch (error) {
        receipt.conversation_store_write = 'fail';
        failed(receipt, 'conversation_store', error);
        receipt.side_effects = 'not_clean';
      }
    }
  }
  return receipt;
}

export function isLoopbackAddress(value: string | undefined): boolean {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

function hasNoCallerInputs(req: Request): boolean {
  const contentLength = req.get('content-length');
  const forbidden = ['authorization', 'cookie', 'content-type'];
  return Object.keys(req.query).length === 0
    && (!contentLength || contentLength === '0')
    && forbidden.every((name) => req.get(name) === undefined)
    && Object.keys(req.headers).every((name) => !name.startsWith('x-'))
    && (!req.body || (typeof req.body === 'object' && Object.keys(req.body).length === 0));
}

export async function ef235IdentityWriteProbeHandler(req: Request, res: Response): Promise<void> {
  if (process.env.NODE_ENV !== 'development'
    || !isLoopbackAddress(req.socket.remoteAddress)
    || !hasNoCallerInputs(req)) {
    res.status(404).end();
    return;
  }
  res.status(200).json(await runEf235IdentityWriteProbe());
}
