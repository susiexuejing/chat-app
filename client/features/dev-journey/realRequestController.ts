/** A single explicit DEV turn. This module has no network, storage or React imports. */
export type DevRealRequestStatus = 'idle' | 'starting' | 'streaming' | 'success' | 'failed' | 'stopped';

export interface DevRealRequestSnapshot {
  readonly status: DevRealRequestStatus;
  readonly inputText: string;
  readonly requestId: string | null;
  readonly reactionText: string;
  readonly companionText: string;
  readonly deepText: string;
  readonly error: string | null;
  readonly canSend: boolean;
  /** Only records observed backend Deep output, not a proven provider/model. */
  readonly source: 'backend-deep' | null;
}

export interface DevRealRequestInput {
  roleId: 'clever-fox';
  message: string;
  requestId: string;
}

export interface DevRealRequestStart {
  sessionId: string;
  reactionText: string;
  companionText: string;
}

export interface DevRealRequestCallbacks {
  onDeepChunk: (text: string) => void;
  /** Must mean a successful terminal event, not merely a closed connection. */
  onDone: () => void;
  onError: () => void;
}

export interface DevRealRequestTransport {
  start: (input: DevRealRequestInput, signal: AbortSignal) => Promise<DevRealRequestStart>;
  stream: (sessionId: string, callbacks: DevRealRequestCallbacks, signal: AbortSignal) => Promise<void>;
}

export interface DevRealRequestController {
  getSnapshot: () => DevRealRequestSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** True only for a completed, nonempty Deep reply. Refused/stopped/failed sends return false. */
  send: (text: string) => Promise<boolean>;
  stop: () => void;
  /** Only an explicit new-chat action should call reset. It never sends a request. */
  reset: () => void;
  dispose: () => void;
}

export const DEV_REAL_REQUEST_NOTICE = '真实请求会产生 API 费用；仅发送当前输入。服务端可能保存分析或匿名会话数据。';
export const DEV_REAL_REQUEST_STOP_NOTICE = '停止会中止本地等待与连接，但不能保证已被服务端接受的工作或计费停止。';
export const DEV_REAL_REQUEST_SOURCE_NOTICE = '仅确认收到后端 Deep 内容；实际供应商、模型与费用未验证。';
export const DEV_REAL_REQUEST_MAX_INPUT = 1000;
export const DEV_REAL_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

const FAILED_MESSAGE = '本次真实请求未完成，请新开对话后再显式发送。';
const EMPTY_MESSAGE = '未收到完整的 Deep 回复，前层内容不代表真实 API 成功。';
// Includes identity/start time. Matches the live stream guard without adding retries.
const REQUEST_TIMEOUT_MS = 165_000;

export function createDevRealRequestController(options: {
  enabled: boolean;
  transport: DevRealRequestTransport;
  createRequestId: () => string;
}): DevRealRequestController {
  const { enabled, transport, createRequestId } = options;
  const listeners = new Set<() => void>();
  let disposed = false;
  let generation = 0;
  let active: { abort: AbortController; cancel: () => void } | null = null;
  const initial = (): DevRealRequestSnapshot => Object.freeze({
    status: 'idle', inputText: '', requestId: null,
    reactionText: '', companionText: '', deepText: '', error: null,
    canSend: enabled && !disposed, source: null,
  });
  let snapshot = initial();

  function publish(next: DevRealRequestSnapshot) {
    snapshot = Object.freeze(next);
    listeners.forEach(listener => listener());
  }

  function invalidate() {
    generation += 1;
    const run = active;
    active = null;
    // Revoke authority before abort: abort listeners may fire synchronously.
    run?.cancel();
    run?.abort.abort();
  }

  const controller: DevRealRequestController = {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    send: async text => {
      if (disposed || !enabled || !snapshot.canSend || typeof text !== 'string' || !text.trim()) return false;
      const message = text.trim();
      if (message.length > DEV_REAL_REQUEST_MAX_INPUT) {
        publish({ ...snapshot, error: '当前输入最多 1000 字，请缩短后再发送。' });
        return false;
      }
      let requestId: string;
      try {
        requestId = createRequestId();
        if (typeof requestId !== 'string' || !DEV_REAL_REQUEST_ID_PATTERN.test(requestId)) throw new Error('invalid_request_id');
      } catch {
        publish({ ...snapshot, error: '无法生成有效请求标识，请重新点击发送。' });
        return false;
      }
      const runGeneration = ++generation;
      const abort = new AbortController();
      let cancel!: () => void;
      const cancelled = new Promise<boolean>(resolve => { cancel = () => resolve(false); });
      active = { abort, cancel };
      const isCurrent = () => !disposed && generation === runGeneration && !abort.signal.aborted;
      // Consume a valid turn synchronously, before auth/transport can yield.
      publish({ ...initial(), inputText: message, requestId, status: 'starting', canSend: false });
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const run = async (): Promise<boolean> => {
        try {
          if (!isCurrent()) return false;
          const start = await transport.start({ roleId: 'clever-fox', message, requestId }, abort.signal);
          if (!isCurrent()) return false;
          if (!start || typeof start.sessionId !== 'string' || !start.sessionId.trim()) throw new Error('invalid_session');
          publish({
            ...snapshot, status: 'streaming',
            reactionText: typeof start.reactionText === 'string' ? start.reactionText : '',
            companionText: typeof start.companionText === 'string' ? start.companionText : '',
          });
          // A subscriber may stop/reset while observing the transition.
          if (!isCurrent()) return false;
          let terminal = false;
          let failed = false;
          await transport.stream(start.sessionId, {
            onDeepChunk: content => {
              if (!isCurrent() || terminal || typeof content !== 'string') return;
              publish({ ...snapshot, deepText: snapshot.deepText + content,
                source: (snapshot.deepText + content).trim() ? 'backend-deep' : null });
            },
            onDone: () => { if (isCurrent()) terminal = true; },
            onError: () => { if (isCurrent()) { terminal = true; failed = true; } },
          }, abort.signal);
          if (!isCurrent()) return false;
          const success = terminal && !failed && !!snapshot.deepText.trim();
          publish({ ...snapshot, status: success ? 'success' : 'failed',
            error: success ? null : failed ? FAILED_MESSAGE : EMPTY_MESSAGE });
          return success;
        } catch {
          if (isCurrent()) publish({ ...snapshot, status: 'failed', error: FAILED_MESSAGE });
          return false;
        }
      };

      const deadline = new Promise<boolean>(resolve => {
        timeout = setTimeout(() => {
          if (isCurrent()) {
            invalidate();
            publish({ ...snapshot, status: 'failed', error: FAILED_MESSAGE });
          }
          resolve(false);
        }, REQUEST_TIMEOUT_MS);
      });
      try {
        return await Promise.race([run(), cancelled, deadline]);
      } finally {
        clearTimeout(timeout);
        if (generation === runGeneration) {
          active = null;
          // Discard callbacks after terminal completion, even from a faulty transport.
          generation += 1;
        }
      }
    },
    stop: () => {
      if (disposed || !active) return;
      invalidate();
      publish({ ...snapshot, status: 'stopped', canSend: false, error: null });
    },
    reset: () => {
      if (disposed) return;
      invalidate();
      publish(initial());
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      invalidate();
      snapshot = Object.freeze({ ...snapshot, canSend: false,
        status: snapshot.status === 'starting' || snapshot.status === 'streaming' ? 'stopped' : snapshot.status });
      listeners.clear();
    },
  };
  return controller;
}
