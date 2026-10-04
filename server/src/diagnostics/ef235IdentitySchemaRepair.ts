import type { Request, Response } from 'express';
import { ensureDevIdentitySchema } from '../storage/database/identity-db';
import {
  type Ef235IdentityWriteProbeReceipt,
  isLoopbackAddress,
  runEf235IdentityWriteProbe,
} from './ef235IdentityWriteProbe';

export const EF235_IDENTITY_SCHEMA_REPAIR_PATH = '/api/v1/internal/ef235/identity-schema-repair';

function repairFailure(error: unknown): Ef235IdentityWriteProbeReceipt {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code : undefined;
  return {
    anonymous_session_write: 'fail',
    owner_binding_write: 'not_run',
    conversation_store_write: 'not_run',
    failure_boundary: 'anonymous_session',
    schema_state: code === '42501' ? 'missing' : 'unknown',
    grant_state: code === '42501' ? 'denied' : 'unknown',
    side_effects: 'none',
    secret_exposed: 'no',
  };
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

/** Fixed DEV-only schema repair, immediately followed by the rollback probe. */
export async function ef235IdentitySchemaRepairHandler(req: Request, res: Response): Promise<void> {
  if (process.env.NODE_ENV !== 'development'
    || !isLoopbackAddress(req.socket.remoteAddress)
    || !hasNoCallerInputs(req)) {
    res.status(404).end();
    return;
  }
  try {
    await ensureDevIdentitySchema();
    res.status(200).json(await runEf235IdentityWriteProbe());
  } catch (error) {
    res.status(200).json(repairFailure(error));
  }
}
