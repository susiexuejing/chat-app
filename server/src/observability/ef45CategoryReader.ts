import { existsSync, readFileSync } from 'node:fs';
import type { Request, Response } from 'express';
import {
  EF45_R2_PROBE_MARKER,
  EF118_AUDIT_FIELD_WHITELIST,
  EF118_RUNTIME_AUDIT_PATH,
} from './ef118RuntimeAudit';

export const EF45_SYNTHETIC_PROBE = {
  roleId: 'clever-fox',
  message: 'EF45_SYNTHETIC_PROBE_V1',
} as const;

export const EF45_DIAGNOSTIC_CATEGORIES = [
  'session_csrf',
  'chat_start',
  'stream_transport',
  'provider_runtime_config',
  'application_internal',
  'no_matching_record',
] as const;

export type Ef45DiagnosticCategory = (typeof EF45_DIAGNOSTIC_CATEGORIES)[number];

export interface Ef45CategoryResponse {
  buildSha: string;
  observedAt: string;
  category: Ef45DiagnosticCategory;
}

export interface Ef45AuditRecord {
  timestamp: string;
  deploymentSha: string;
  dbSessionCategory: string | null;
  providerCategory: string | null;
  sseCategory: string | null;
  frontendErrorMappingCategory: string | null;
  ef45ProbeMarker: typeof EF45_R2_PROBE_MARKER | null;
}

const EMPTY_RESPONSE: Ef45CategoryResponse = {
  buildSha: 'unavailable',
  observedAt: 'unavailable',
  category: 'no_matching_record',
};

function isSafeAuditRecord(value: unknown): value is Ef45AuditRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const allowedKeys = [...EF118_AUDIT_FIELD_WHITELIST].sort();
  return keys.length === allowedKeys.length
    && keys.every((key, index) => key === allowedKeys[index])
    && typeof record.timestamp === 'string'
    && typeof record.deploymentSha === 'string'
    && record.ef45ProbeMarker === EF45_R2_PROBE_MARKER
    && (typeof record.dbSessionCategory === 'string' || record.dbSessionCategory === null)
    && (typeof record.providerCategory === 'string' || record.providerCategory === null)
    && (typeof record.sseCategory === 'string' || record.sseCategory === null)
    && (typeof record.frontendErrorMappingCategory === 'string' || record.frontendErrorMappingCategory === null);
}

export function isFixedEf45SyntheticProbe(
  marker: unknown,
  body: unknown,
): boolean {
  if (marker !== EF45_R2_PROBE_MARKER || typeof body !== 'object' || body === null) return false;
  const candidate = body as Record<string, unknown>;
  return Object.keys(candidate).length === 2
    && candidate.roleId === EF45_SYNTHETIC_PROBE.roleId
    && candidate.message === EF45_SYNTHETIC_PROBE.message;
}

export function classifyEf45AuditRecord(record: Ef45AuditRecord): Ef45DiagnosticCategory {
  if (record.dbSessionCategory === 'session_missing' || record.dbSessionCategory === 'request_invalid') {
    return 'session_csrf';
  }
  if (record.dbSessionCategory === 'chat_start_processing_error') return 'chat_start';
  if (record.sseCategory === 'not_established'
    || record.sseCategory === 'timeout'
    || record.sseCategory === 'client_closed'
    || record.sseCategory === 'deep_failure') {
    return 'stream_transport';
  }
  if (record.providerCategory === 'key_missing'
    || record.providerCategory === 'response_client_error'
    || record.providerCategory === 'response_server_error'
    || record.providerCategory === 'reader_missing'
    || record.providerCategory === 'stream_timeout'
    || record.providerCategory === 'stream_read_error'
    || record.providerCategory === 'analysis_failure') {
    return 'provider_runtime_config';
  }
  return 'application_internal';
}

/**
 * Reads only the fixed EF-45 marker from the sanitized audit artifact. It
 * deliberately has no caller-selectable path, marker, filter, or pagination.
 */
export function readEf45Category(
  readAudit: () => string = () => readFileSync(EF118_RUNTIME_AUDIT_PATH, 'utf8'),
  artifactExists: () => boolean = () => existsSync(EF118_RUNTIME_AUDIT_PATH),
): Ef45CategoryResponse {
  if (process.env.NODE_ENV !== 'development' || !artifactExists()) return { ...EMPTY_RESPONSE };
  try {
    const matches = readAudit().split('\n')
      .flatMap(line => {
        try {
          const parsed: unknown = JSON.parse(line);
          return isSafeAuditRecord(parsed) ? [parsed] : [];
        } catch {
          return [];
        }
      });
    const record = matches.at(-1);
    if (!record) return { ...EMPTY_RESPONSE };
    return {
      buildSha: record.deploymentSha,
      observedAt: record.timestamp,
      category: classifyEf45AuditRecord(record),
    };
  } catch {
    return { ...EMPTY_RESPONSE };
  }
}

export function ef45CategoryReader(req: Request, res: Response): void {
  if (process.env.NODE_ENV !== 'development' || Object.keys(req.query).length > 0) {
    res.status(404).end();
    return;
  }
  res.status(200).json(readEf45Category());
}
