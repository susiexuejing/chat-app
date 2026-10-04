import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { getRuntimeSupabaseClientOnly } from '../storage/database/supabase-client';
import { isLoopbackAddress } from './ef235IdentityWriteProbe';

export const EF235_CONVERSATION_RUNTIME_CLASSIFICATION_PATH = '/api/v1/internal/ef235/conversation-runtime-classification';

type WriteClass = 'pass' | 'schema_column' | 'table_missing' | 'required_field' | 'foreign_key' | 'rls_or_grant' | 'runtime_insert_failure';
type CleanupClass = 'not_needed' | 'rolled_back_only' | 'not_clean';

export interface Ef235ConversationRuntimeClassificationReceipt {
  probe_contract: 'ef235_conversation_runtime_classification_v1';
  conversation_write: WriteClass;
  failure_boundary: 'none' | 'conversation_insert' | 'conversation_cleanup';
  side_effects: CleanupClass;
  secret_exposed: 'no';
}

function classify(error: unknown): WriteClass {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '') : '';
  if (code === '42703' || code === 'PGRST204') return 'schema_column';
  if (code === '42P01' || code === 'PGRST205') return 'table_missing';
  if (code === '23502') return 'required_field';
  if (code === '23503') return 'foreign_key';
  if (code === '42501' || code === 'PGRST301') return 'rls_or_grant';
  return 'runtime_insert_failure';
}

function hasNoCallerInputs(req: Request): boolean {
  const contentLength = req.get('content-length');
  return Object.keys(req.query).length === 0
    && (!contentLength || contentLength === '0')
    && !req.get('authorization')
    && !req.get('cookie')
    && !req.get('content-type')
    && Object.keys(req.headers).every(name => !name.startsWith('x-'))
    && (!req.body || (typeof req.body === 'object' && Object.keys(req.body).length === 0));
}

/** Fixed DEV-only probe: a synthetic insert is always deleted in finally. */
export async function runEf235ConversationRuntimeClassification(): Promise<Ef235ConversationRuntimeClassificationReceipt> {
  const receipt: Ef235ConversationRuntimeClassificationReceipt = {
    probe_contract: 'ef235_conversation_runtime_classification_v1',
    conversation_write: 'runtime_insert_failure',
    failure_boundary: 'none',
    side_effects: 'not_needed',
    secret_exposed: 'no',
  };
  const id = crypto.randomUUID();
  const owner = crypto.randomUUID();
  const now = Date.now();
  let inserted = false;
  try {
    const { error } = await getRuntimeSupabaseClientOnly().from('conversations').insert({
      id,
      user_id: owner,
      role_id: 'ef235-runtime-probe',
      state: 'active',
      created_at: now,
      updated_at: now,
      last_message_at: null,
    });
    if (error) throw error;
    inserted = true;
    receipt.conversation_write = 'pass';
  } catch (error) {
    receipt.conversation_write = classify(error);
    receipt.failure_boundary = 'conversation_insert';
  } finally {
    if (inserted) {
      try {
        const { error, count } = await getRuntimeSupabaseClientOnly()
          .from('conversations').delete({ count: 'exact' }).eq('id', id).eq('user_id', owner);
        if (error || count !== 1) {
          receipt.failure_boundary = 'conversation_cleanup';
          receipt.side_effects = 'not_clean';
        } else {
          receipt.side_effects = 'rolled_back_only';
        }
      } catch {
        receipt.failure_boundary = 'conversation_cleanup';
        receipt.side_effects = 'not_clean';
      }
    }
  }
  return receipt;
}

export async function ef235ConversationRuntimeClassificationHandler(req: Request, res: Response): Promise<void> {
  if (process.env.NODE_ENV !== 'development' || !isLoopbackAddress(req.socket.remoteAddress) || !hasNoCallerInputs(req)) {
    res.status(404).end();
    return;
  }
  res.status(200).json(await runEf235ConversationRuntimeClassification());
}
