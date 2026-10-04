import type { Request, Response } from 'express';
import { hasRegisteredIdentityDb, verifyRuntimeIdentitySchemaAccess } from '../storage/database/identity-db';
import { isLoopbackAddress } from './ef235IdentityWriteProbe';

export const EF235_IDENTITY_RUNTIME_CLASSIFICATION_PATH = '/api/v1/internal/ef235/identity-runtime-classification';

export interface Ef235IdentityRuntimeClassificationReceipt {
  runtime_config: 'valid' | 'invalid';
  identity_connection: 'connected' | 'network_unreachable' | 'connect_timeout' | 'tls_rejected' | 'authentication_rejected' | 'database_unavailable' | 'resource_unavailable' | 'other_failure' | 'not_run';
  qualified_identity_schema: 'reachable' | 'not_found' | 'access_denied' | 'unverified';
  secret_exposed: 'no';
}

function hasNoCallerInputs(req: Request): boolean {
  const contentLength = req.get('content-length');
  return Object.keys(req.query).length === 0 && (!contentLength || contentLength === '0')
    && ['authorization', 'cookie', 'content-type'].every((name) => req.get(name) === undefined)
    && Object.keys(req.headers).every((name) => !name.startsWith('x-'))
    && (!req.body || (typeof req.body === 'object' && Object.keys(req.body).length === 0));
}

function classify(error: unknown): Pick<Ef235IdentityRuntimeClassificationReceipt, 'identity_connection' | 'qualified_identity_schema'> {
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined;
  if (code === '42P01') return { identity_connection: 'connected', qualified_identity_schema: 'not_found' };
  if (code === '42501') return { identity_connection: 'connected', qualified_identity_schema: 'access_denied' };
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') return { identity_connection: 'network_unreachable', qualified_identity_schema: 'unverified' };
  if (code === 'ETIMEDOUT') return { identity_connection: 'connect_timeout', qualified_identity_schema: 'unverified' };
  if (code === '28P01') return { identity_connection: 'authentication_rejected', qualified_identity_schema: 'unverified' };
  if (code === '3D000') return { identity_connection: 'database_unavailable', qualified_identity_schema: 'unverified' };
  if (code === '53300') return { identity_connection: 'resource_unavailable', qualified_identity_schema: 'unverified' };
  return { identity_connection: 'other_failure', qualified_identity_schema: 'unverified' };
}

export async function runEf235IdentityRuntimeClassification(): Promise<Ef235IdentityRuntimeClassificationReceipt> {
  if (!hasRegisteredIdentityDb()) return { runtime_config: 'invalid', identity_connection: 'not_run', qualified_identity_schema: 'unverified', secret_exposed: 'no' };
  try {
    await verifyRuntimeIdentitySchemaAccess();
    return { runtime_config: 'valid', identity_connection: 'connected', qualified_identity_schema: 'reachable', secret_exposed: 'no' };
  } catch (error) {
    return { runtime_config: 'valid', ...classify(error), secret_exposed: 'no' };
  }
}

export async function ef235IdentityRuntimeClassificationHandler(req: Request, res: Response): Promise<void> {
  if (process.env.NODE_ENV !== 'development' || !isLoopbackAddress(req.socket.remoteAddress) || !hasNoCallerInputs(req)) { res.status(404).end(); return; }
  res.status(200).json(await runEf235IdentityRuntimeClassification());
}
