import type { ChatSession } from '../types';

export const EF77_TRACE_PREFIX = '[EF77_TRACE]';
export const EF77_STORAGE_KEY = 'chat_sessions';

export type Ef77QueueKind = 'managed' | 'bypass';

export interface Ef77WriteAttribution {
  writerSource: string;
  transitionReason: string;
  queueKind: Ef77QueueKind;
  activeSessionId?: string | null;
  failurePath?: string | null;
}

interface Ef77StorageAdapter {
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface Ef77SnapshotMetadata {
  snapshotHash: string | null;
  sessionCount: number;
  activeSessionIdPresent: boolean;
  activeTurnStatus: string | null;
  activeChatPhase: string | null;
  hasPendingTurn: boolean;
  requestIdPresent: boolean;
  userMessageIdPresent: boolean;
}

export function isEf77DiagnosticEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('ef77trace') === 'true';
}

// FNV-1a 64-bit. This hashes the exact serialized UTF-16 code-unit sequence
// without exposing it. The same helper is used for reads and both write paths.
export function hashEf77Snapshot(serialized: string | null): string | null {
  if (serialized === null) return null;
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, '0');
}

export function summarizeEf77Snapshot(
  serialized: string | null,
  activeSessionId: string | null
): Ef77SnapshotMetadata {
  let sessions: ChatSession[] = [];
  if (serialized) {
    try {
      const parsed: unknown = JSON.parse(serialized);
      if (Array.isArray(parsed)) sessions = parsed as ChatSession[];
    } catch {
      // A malformed payload is represented by its hash and zero parsed sessions.
    }
  }

  const activeSession = activeSessionId
    ? sessions.find(session => session.id === activeSessionId)
    : undefined;

  return {
    snapshotHash: hashEf77Snapshot(serialized),
    sessionCount: sessions.length,
    activeSessionIdPresent: !!(activeSession?.id ?? activeSessionId),
    activeTurnStatus: activeSession?.turnStatus ?? null,
    activeChatPhase: activeSession?.chatPhase ?? null,
    hasPendingTurn: !!activeSession?.pendingTurn,
    requestIdPresent: !!activeSession?.pendingTurn?.requestId,
    userMessageIdPresent: !!activeSession?.pendingTurn?.userMessageId,
  };
}

export function getEf77LocationMetadata() {
  if (typeof window === 'undefined') {
    return { origin: 'non-web', pathname: '' };
  }
  return { origin: window.location.origin, pathname: window.location.pathname };
}

const EF77_ALLOWED_TRACE_KEYS = new Set([
  'activeChatPhase',
  'activeSessionIdPresent',
  'activeTurnStatus',
  'adapterName',
  'branchEntered',
  'backendSessionIdPresent',
  'clientSessionIdPresent',
  'contentChunkCount',
  'conversationIdPresent',
  'completedAt',
  'errorType',
  'elapsedMs',
  'eventType',
  'eventCount',
  'executionStage',
  'failurePath',
  'hasPendingTurn',
  'initialRevision',
  'isRetry',
  'mounted',
  'nextTurnStatus',
  'operation',
  'origin',
  'pathname',
  'previousTurnStatus',
  'promiseCompleted',
  'readerPresent',
  'rejected',
  'resolved',
  'responseOk',
  'providerInstanceId',
  'queueGeneration',
  'queueKind',
  'requestIdPresent',
  'resultingChatPhase',
  'revision',
  'sessionCount',
  'sessionIdPresent',
  'skipReason',
  'snapshotHash',
  'source',
  'startedAt',
  'streamSettled',
  'storageKey',
  'timestamp',
  'timeoutWon',
  'doneObserved',
  'durationMs',
  'eofObserved',
  'firstContentChunkObserved',
  'firstEventObserved',
  'httpStatus',
  'terminationReason',
  'transition',
  'transitionReason',
  'transportTerminated',
  'userMessageIdPresent',
  'writeSource',
  'writerSource',
]);

