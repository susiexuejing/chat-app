export interface DevPracticeCandidate {
  readonly ifCue: string; readonly thenAction: string;
  readonly source: { readonly sessionId: string; readonly devConversationId: string; readonly requestId: string };
}
export interface DevPracticeReply {
  readonly contract: 'dev-reply-practice-v1'; readonly reply: string;
  readonly practiceCandidate: { readonly ifCue: string; readonly thenAction: string } | null;
  readonly source: DevPracticeCandidate['source'];
}
/** Explicit same-session DEV turns. No network, storage or React imports. */
export type DevRealRequestStatus = 'idle' | 'starting' | 'streaming' | 'success' | 'failed' | 'recoverable' | 'stopped';
export interface DevCompletedTurn {
  readonly inputText: string; readonly requestId: string; readonly logicalRequestId?: string; readonly sentAt: number;
  readonly reactionText: string; readonly companionText: string; readonly deepText: string;
}
export interface DevRealRequestSnapshot {
  readonly practiceCandidate?: DevPracticeCandidate | null;
  readonly status: DevRealRequestStatus;
  readonly inputText: string;
  readonly requestId: string | null;
  readonly sentAt: number;
  readonly reactionText: string;
  readonly companionText: string;
  readonly deepText: string;
  readonly completedTurns: readonly DevCompletedTurn[];
  readonly error: string | null;
  readonly canSend: boolean;
  readonly canRetry?: boolean;
  readonly preserveDraft?: boolean;
  /** Stable identity of the user bubble across manual attempts. */
  readonly logicalRequestId?: string;
  /** Observed backend output, not proof of a provider/model or semantic grounding. */
  readonly source: 'backend-deep' | null;
}
export interface DevRealRequestInput {
  roleId: 'clever-fox'; message: string; requestId: string;
  devConversationId?: string; afterRequestId?: string; retryOfRequestId?: string;
}
export interface DevRealRequestStart {
  devReplyContract?: 'dev-reply-practice-v1';
  devRetryContract?: 'dev-manual-retry-v1';
  sessionId: string; devConversationId: string; expiresAt: number; remainingLifetimeMs: number;
  reactionText: string; companionText: string;
}
export interface DevRealRequestCallbacks {
  onDeepChunk: (text: string) => void;
  onDone: (reply?: DevPracticeReply) => void;
  onError: (reason?: 'retry_turn' | 'transport' | 'terminal') => void;
}
export interface DevRealRequestTransport {
  start: (input: DevRealRequestInput, signal: AbortSignal) => Promise<DevRealRequestStart>;
  stream: (sessionId: string, callbacks: DevRealRequestCallbacks, signal: AbortSignal, expected?: { retryContract?: 'dev-manual-retry-v1'; contract?: 'dev-reply-practice-v1'; devConversationId: string; requestId: string }) => Promise<void>;
  /** Best effort authenticated cleanup, never a model send or automatic retry. */
  end: (requestId: string) => Promise<void>;
}
export interface DevRealRequestController {
  getSnapshot: () => DevRealRequestSnapshot;
  subscribe: (listener: () => void) => () => void;
  send: (text: string) => Promise<boolean>;
  retry: () => Promise<boolean>;
  stop: () => void;
  /** Explicit New Chat only. Never sends a model request. */
  reset: () => void;
  dispose: () => void;
}
export const DEV_REAL_REQUEST_NOTICE = '真实请求会产生 API 费用；同一对话可使用最近 3 轮已完成的用户原话与 Deep 回复，前文合计最多 6000 字符，当前输入最多 1000 字符。会话从首次发送起最多 10 分钟；不写入原聊天画像。';
export const DEV_REAL_REQUEST_STOP_NOTICE = '结束、停止、新对话或离开后清除本地上下文，并尝试认证结束服务端会话；断网或突然关闭时无法保证立即送达，服务端到期清除。这不保证上游删除、停止工作或停止计费。';
export const DEV_REAL_REQUEST_SOURCE_NOTICE = '仅确认收到后端 Deep 内容；实际供应商、模型与费用未验证。';
export const DEV_REAL_REQUEST_MAX_INPUT = 1000;
export const DEV_REAL_REQUEST_ID_PATTERN = /^[\w-]{1,100}$/;
export const DEV_REAL_REQUEST_RETRY_NOTICE = '重试可能产生新的 API 费用；上一次请求也可能仍在上游处理或计费。';
const RETRY_MESSAGE = '刚才的回复没有完成，可以重试';
const FAILED_MESSAGE = '本次真实请求未完成，会话已结束。请新开对话后再显式发送。';
const EXPIRED_MESSAGE = '会话或请求已过期，也可能是设备时钟不准确。请检查时间并新开对话，再自行发送。';
const EMPTY_MESSAGE = '未收到完整的 AI 回复，会话已结束。请新开对话后再发送。';
const REQUEST_TIMEOUT_MS = 165_000;
const MAX_SESSION_MS = 600_000;

