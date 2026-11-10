import type { NeuralProfile } from './flows/neuralProfileManager';

export const DEV_MANUAL_RETRY_CONTRACT = 'dev-manual-retry-v1' as const;
export const DEV_EPHEMERAL_REQUEST_MODE = 'dev-ephemeral-v1' as const;
export const DEV_EPHEMERAL_START_PATH = '/api/v1/chat/dev-journey/start';
export const DEV_EPHEMERAL_END_PATH = '/api/v1/chat/dev-journey/end';
export const DEV_CONVERSATION_TTL_MS = 10 * 60 * 1000;
export const DEV_CONTEXT_MAX_PAIRS = 3;
export const DEV_CONTEXT_MAX_CHARS = 6000;
// Fail closed at capacity. Never evict an unexpired replay/cancellation marker.
export const DEV_REQUESTS_PER_OWNER = 64;
export const DEV_REQUESTS_TOTAL = 2048;
export const DEV_REQUEST_FUTURE_SKEW_MS = 5 * 60 * 1000;
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
function issuedAt(requestId: string): number {
  const timestamp = /^(\d{1,13})_[\w-]+$/.exec(requestId)?.[1];
  return timestamp === undefined ? NaN : Number(timestamp);
}
export function isFreshDevRequestId(requestId: unknown, now: number): boolean {
  if (!safeId(requestId)) return false;
  const created = issuedAt(requestId);
  return Number.isSafeInteger(created) && created <= now + DEV_REQUEST_FUTURE_SKEW_MS
    && now - created < DEV_CONVERSATION_TTL_MS;
}

/** Closed request contract. No caller-supplied identity, history or settings. */
export function isValidDevEphemeralRequest(body: unknown, recoveryNegotiated = false): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const input = body as Record<string, unknown>;
  const allowed = ['requestMode', 'roleId', 'message', 'requestId', 'devConversationId', 'afterRequestId'];
  if (recoveryNegotiated) allowed.push('retryOfRequestId');
  const isRetry = Object.hasOwn(input, 'retryOfRequestId');
  if (isRetry && (!recoveryNegotiated || !safeId(input.retryOfRequestId)
    || input.retryOfRequestId === input.requestId
    || Object.hasOwn(input, 'devConversationId') || Object.hasOwn(input, 'afterRequestId'))) return false;
  return Object.keys(input).every(key => allowed.includes(key))
    && input.requestMode === DEV_EPHEMERAL_REQUEST_MODE
    && input.roleId === 'clever-fox'
    && typeof input.message === 'string'
    && input.message.trim().length > 0
    && input.message.length <= 1000
    && safeId(input.requestId)
    && (input.devConversationId === undefined
      ? !Object.hasOwn(input, 'afterRequestId') && !Object.hasOwn(input, 'devConversationId')
      : safeId(input.devConversationId) && safeId(input.afterRequestId));
}

export function isValidDevEphemeralEnd(body: unknown): body is { requestMode: string; requestId: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const input = body as Record<string, unknown>;
  return Object.keys(input).every(key => ['requestMode', 'requestId'].includes(key))
    && input.requestMode === DEV_EPHEMERAL_REQUEST_MODE && safeId(input.requestId);
}

export interface DevRetryResult {
  reply: string;
  practiceCandidate: { ifCue: string; thenAction: string } | null;
}
export interface DevRetryAttempt {
  headRequestId: string;
  inputDigest: string;
  logicalAnchorRequestId: string | null;
  state: 'pending' | 'failed' | 'completed';
  result?: DevRetryResult;
}
// Copy only the validated bounded result, never arbitrary provider fields or aliases.
function copyResult(result: DevRetryResult): DevRetryResult {
  return { reply: result.reply, practiceCandidate: result.practiceCandidate === null ? null
    : { ifCue: result.practiceCandidate.ifCue, thenAction: result.practiceCandidate.thenAction } };
}
function validResult(result: DevRetryResult | undefined, assistant: string): result is DevRetryResult {
  if (!result || result.reply !== assistant || !assistant.trim() || assistant.length > DEV_CONTEXT_MAX_CHARS) return false;
  const candidate = result.practiceCandidate;
  return candidate === null || (!!candidate && typeof candidate.ifCue === 'string'
    && !!candidate.ifCue.trim() && candidate.ifCue.length <= 200
    && typeof candidate.thenAction === 'string' && !!candidate.thenAction.trim() && candidate.thenAction.length <= 200);
}
export interface DevContextPair { user: string; assistant: string }
export interface DevConversation {
  id: string;
  owner: string;
  expiresAt: number;
  turn: number;
  pendingRequestId: string | null;
  lastCompletedRequestId: string | null;
  pairs: DevContextPair[];
  retry?: DevRetryAttempt;
}

