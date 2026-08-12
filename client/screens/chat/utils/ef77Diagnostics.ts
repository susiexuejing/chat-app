import type { ChatSession } from '../types';

export const EF77_TRACE_PREFIX = '[EF77_TRACE]';
export const EF77_STORAGE_KEY = 'chat_sessions';

export interface Ef77SnapshotMetadata {
  snapshotHash: string | null;
  sessionCount: number;
  activeSessionId: string | null;
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
    activeSessionId: activeSession?.id ?? activeSessionId,
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

export function emitEf77Trace(event: string, details: Record<string, unknown>): void {
  if (!isEf77DiagnosticEnabled()) return;
  console.info(EF77_TRACE_PREFIX, JSON.stringify({ event, ...details }));
}

export function getEf77ErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