export function createDevRealRequestController(options: {
  enabled: boolean; transport: DevRealRequestTransport; createRequestId: () => string;
}): DevRealRequestController {
  const { enabled, transport, createRequestId } = options;
  const listeners = new Set<() => void>();
  let disposed = false, generation = 0;
  let active: { abort: AbortController; cancel: () => void } | null = null;
  let context: { id: string; afterRequestId: string; expiresAt: number; localExpiresAt: number } | null = null;
  let latestRequestId: string | null = null;
  let retryAnchor: string | null = null;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const initial = (): DevRealRequestSnapshot => Object.freeze({
    status: 'idle', inputText: '', requestId: null, sentAt: 0, reactionText: '', companionText: '', deepText: '',
    completedTurns: Object.freeze([]), error: null, canSend: enabled && !disposed, source: null, practiceCandidate: null, canRetry: false,
  });
  let snapshot = initial();
  function publish(next: DevRealRequestSnapshot) {
    snapshot = Object.freeze(next);
    listeners.forEach(listener => listener());
  }
  function invalidate() {
    generation += 1;
    const run = active; active = null;
    const requestIds = new Set([context?.afterRequestId, latestRequestId]);
    latestRequestId = null; retryAnchor = null; context = null;
    clearTimeout(expiry); expiry = undefined;
    // Revoke callbacks before abort because listeners can fire synchronously.
    run?.cancel(); run?.abort.abort();
    for (const requestId of requestIds) {
      if (!requestId) continue;
      try { void transport.end(requestId).catch(() => undefined); } catch { /* expiry remains the backstop */ }
    }
  }
  function end(status: 'failed' | 'stopped', error: string | null) {
    invalidate();
    publish({ ...initial(), status, error, canSend: false });
  }
  function recover(anchor: string, pending = false) {
    // Keep the original fixed expiry and completed turns. Revoke old callbacks
    // before aborting; no backend end and no automatic resubmission here.
    generation += 1;
    const run = active; active = null; retryAnchor = anchor;
    run?.cancel(); run?.abort.abort();
    publish({ ...snapshot, status: 'recoverable', preserveDraft: true, error: pending ? `${RETRY_MESSAGE}。上一次请求仍在处理中，本次点击没有启动新的回复请求。请稍后自行重试。` : RETRY_MESSAGE, canSend: false, canRetry: true,
      deepText: '', reactionText: '', companionText: '', source: null, practiceCandidate: null });
  }
  function unavailable(localExpiresAt: number) {
    generation += 1;
    const run = active; active = null; retryAnchor = null;
    run?.cancel(); run?.abort.abort();
    for (const id of new Set([context?.afterRequestId, latestRequestId])) {
      if (id) { try { void transport.end(id).catch(() => undefined); } catch { /* expiry is the backstop */ } }
    }
    // Cleanup was dispatched once. Keep only the read-only UI and its original
    // local deadline; later End/New/unmount must not resend retired anchors.
    latestRequestId = null; context = null;
    clearTimeout(expiry);
    expiry = setTimeout(() => { if (!disposed) end('failed', EXPIRED_MESSAGE); }, Math.max(0, localExpiresAt - Date.now()));
    publish({ ...snapshot, status: 'failed', preserveDraft: true, canRetry: false, canSend: false, practiceCandidate: null, source: null,
      deepText: '', error: '无法确认刚才的请求状态，暂不能重试。请新开对话后再自行发送。' });
  }
  const controller: DevRealRequestController = {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    send: text => attempt(text),
    retry: () => retryAnchor && snapshot.canRetry ? attempt(snapshot.inputText, retryAnchor) : Promise.resolve(false),
    stop: () => { if (!disposed && (latestRequestId || snapshot.requestId)) end('stopped', null); },
    reset: () => { if (!disposed) { invalidate(); publish(initial()); } },
    dispose: () => {
      if (disposed) return;
      disposed = true; invalidate();
      snapshot = Object.freeze({ ...initial(), status: 'stopped', canSend: false });
      listeners.clear();
    },
  };
  async function attempt(text: string, retryOfRequestId?: string): Promise<boolean> {
    if (disposed || !enabled || active || !(retryOfRequestId ? snapshot.canRetry : snapshot.canSend) || typeof text !== 'string' || !text.trim()) return false;
    if (context && Date.now() >= context.localExpiresAt) { end('failed', EXPIRED_MESSAGE); return false; }
    const message = text.trim();
    if (message.length > DEV_REAL_REQUEST_MAX_INPUT) {
      publish({ ...snapshot, error: '当前输入最多 1000 字符，请缩短后再发送。' }); return false;
    }
    let requestId: string;
    try {
      requestId = createRequestId();
      if (typeof requestId !== 'string' || !DEV_REAL_REQUEST_ID_PATTERN.test(requestId)) throw new Error('invalid_request_id');
    } catch {
      publish({ ...snapshot, error: '无法生成有效请求标识，请重新点击发送。' }); return false;
    }
    const sentAt = retryOfRequestId ? snapshot.sentAt : Date.now();
    const logicalRequestId = retryOfRequestId ? snapshot.logicalRequestId : requestId;
    const previous = snapshot.status === 'success' && snapshot.requestId
      ? [...snapshot.completedTurns, Object.freeze({ inputText: snapshot.inputText, requestId: snapshot.requestId, logicalRequestId: snapshot.logicalRequestId, sentAt: snapshot.sentAt,
        reactionText: snapshot.reactionText, companionText: snapshot.companionText, deepText: snapshot.deepText })].slice(-3)
      : snapshot.completedTurns;
    const continuation = !retryOfRequestId && context ? { devConversationId: context.id, afterRequestId: context.afterRequestId } : {};
    const priorExpiresAt = context?.expiresAt;
    // Receipt transit and start/auth waits count toward the disclosed local
    // maximum. Continuations can shorten this deadline, never restart it.
    const priorLocalExpiresAt = context?.localExpiresAt ?? sentAt + MAX_SESSION_MS;
    const runGeneration = ++generation;
    const abort = new AbortController();
    let completedText = '';
    let recoveryNegotiated = false, startAcknowledged = false;
    let terminalFailure = false;
    let cancel!: () => void;
    const cancelled = new Promise<boolean>(resolve => { cancel = () => { completedText = ''; resolve(false); }; });
    active = { abort, cancel }; latestRequestId = requestId;
    const isCurrent = () => !disposed && generation === runGeneration && !abort.signal.aborted;
    publish({ ...initial(), inputText: message, requestId, logicalRequestId, sentAt, completedTurns: Object.freeze(previous), status: 'starting', canSend: false });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const run = async (): Promise<boolean> => {
      try {
        if (!isCurrent()) return false;
        const start = await transport.start({ roleId: 'clever-fox', message, requestId, ...continuation, ...(retryOfRequestId ? { retryOfRequestId } : {}) }, abort.signal);
        if (!isCurrent()) return false;
        if (!start || typeof start.sessionId !== 'string' || !DEV_REAL_REQUEST_ID_PATTERN.test(start.sessionId)
          || typeof start.devConversationId !== 'string' || !DEV_REAL_REQUEST_ID_PATTERN.test(start.devConversationId)
          || !Number.isFinite(start.expiresAt) || !Number.isFinite(start.remainingLifetimeMs)
          || start.remainingLifetimeMs <= 0 || start.remainingLifetimeMs > MAX_SESSION_MS
          || (context && start.devConversationId !== context.id)
          || (priorExpiresAt !== undefined && start.expiresAt !== priorExpiresAt)) throw new Error('dev_request_expired_or_clock_skew');
        const localExpiresAt = Math.min(priorLocalExpiresAt, Date.now() + start.remainingLifetimeMs);
        if (Date.now() >= localExpiresAt) { end('failed', EXPIRED_MESSAGE); return false; }
        startAcknowledged = true;
        recoveryNegotiated = start.devRetryContract === 'dev-manual-retry-v1' && start.devReplyContract === 'dev-reply-practice-v1';
        retryAnchor = null;
        context = { id: start.devConversationId, afterRequestId: requestId, expiresAt: start.expiresAt, localExpiresAt };
        clearTimeout(expiry);
        expiry = setTimeout(() => { if (!disposed && context?.id === start.devConversationId) end('failed', EXPIRED_MESSAGE); }, Math.max(0, localExpiresAt - Date.now()));
        // Ignore legacy front-layer strings even when an older DEV server
        // sends them. A single complete answer replaces the thinking state.
        publish({ ...snapshot, status: 'streaming' });
        if (!isCurrent()) return false;
        let terminal = false, failed = false;
        let practiceCandidate: DevPracticeCandidate | null = null;
        await transport.stream(start.sessionId, {
          onDeepChunk: content => {
            if (!isCurrent() || terminal || typeof content !== 'string') return;
            // The server validates before emitting, but transport completion
            // is still required. Keep pending chunks out of UI and save state.
            completedText += content;
          },
          onDone: reply => {
            if (!isCurrent() || terminal) return;
            terminal = true;
            if (start.devReplyContract) {
              if (!reply || reply.contract !== start.devReplyContract || reply.reply !== completedText
                || !reply.source || reply.source.sessionId !== start.sessionId || reply.source.devConversationId !== start.devConversationId
                || reply.source.requestId !== requestId) { failed = true; terminalFailure = true; return; }
              if (reply.practiceCandidate) practiceCandidate = Object.freeze({ ...reply.practiceCandidate, source: Object.freeze({ ...reply.source }) });
            } else if (reply) { failed = true; terminalFailure = true; }
          },
          onError: reason => { if (isCurrent() && !terminal) { terminal = true; failed = true; terminalFailure = reason === undefined || reason === 'terminal'; } },
        }, abort.signal, { retryContract: start.devRetryContract, contract: start.devReplyContract, devConversationId: start.devConversationId, requestId });
        if (!isCurrent()) return false;
        if (Date.now() >= localExpiresAt) { end('failed', EXPIRED_MESSAGE); return false; }
        const success = terminal && !failed && !!completedText.trim();
        if (!success) {
          if (recoveryNegotiated && !terminalFailure) recover(requestId);
          else end('failed', failed ? FAILED_MESSAGE : EMPTY_MESSAGE);
          return false;
        }
        active = null;
        publish({ ...snapshot, deepText: completedText, practiceCandidate, source: 'backend-deep', status: 'success', error: null, canSend: true });
        return true;
      } catch (error) {
        const expired = !!error && typeof error === 'object' && 'message' in error && error.message === 'dev_request_expired_or_clock_skew';
        if (isCurrent()) {
          if (!startAcknowledged && retryOfRequestId && error && typeof error === 'object' && 'code' in error && error.code === 'dev_retry_pending') {
            // 409 pending did not admit this attempt: keep the acknowledged anchor.
            latestRequestId = retryOfRequestId;
            recover(retryOfRequestId, true);
          } else if (recoveryNegotiated && !terminalFailure && !expired) recover(requestId);
          else if (error && typeof error === 'object' && 'code' in error && error.code === 'dev_start_unconfirmed') unavailable(priorLocalExpiresAt);
          else end('failed', expired ? EXPIRED_MESSAGE : FAILED_MESSAGE);
        }
        return false;
      }
    };
    const deadline = new Promise<boolean>(resolve => {
      timeout = setTimeout(() => {
        if (isCurrent()) {
          if (recoveryNegotiated && !terminalFailure) recover(requestId);
          else if (!startAcknowledged) unavailable(priorLocalExpiresAt);
          else end('failed', FAILED_MESSAGE);
        }
        resolve(false);
      }, REQUEST_TIMEOUT_MS);
    });
    try { return await Promise.race([run(), cancelled, deadline]); }
    finally {
      completedText = '';
      clearTimeout(timeout);
      if (generation === runGeneration) { active = null; generation += 1; }
    }
  }
  return controller;
}