/** Process-memory only. Contains no profile, storage, model, or account-import API. */
export function createDevConversationStore(options: {
  now: () => number;
  createId: () => string;
  onInvalidate: (conversationId: string) => void;
}) {
  const conversations = new Map<string, DevConversation>();
  const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const requests = new Map<string, { owner: string; conversationId: string | null; expiresAt: number }>();
  const key = (owner: string, requestId: string) => JSON.stringify([owner, requestId]);
  function invalidate(id: string) {
    const conversation = conversations.get(id);
    if (!conversation) return;
    conversations.delete(id);
    clearTimeout(expiryTimers.get(id));
    expiryTimers.delete(id);
    conversation.pairs.length = 0;
    conversation.pendingRequestId = null;
    conversation.lastCompletedRequestId = null;
    delete conversation.retry;
    // Replay indexes retain no content and never grant access after deletion.
    options.onInvalidate(id);
  }
  function sweep() {
    const now = options.now();
    for (const conversation of conversations.values()) if (now >= conversation.expiresAt) invalidate(conversation.id);
    for (const [id, request] of requests) if (now >= request.expiresAt) requests.delete(id);
  }
  function reserve(owner: string, requestId: string, conversationId: string | null, expiresAt: number): boolean {
    if (requests.size >= DEV_REQUESTS_TOTAL
      || [...requests.values()].filter(request => request.owner === owner).length >= DEV_REQUESTS_PER_OWNER) return false;
    requests.set(key(owner, requestId), { owner, conversationId, expiresAt });
    return true;
  }
  function find(id: string, owner: string) {
    sweep();
    const conversation = conversations.get(id);
    return conversation?.owner === owner ? conversation : undefined;
  }
  return {
    sweep,
    invalidate,
    find,
    readable(id: string, owner: string, requestId: string): boolean {
      const conversation = find(id, owner);
      return !!conversation && (conversation.retry ? conversation.retry.headRequestId === requestId
        : conversation.pendingRequestId === requestId || conversation.lastCompletedRequestId === requestId);
    },
    begin(owner: string, requestId: string, receivedAt: number, id?: string, afterRequestId?: string,
      retry?: { inputDigest: string; retryOfRequestId?: string }):
      { ok: true; conversation: DevConversation; replay?: DevRetryResult; supersededRequestId?: string }
      | { ok: false; status: number; pending?: true } {
      sweep();
      const now = options.now();
      if (!isFreshDevRequestId(requestId, now) || now - receivedAt >= DEV_CONVERSATION_TTL_MS) return { ok: false, status: 410 };
      if (requests.has(key(owner, requestId))) return { ok: false, status: 409 };
      if (retry && !/^[a-f0-9]{64}$/.test(retry.inputDigest)) return { ok: false, status: 400 };
      if (retry?.retryOfRequestId !== undefined) {
        if (id !== undefined || afterRequestId !== undefined || !safeId(retry.retryOfRequestId)
          || retry.retryOfRequestId === requestId) return { ok: false, status: 400 };
        const original = requests.get(key(owner, retry.retryOfRequestId));
        const conversation = original?.conversationId ? find(original.conversationId, owner) : undefined;
        if (!conversation) return { ok: false, status: 404 };
        const attempt = conversation.retry;
        if (!attempt || attempt.headRequestId !== retry.retryOfRequestId || attempt.inputDigest !== retry.inputDigest) {
          return { ok: false, status: 409 };
        }
        // A pending retry is only a probe: do not consume its ID or alter any state.
        if (attempt.state === 'pending') return { ok: false, status: 409, pending: true };
        if (attempt.state === 'completed' && !attempt.result) return { ok: false, status: 409 };
        if (!reserve(owner, requestId, conversation.id,
          Math.max(conversation.expiresAt, issuedAt(requestId) + DEV_CONVERSATION_TTL_MS))) return { ok: false, status: 429 };
        const supersededRequestId = attempt.headRequestId;
        attempt.headRequestId = requestId;
        if (attempt.state === 'completed') {
          conversation.lastCompletedRequestId = requestId;
          return { ok: true, conversation, replay: copyResult(attempt.result!), supersededRequestId };
        }
        attempt.state = 'pending';
        conversation.pendingRequestId = requestId;
        return { ok: true, conversation, supersededRequestId };
      }
      let conversation = id ? find(id, owner) : undefined;
      if (id && !conversation) return { ok: false, status: 404 };
      if (conversation && (!!conversation.retry !== !!retry || conversation.retry?.state === 'failed')) return { ok: false, status: 409 };
      if (conversation && (conversation.pendingRequestId || !afterRequestId || afterRequestId !== conversation.lastCompletedRequestId)) {
        return { ok: false, status: 409 };
      }
      const expiresAt = conversation?.expiresAt ?? receivedAt + DEV_CONVERSATION_TTL_MS;
      const conversationId = conversation?.id ?? options.createId();
      if (!reserve(owner, requestId, conversationId, Math.max(expiresAt, issuedAt(requestId) + DEV_CONVERSATION_TTL_MS))) return { ok: false, status: 429 };
      if (!conversation) {
        conversation = { id: conversationId, owner, expiresAt, turn: 0, pendingRequestId: null, lastCompletedRequestId: null, pairs: [] };
        conversations.set(conversation.id, conversation);
        const target = conversation;
        const expire = () => {
          if (conversations.get(target.id) !== target) return;
          const remaining = target.expiresAt - options.now();
          if (remaining <= 0) invalidate(target.id);
          else expiryTimers.set(target.id, setTimeout(expire, remaining));
        };
        expiryTimers.set(target.id, setTimeout(expire, Math.max(0, expiresAt - now)));
      }
      if (retry) conversation.retry = { headRequestId: requestId, inputDigest: retry.inputDigest,
        logicalAnchorRequestId: conversation.lastCompletedRequestId, state: 'pending' };
      conversation.turn += 1;
      conversation.pendingRequestId = requestId;
      return { ok: true, conversation };
    },
    complete(id: string, owner: string, requestId: string, user: string, assistant: string, result?: DevRetryResult): boolean {
      const conversation = find(id, owner);
      if (!conversation || conversation.pendingRequestId !== requestId || !assistant.trim()) return false;
      if (conversation.retry && (conversation.retry.headRequestId !== requestId || conversation.retry.state !== 'pending'
        || !validResult(result, assistant) || user.length + assistant.length > DEV_CONTEXT_MAX_CHARS)) return false;
      const pair = { user, assistant };
      // Whole raw pairs only, no summaries or truncation that changes their meaning.
      if (user.length + assistant.length <= DEV_CONTEXT_MAX_CHARS) conversation.pairs.push(pair);
      while (conversation.pairs.length > DEV_CONTEXT_MAX_PAIRS
        || conversation.pairs.reduce((sum, item) => sum + item.user.length + item.assistant.length, 0) > DEV_CONTEXT_MAX_CHARS) {
        conversation.pairs.shift();
      }
      conversation.pendingRequestId = null;
      conversation.lastCompletedRequestId = requestId;
      if (conversation.retry) {
        conversation.retry.state = 'completed';
        conversation.retry.result = copyResult(result!);
      }
      return true;
    },
    fail(id: string, owner: string, requestId: string): boolean {
      const conversation = find(id, owner);
      if (!conversation?.retry || conversation.pendingRequestId !== requestId
        || conversation.retry.headRequestId !== requestId || conversation.retry.state !== 'pending') return false;
      conversation.pendingRequestId = null;
      conversation.retry.state = 'failed';
      delete conversation.retry.result;
      return true;
    },
    end(owner: string, requestId: string): boolean {
      sweep();
      const request = requests.get(key(owner, requestId));
      if (request?.conversationId) invalidate(request.conversationId);
      if (request) return true;
      if (!isFreshDevRequestId(requestId, options.now())) return true;
      // Cancellation can arrive before a delayed initial start. No raw text is kept.
      return reserve(owner, requestId, null, Math.max(options.now(), issuedAt(requestId)) + DEV_CONVERSATION_TTL_MS);
    },
  };
}

/** Allocated per turn, never registered with or loaded from neuralManager. */
export function createDevEphemeralProfile(): NeuralProfile {
  return {
    userId: '',
    roleId: 'clever-fox',
    attentionBias: 'default',
    valueBias: 'default',
    influenceLog: [],
    longTermChangeLog: [],
    subconscious: {
      analyticalDepth: 0.4,
      emotionalSupport: 0.5,
      actionGuidance: 0.3,
      reflectiveSpace: 0.4,
      totalInteractions: 0,
      dominantEmotions: [],
      recentTopics: [],
      lastUpdated: 0,
    },
    createdAt: 0,
    updatedAt: 0,
  };
}