const normalizeEf77TraceKey = (key: string) => key.replace(/[^a-z0-9]/gi, '').toLowerCase();

function presenceKeyForEf77SensitiveId(key: string): string | null {
  const normalized = normalizeEf77TraceKey(key);
  if (normalized === 'requestid') return 'requestIdPresent';
  if (normalized === 'usermessageid' || normalized === 'messageid') {
    return 'userMessageIdPresent';
  }
  if (
    normalized === 'activesessionid' ||
    normalized === 'currentsessionid' ||
    normalized === 'restoredsessionid' ||
    normalized === 'persistedsessionid' ||
    normalized === 'backendsessionid' ||
    normalized === 'sessionid' ||
    normalized === 'sessionids'
  ) {
    return normalized === 'activesessionid' ? 'activeSessionIdPresent' : 'sessionIdPresent';
  }
  return null;
}

function collectEf77SensitiveIdPresence(
  value: unknown,
  presence: Record<string, boolean>,
  seen: Set<object>
): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach(item => collectEf77SensitiveIdPresence(item, presence, seen));
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const presenceKey = presenceKeyForEf77SensitiveId(key);
    if (presenceKey) {
      const values = Array.isArray(nestedValue) ? nestedValue : [nestedValue];
      presence[presenceKey] = presence[presenceKey]
        || values.some(item => item != null && item !== '');
    }
    collectEf77SensitiveIdPresence(nestedValue, presence, seen);
  }
}

export function sanitizeEf77TraceDetails(
  details: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const presence: Record<string, boolean> = {};
  collectEf77SensitiveIdPresence(details, presence, new Set<object>());

  for (const [key, value] of Object.entries(details)) {
    if (!EF77_ALLOWED_TRACE_KEYS.has(key)) continue;
    if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) {
      sanitized[key] = value;
    }
  }
  return { ...sanitized, ...presence };
}

export function emitEf77Trace(event: string, details: Record<string, unknown>): void {
  if (!isEf77DiagnosticEnabled()) return;
  console.info(EF77_TRACE_PREFIX, JSON.stringify({ event, ...sanitizeEf77TraceDetails(details) }));
}

export function getEf77ErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function observeStoragePromise(
  operation: Promise<void>,
  operationName: 'setItem' | 'removeItem',
  attribution: Ef77WriteAttribution,
  snapshotMetadata: Ef77SnapshotMetadata | null
): Promise<void> {
  const base = {
    operation: operationName,
    storageKey: EF77_STORAGE_KEY,
    writerSource: attribution.writerSource,
    transitionReason: attribution.transitionReason,
    queueKind: attribution.queueKind,
    failurePath: attribution.failurePath ?? null,
    ...getEf77LocationMetadata(),
    ...(snapshotMetadata ?? {}),
  };
  emitEf77Trace('storage_operation_started', base);
  void operation.then(
    () => emitEf77Trace('storage_operation_completed', base),
    error => emitEf77Trace('storage_operation_failed', {
      ...base,
      errorType: getEf77ErrorType(error),
    })
  );
  return operation;
}

export function attributedSetItem(
  adapter: Ef77StorageAdapter,
  key: string,
  value: string,
  attribution: Ef77WriteAttribution
): Promise<void> {
  // The disabled path is deliberately the underlying call itself: no parsing,
  // hashing, metadata allocation, extra read, or replacement Promise.
  if (!isEf77DiagnosticEnabled()) return adapter.setItem(key, value);
  const metadata = summarizeEf77Snapshot(value, attribution.activeSessionId ?? null);
  const operation = adapter.setItem(key, value);
  return observeStoragePromise(operation, 'setItem', attribution, metadata);
}

export function attributedRemoveItem(
  adapter: Ef77StorageAdapter,
  key: string,
  attribution: Ef77WriteAttribution
): Promise<void> {
  if (!isEf77DiagnosticEnabled()) return adapter.removeItem(key);
  const operation = adapter.removeItem(key);
  return observeStoragePromise(operation, 'removeItem', attribution, null);
}
