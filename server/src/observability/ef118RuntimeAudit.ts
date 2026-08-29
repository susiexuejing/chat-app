import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
} from 'node:fs';
import { dirname } from 'node:path';

export const EF118_RUNTIME_AUDIT_PATH = '/var/log/emotionflow/ef118-runtime-sanitized.jsonl';

export const EF118_AUDIT_FIELD_WHITELIST = [
  'timestamp',
  'deploymentSha',
  'configPresence',
  'dbSessionCategory',
  'providerCategory',
  'sseCategory',
  'frontendErrorMappingCategory',
] as const;

const DB_SESSION_CATEGORIES = [
  'runtime_started',
  'conversation_created',
  'conversation_loaded',
  'conversation_not_found',
  'conversation_storage_error',
  'conversation_lookup_error',
  'conversation_verify_error',
  'messages_loaded',
  'messages_query_error',
  'message_persisted',
  'message_insert_error',
  'conversation_update_error',
  'idempotent_replay',
  'idempotency_guard_error',
  'session_created',
  'session_missing',
  'request_invalid',
  'chat_start_processing_error',
] as const;

const PROVIDER_CATEGORIES = [
  'not_reached',
  'request_reached',
  'key_missing',
  'request_started',
  'response_success',
  'response_client_error',
  'response_server_error',
  'reader_missing',
  'first_event',
  'stream_completed',
  'stream_timeout',
  'stream_read_error',
  'analysis_failure',
] as const;

const SSE_CATEGORIES = [
  'not_established',
  'connection_established',
  'first_event',
  'completed',
  'deep_failure',
  'timeout',
  'client_closed',
] as const;

const FRONTEND_ERROR_MAPPING_CATEGORIES = [
  'none',
  'safe_connection_retry',
  'chat_start_retry',
  'deep_response_retry',
  'stream_timeout_retry',
] as const;

export type Ef118DbSessionCategory = (typeof DB_SESSION_CATEGORIES)[number];
export type Ef118ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];
export type Ef118SseCategory = (typeof SSE_CATEGORIES)[number];
export type Ef118FrontendErrorMappingCategory = (typeof FRONTEND_ERROR_MAPPING_CATEGORIES)[number];

export interface Ef118RuntimeAuditEvent {
  dbSessionCategory?: Ef118DbSessionCategory;
  providerCategory?: Ef118ProviderCategory;
  sseCategory?: Ef118SseCategory;
  frontendErrorMappingCategory?: Ef118FrontendErrorMappingCategory;
}

export interface Ef118RuntimeAuditRecord {
  timestamp: string;
  deploymentSha: string;
  configPresence: {
    dashscopeApiKey: boolean;
    dashscopeDeepApiKey: boolean;
    supabaseUrl: boolean;
    supabaseAnonKey: boolean;
    supabaseServiceRoleKey: boolean;
  };
  dbSessionCategory: Ef118DbSessionCategory | null;
  providerCategory: Ef118ProviderCategory | null;
  sseCategory: Ef118SseCategory | null;
  frontendErrorMappingCategory: Ef118FrontendErrorMappingCategory | null;
}

function isAllowed<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T);
}

function safeDeploymentSha(): string {
  const value = process.env.GIT_COMMIT;
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)
    ? value
    : 'unavailable';
}

export function createEf118RuntimeAuditRecord(
  event: Ef118RuntimeAuditEvent,
  timestamp = new Date(),
): Ef118RuntimeAuditRecord {
  return {
    timestamp: timestamp.toISOString(),
    deploymentSha: safeDeploymentSha(),
    configPresence: {
      dashscopeApiKey: Boolean(process.env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY_LIGHT),
      dashscopeDeepApiKey: Boolean(process.env.DASHSCOPE_API_KEY_DEEP),
      supabaseUrl: Boolean(process.env.COZE_SUPABASE_URL),
      supabaseAnonKey: Boolean(process.env.COZE_SUPABASE_ANON_KEY),
      supabaseServiceRoleKey: Boolean(process.env.COZE_SUPABASE_SERVICE_ROLE_KEY),
    },
    dbSessionCategory: isAllowed(event.dbSessionCategory, DB_SESSION_CATEGORIES)
      ? event.dbSessionCategory
      : null,
    providerCategory: isAllowed(event.providerCategory, PROVIDER_CATEGORIES)
      ? event.providerCategory
      : null,
    sseCategory: isAllowed(event.sseCategory, SSE_CATEGORIES)
      ? event.sseCategory
      : null,
    frontendErrorMappingCategory: isAllowed(
      event.frontendErrorMappingCategory,
      FRONTEND_ERROR_MAPPING_CATEGORIES,
    ) ? event.frontendErrorMappingCategory : null,
  };
}

function targetIsSafe(path: string): boolean {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o750 });
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) return false;
  if (!existsSync(path)) return true;
  const fileStat = lstatSync(path);
  return fileStat.isFile() && !fileStat.isSymbolicLink();
}

/** DEV-only, fail-closed audit sink. No caller-provided text is serialized. */
export function writeEf118RuntimeAudit(event: Ef118RuntimeAuditEvent): void {
  if (!isEf118RuntimeAuditEnabled()) return;
  try {
    if (!targetIsSafe(EF118_RUNTIME_AUDIT_PATH)) return;
    const record = createEf118RuntimeAuditRecord(event);
    appendFileSync(EF118_RUNTIME_AUDIT_PATH, `${JSON.stringify(record)}\n`, {
      encoding: 'utf8',
      mode: 0o640,
      flag: 'a',
    });
  } catch {
    console.error('[EF-118] Sanitized runtime audit write failed');
  }
}

export function isEf118RuntimeAuditEnabled(): boolean {
  return process.env.NODE_ENV === 'development';
}
