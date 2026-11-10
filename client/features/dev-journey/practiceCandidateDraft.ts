import type { DemoRepository, Practice, PracticeCandidateOrigin, Snapshot } from '@/features/synthetic-demo/repository';

/** Internal normalized content only. This is NOT a model/API/SSE output contract. */
export type PracticeCandidateContent = Pick<Practice, 'ifCue' | 'thenAction'>;
export interface PracticeCandidateScope {
  /** Host-owned in-memory identity, rotated on logout/login, even for the same account. */
  readonly accountSession: object;
  /** Backend session provenance, separate from the host authentication identity. */
  readonly sessionId?: string;
  readonly accountId: string;
  readonly patternId: string;
  readonly devConversationId: string;
  readonly requestId: string;
}
/** Object identity is the capability; reconstructed/copied handles are not accepted. */
export interface PracticeCandidateTicket { readonly scope: PracticeCandidateScope }
export interface PracticeCandidateDraft {
  readonly scope: PracticeCandidateScope;
  /** A suggestion, never a user fact or proof of an upstream provider. Not persisted. */
  readonly source: 'ai-suggestion';
  readonly content: Readonly<PracticeCandidateContent>;
  readonly patternVersion: number;
  readonly practiceVersion: number;
}
export type PracticeCandidateSaveResult =
  | { readonly status: 'saved'; readonly snapshot: Snapshot }
  | { readonly status: 'stale' | 'failed' };

const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
function validContent(value: unknown, allowEmpty = false): value is PracticeCandidateContent {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const fields = value as Record<string, unknown>;
  return Object.keys(fields).length === 2 && Object.keys(fields).every(key => key === 'ifCue' || key === 'thenAction')
    && typeof fields.ifCue === 'string' && fields.ifCue.length <= 200 && (allowEmpty || nonempty(fields.ifCue))
    && typeof fields.thenAction === 'string' && fields.thenAction.length <= 200 && (allowEmpty || nonempty(fields.thenAction));
}
function sameScope(a: PracticeCandidateScope | null, b: PracticeCandidateScope) {
  return !!a && a.accountSession === b.accountSession && a.accountId === b.accountId && a.patternId === b.patternId
    && a.sessionId === b.sessionId && a.devConversationId === b.devConversationId && a.requestId === b.requestId;
}

/**
 * Memory-only edit and explicit-save boundary. Host must invalidate synchronously
 * on stop/reset/exit/auth/target changes and supply the live scope on every call.
 * begin binds the user-selected confirmed target after upstream success, not a turn hook.
 * Only an upstream-validated structured suggestion may call receive. No text parser.
 * The repository is the existing synchronous repository; async adapters are unsupported.
 */
export function createPracticeCandidateDraftController(options: {
  repository: Pick<DemoRepository, 'getPattern' | 'savePractice'>;
  getCurrentScope: () => PracticeCandidateScope | null;
}) {
  const { repository, getCurrentScope } = options;
  let disposed = false;
  let ticket: PracticeCandidateTicket | null = null;
  let draft: PracticeCandidateDraft | null = null;
  let accepted = false;
  let versions: { pattern: number; practice: number } | null = null;
  function invalidate() { ticket = null; draft = null; accepted = false; versions = null; }
  function current(): boolean {
    if (disposed || !ticket) return false;
    try { if (sameScope(getCurrentScope(), ticket.scope)) return true; } catch { /* Fail closed. */ }
    invalidate(); return false;
  }
  function targetUnchanged(): boolean {
    if (!ticket || !versions) return false;
    const state = repository.getPattern(ticket.scope.accountId, ticket.scope.patternId);
    return state.pattern.accountId === ticket.scope.accountId && state.pattern.patternId === ticket.scope.patternId
      && state.pattern.decision === 'confirmed' && state.pattern.version === versions.pattern
      && (state.practice?.version ?? 0) === versions.practice;
  }
  function nextDraft(content: PracticeCandidateContent): PracticeCandidateDraft {
    return Object.freeze({ scope: ticket!.scope, source: 'ai-suggestion',
      content: Object.freeze({ ifCue: content.ifCue, thenAction: content.thenAction }),
      patternVersion: versions!.pattern, practiceVersion: versions!.practice });
  }
  return {
    /** Revokes prior handles, even if the scope values are unchanged. Does not write. */
    begin(scope: PracticeCandidateScope): PracticeCandidateTicket | null {
      invalidate();
      if (disposed || !scope || typeof scope.accountSession !== 'object' || !scope.accountSession
        || ![scope.accountId, scope.patternId, scope.devConversationId, scope.requestId].every(nonempty)) return null;
      try {
        if (!sameScope(getCurrentScope(), scope)) return null;
        const state = repository.getPattern(scope.accountId, scope.patternId);
        if (state.pattern.decision !== 'confirmed' || state.pattern.accountId !== scope.accountId || state.pattern.patternId !== scope.patternId) return null;
        versions = { pattern: state.pattern.version, practice: state.practice?.version ?? 0 };
        ticket = Object.freeze({ scope: Object.freeze({ accountSession: scope.accountSession, accountId: scope.accountId,
          patternId: scope.patternId, ...(scope.sessionId ? { sessionId: scope.sessionId } : {}), devConversationId: scope.devConversationId, requestId: scope.requestId }) });
        return ticket;
      } catch { invalidate(); return null; }
    },
    receive(handle: PracticeCandidateTicket, content: unknown): boolean {
      if (!current() || handle !== ticket || accepted || !validContent(content)) return false;
      try { if (!targetUnchanged()) return false; } catch { return false; }
      draft = nextDraft(content); accepted = true; return true;
    },
    getDraft(): PracticeCandidateDraft | null { return current() ? draft : null; },
    /** Exact displayed revision is required; stale edit/save/cancel callbacks do nothing. */
    edit(expected: PracticeCandidateDraft, content: unknown): boolean {
      if (!current() || !draft || expected !== draft || !validContent(content, true)) return false;
      draft = nextDraft(content); return true;
    },
    cancel(expected: PracticeCandidateDraft): boolean {
      if (!current() || !draft || expected !== draft) return false;
      invalidate(); return true;
    },
    save(expected: PracticeCandidateDraft): PracticeCandidateSaveResult {
      if (!current() || !draft || expected !== draft) return { status: 'stale' };
      try {
        // Freeze versions at explicit target selection, never silently rebase onto new data.
        if (!validContent(draft.content) || !targetUnchanged()) return { status: 'failed' };
        const snapshot = repository.savePractice(draft.scope.accountId, draft.scope.patternId,
          { ifCue: draft.content.ifCue, thenAction: draft.content.thenAction, ...(draft.scope.sessionId ? { candidateOrigin: {
            kind: 'ai-suggestion' as PracticeCandidateOrigin['kind'], sessionId: draft.scope.sessionId,
            devConversationId: draft.scope.devConversationId, requestId: draft.scope.requestId,
          } } : {}) }, draft.practiceVersion);
        invalidate();
        return { status: 'saved', snapshot };
      } catch {
        // No raw error, diagnostic payload or candidate content escapes through logs.
        // Existing repository failures are atomic; keep the draft and captured versions.
        return { status: 'failed' };
      }
    },
    invalidate,
    dispose() { disposed = true; invalidate(); },
  };
}
