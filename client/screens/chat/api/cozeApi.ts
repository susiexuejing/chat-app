/**
 * 百炼 API 客户端（通过后端代理）
 * 
 * 后端直接调用百炼 API，前端通过 SSE 流式获取响应
 * 自动适配 Web 和 React Native 环境
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {
  emitEf77Trace,
  getEf77ErrorType,
  isEf77DiagnosticEnabled,
} from '../utils/ef77Diagnostics';

export interface RetryTransportDiagnostics {
  isRetry: boolean;
  startedAt: number;
  firstEventObserved: boolean;
  firstContentChunkObserved: boolean;
  eventCount: number;
  contentChunkCount: number;
  doneObserved: boolean;
  streamSettled: boolean;
}

export function createRetryTransportDiagnostics(isRetry: boolean): RetryTransportDiagnostics {
  return {
    isRetry,
    startedAt: Date.now(),
    firstEventObserved: false,
    firstContentChunkObserved: false,
    eventCount: 0,
    contentChunkCount: 0,
    doneObserved: false,
    streamSettled: false,
  };
}

// 获取后端地址 - 尝试多个可能的地址
function getBackendUrl(): string {
  // 1. 优先使用环境变量
  if (Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_BASE_URL) {
    return Constants.expoConfig.extra.EXPO_PUBLIC_BACKEND_BASE_URL;
  }
  // 2. 尝试从 window.location 获取当前域名
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    // 如果是已知域名，直接使用
    const knownDomains = ['chat.douhaoyu.cn', 'dev.douhaoyu.cn', '8.145.45.174', 'localhost'];
    if (knownDomains.includes(hostname)) {
      return `${protocol}//${hostname}`;
    }
  }
  // 3. 默认 localhost
  return 'http://localhost:9091';
}

const BACKEND_BASE_URL = getBackendUrl();
const STREAM_API_URL = BACKEND_BASE_URL 
  ? `${BACKEND_BASE_URL}/api/v1/chat/stream` 
  : '/api/v1/chat/stream';

const STREAM_SCHEMA_VERSION = 1 as const;
const KNOWN_STREAM_EVENT_TYPES = [
  'turn.started',
  'reaction',
  'companion',
  'deep.delta',
  'deep.completed',
  'turn.completed',
  'error',
] as const;

type KnownStreamEventType = (typeof KNOWN_STREAM_EVENT_TYPES)[number];
type StreamRecord = Record<string, unknown>;

export type VersionedStreamParseResult =
  | { kind: 'known'; eventType: KnownStreamEventType; sequence: number; serialized: string; terminal: boolean }
  | { kind: 'ignored-compatible'; sequence: number }
  | { kind: 'rejected'; error: Error };

function isRecord(value: unknown): value is StreamRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isNaN(Date.parse(value)) === false;
}

function isPositiveSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function hasExactKeys(value: StreamRecord, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every(key => keys.includes(key));
}

function rejectStreamEvent(message: string): VersionedStreamParseResult {
  return { kind: 'rejected', error: new Error(`Unsupported stream event: ${message}`) };
}

function normalizeKnownStreamEvent(
  eventType: KnownStreamEventType,
  envelope: StreamRecord,
  payload: StreamRecord,
): StreamRecord | null {
  const base = {
    schemaVersion: STREAM_SCHEMA_VERSION,
    eventType,
    sequence: envelope.sequence,
    timestamp: envelope.timestamp,
    payload,
  };

  switch (eventType) {
    case 'turn.started': {
      const flowContext = payload.flowContext;
      const flowContextValid = flowContext === null || (isRecord(flowContext)
        && hasExactKeys(flowContext, ['flowType', 'flowStage', 'flowStrength', 'flowConfidence', 'flowRisk'])
        && typeof flowContext.flowType === 'string'
        && typeof flowContext.flowStage === 'string'
        && typeof flowContext.flowStrength === 'number'
        && typeof flowContext.flowConfidence === 'number'
        && (typeof flowContext.flowRisk === 'string' || flowContext.flowRisk === null));
      if (typeof payload.sessionId !== 'string' || payload.sessionId.length === 0
        || !hasExactKeys(payload, ['sessionId', 'deepReadyAt', 'reactionLayer', 'companionLayer', 'flowContext'])
        || !isNonnegativeInteger(payload.deepReadyAt)
        || typeof payload.reactionLayer !== 'string'
        || typeof payload.companionLayer !== 'string'
        || !flowContextValid) return null;
      return { ...base, type: 'timeline', deepReadyAt: payload.deepReadyAt,
        reactionLayer: payload.reactionLayer, companionLayer: payload.companionLayer, flowContext };
    }
    case 'reaction':
      return hasExactKeys(payload, ['content']) && typeof payload.content === 'string'
        ? { ...base, type: 'reaction' } : null;
    case 'companion':
      return hasExactKeys(payload, ['content']) && typeof payload.content === 'string'
        ? { ...base, type: 'companion' } : null;
    case 'deep.delta':
      return hasExactKeys(payload, ['content']) && typeof payload.content === 'string' && payload.content.length > 0
        ? { ...base, type: 'deep', content: payload.content } : null;
    case 'deep.completed':
      return Object.keys(payload).length === 0 ? { ...base, type: 'deep', done: true } : null;
    case 'turn.completed':
      return payload.status === 'completed' && Object.keys(payload).length === 1
        ? { ...base, type: 'turn.completed' } : null;
    case 'error':
      return (payload.code === 'DEEP_RESPONSE_FAILED' || payload.code === 'STREAM_TIMEOUT')
        && typeof payload.message === 'string' && payload.message.length > 0
        && typeof payload.recoverable === 'boolean'
        && (payload.recoveryAction === 'retry_turn' || payload.recoveryAction === 'restart_turn')
        && Object.keys(payload).length === 4
        ? { ...base, type: 'error', ...payload, done: true } : null;
  }
}

/**
 * Client-owned projection of the approved EF-102 v1 envelope. This function
 * never forwards unvalidated raw fields to the chat dispatcher.
 */
export function parseVersionedStreamEvent(data: string): VersionedStreamParseResult {
  let envelope: unknown;
  try {
    envelope = JSON.parse(data);
  } catch {
    return rejectStreamEvent('invalid JSON');
  }
  if (!isRecord(envelope)) return rejectStreamEvent('envelope must be an object');
  if (envelope.schemaVersion !== STREAM_SCHEMA_VERSION) return rejectStreamEvent('unsupported schema version');
  if (!isPositiveSequence(envelope.sequence) || !isIsoTimestamp(envelope.timestamp)) {
    return rejectStreamEvent('invalid envelope metadata');
  }
  if (typeof envelope.eventType !== 'string' || !isRecord(envelope.payload)) {
    return rejectStreamEvent('missing event type or payload');
  }
  if (!(KNOWN_STREAM_EVENT_TYPES as readonly string[]).includes(envelope.eventType)) {
    return { kind: 'ignored-compatible', sequence: envelope.sequence };
  }

  const eventType = envelope.eventType as KnownStreamEventType;
  const normalized = normalizeKnownStreamEvent(eventType, envelope, envelope.payload);
  if (!normalized) return rejectStreamEvent(`malformed ${eventType} payload`);
  return {
    kind: 'known',
    eventType,
    sequence: envelope.sequence,
    serialized: JSON.stringify(normalized),
    terminal: eventType === 'turn.completed' || eventType === 'error',
  };
}

export function createStreamSequenceValidator(): (sequence: number) => Error | null {
  let previousSequence = 0;
  return (sequence: number) => {
    if (sequence <= previousSequence) {
      return new Error('Unsupported stream event: non-increasing sequence');
    }
    previousSequence = sequence;
    return null;
  };
}

// 组合分析接口（轻量 + 深度）
const COMBINED_API_URL = BACKEND_BASE_URL 
  ? `${BACKEND_BASE_URL}/api/v1/chat/combined` 
  : '/api/v1/chat/combined';

// Light 流式接口
const LIGHT_STREAM_API_URL = BACKEND_BASE_URL
  ? `${BACKEND_BASE_URL}/api/v1/chat/light/stream`
  : '/api/v1/chat/light/stream';

// Deep 流式接口
const DEEP_STREAM_API_URL = BACKEND_BASE_URL
  ? `${BACKEND_BASE_URL}/api/v1/chat/deep/stream`
  : '/api/v1/chat/deep/stream';

export interface ChatRequest {
  role: string;
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;
}

// 动态导入 react-native-sse（仅在原生环境使用）
let RNSSE: any = null;
if (Platform.OS !== 'web') {
  try {
    RNSSE = require('react-native-sse').default;
  } catch (e) {
    console.warn('react-native-sse not available');
  }
}

/**
 * 通过后端调用百炼 API（流式）
 */
export async function chatWithDashScope(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  roleName: string,
  onChunk?: (text: string) => void,
  onThinkingChunk?: (text: string) => void,
): Promise<void> {
  if (Platform.OS === 'web') {
    await chatWeb(systemPrompt, messages, roleName, onChunk, onThinkingChunk);
  } else {
    await chatNative(systemPrompt, messages, roleName, onChunk, onThinkingChunk);
  }
}

/**
 * Web 环境实现：使用 fetch + ReadableStream
 */
async function chatWeb(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  roleName: string,
  onChunk?: (text: string) => void,
  onThinkingChunk?: (text: string) => void,
): Promise<void> {
  try {
    const response = await fetch(STREAM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: roleName,
        systemPrompt,
        messages,
        model: 'qwen3.6-plus',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            return;
          }
          try {
            const parsed = JSON.parse(data);
            // 处理回复内容
            if (parsed.type === 'content' && parsed.content) {
              onChunk?.(parsed.content);
            }
            // 处理思考内容（可选）
            if (parsed.type === 'thinking' && parsed.content && onThinkingChunk) {
              onThinkingChunk(parsed.content);
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }
  } catch (error) {
    console.error('Web chat error:', error);
    throw error;
  }
}

/**
 * React Native 环境实现：使用 react-native-sse
 */
async function chatNative(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  roleName: string,
  onChunk?: (text: string) => void,
  onThinkingChunk?: (text: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!RNSSE) {
      reject(new Error('react-native-sse not available'));
      return;
    }

    const sse = new RNSSE(STREAM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: roleName,
        systemPrompt,
        messages,
        model: 'qwen3.6-plus',
      }),
    });

    const timeout = setTimeout(() => {
      sse.close();
      reject(new Error('Request timeout'));
    }, 120000); // 2分钟超时

    sse.addEventListener('message', (event: any) => {
      if (event.data === '[DONE]') {
        clearTimeout(timeout);
        sse.close();
        resolve();
        return;
      }

      try {
        const parsed = JSON.parse(event.data);
        // 处理回复内容
        if (parsed.type === 'content' && parsed.content) {
          onChunk?.(parsed.content);
        }
        // 处理思考内容（可选）
        if (parsed.type === 'thinking' && parsed.content && onThinkingChunk) {
          onThinkingChunk(parsed.content);
        }
      } catch (e) {
        // 忽略解析错误
      }
    });

    sse.addEventListener('error', (error: any) => {
      clearTimeout(timeout);
      sse.close();
      reject(new Error(error.message || 'SSE connection error'));
    });

    sse.addEventListener('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

// ─── 新架构：前端流 + 百炼深度分析 ─────────────────────────

export interface FrontFlowItem {
  delay: number;  // 秒
  text: string;
}

export interface FlowContext {
  flowType: string | null;
  flowStage: string | null;
  flowStrength: number | null;
  flowConfidence: number | null;
  flowRisk: string | null;
}

export interface ChatStartResponse {
  sessionId: string;
  emotionTag: string;
  eventKeyword: string;
  frontFlowText: string;
  flowContext: FlowContext;
  reactionLayer?: string;    // EmotionFlow V3 人格反应层（单句版，向后兼容）
  companionLayer?: string;   // EmotionFlow V3 人格陪伴层（单句版，向后兼容）
  deepReadyAt?: number;      // Deep层就绪时间戳
  reactionTimeline?: Array<{displayAt: number; text: string}>;  // V3.1 多段时间线: Reaction
  companionTimeline?: Array<{displayAt: number; text: string}>; // V3.1 多段时间线: Companion
}

/**
 * 接口 1：即时返回前端流
 * POST /api/v1/chat/start
 */
export async function chatStart(
  roleId: string,
  message: string,
  conversationId?: string,
  requestId?: string,
  diagnostics?: RetryTransportDiagnostics,
  userId?: string,
): Promise<ChatStartResponse> {
  const BASE = getBackendUrl();
  const startedAt = Date.now();
  emitEf77Trace('chat_start_started', { timestamp: startedAt, isRetry: diagnostics?.isRetry ?? false });
  let httpStatus: number | null = null;
  try {
    const response = await fetch(`${BASE}/api/v1/chat/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleId, message, userId, conversationId, requestId }),
    });
    httpStatus = response.status;
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`chatStart failed (${response.status}): ${text}`);
    }
    const result: ChatStartResponse = await response.json();
    emitEf77Trace('chat_start_completed', {
      timestamp: Date.now(),
      durationMs: Date.now() - startedAt,
      httpStatus,
      backendSessionIdPresent: !!result.sessionId,
      isRetry: diagnostics?.isRetry ?? false,
    });
    return result;
  } catch (error) {
    emitEf77Trace('chat_start_failed', {
      timestamp: Date.now(),
      durationMs: Date.now() - startedAt,
      httpStatus,
      errorType: getEf77ErrorType(error),
      isRetry: diagnostics?.isRetry ?? false,
    });
    throw error;
  }
}

/**
 * 接口 2：获取百炼流式结果
 * GET /api/v1/chat/stream?sessionId=xxx
 * 
 * @param sessionId - chatStart 返回的 sessionId
 * @param onChunk - 每段文本回调
 * @param onDone - 流结束回调
 */
export function chatStream(
  sessionId: string,
  callbacks: {
    onChunk?: (text: string) => void;
    onDone?: () => void;
    onError?: (err: Error) => void;
  },
  diagnostics?: RetryTransportDiagnostics,
  signal?: AbortSignal,
  identity?: { userId: string; conversationId: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const BASE = getBackendUrl();
    const url = `${BASE}/api/v1/chat/stream?sessionId=${encodeURIComponent(sessionId)}`;
    const identityHeaders = identity ? {
      'X-EmotionFlow-User-Id': identity.userId,
      'X-EmotionFlow-Conversation-Id': identity.conversationId,
    } : undefined;
    const requestStartedAt = Date.now();
    const validateSequence = createStreamSequenceValidator();
    emitEf77Trace('stream_request_started', {
      timestamp: requestStartedAt,
      isRetry: diagnostics?.isRetry ?? false,
      backendSessionIdPresent: !!sessionId,
    });

    const observeProgress = (data: string) => {
      if (!diagnostics || !isEf77DiagnosticEnabled()) return;
      diagnostics.eventCount += 1;
      const firstEvent = !diagnostics.firstEventObserved;
      diagnostics.firstEventObserved = true;
      let contentObserved = false;
      try {
        const parsed: unknown = JSON.parse(data);
        contentObserved = !!parsed && typeof parsed === 'object'
          && typeof (parsed as { content?: unknown }).content === 'string'
          && (parsed as { content: string }).content.length > 0;
      } catch {
        // Diagnostic classification never changes the existing SSE parser path.
      }
      if (contentObserved) diagnostics.contentChunkCount += 1;
      const firstContent = contentObserved && !diagnostics.firstContentChunkObserved;
      if (firstContent) diagnostics.firstContentChunkObserved = true;
      if (firstEvent || firstContent) {
        emitEf77Trace('stream_progress', {
          timestamp: Date.now(),
          firstEventObserved: diagnostics.firstEventObserved,
          firstContentChunkObserved: diagnostics.firstContentChunkObserved,
          eventCount: diagnostics.eventCount,
          contentChunkCount: diagnostics.contentChunkCount,
          isRetry: diagnostics.isRetry,
        });
      }
    };

    const observeTerminal = (terminal: {
      doneObserved: boolean;
      eofObserved: boolean;
      resolved: boolean;
      rejected: boolean;
      error?: unknown;
    }) => {
      if (!diagnostics || diagnostics.streamSettled || !isEf77DiagnosticEnabled()) return;
      diagnostics.doneObserved = terminal.doneObserved;
      diagnostics.streamSettled = terminal.resolved || terminal.rejected;
      emitEf77Trace('stream_progress', {
        timestamp: Date.now(),
        firstEventObserved: diagnostics.firstEventObserved,
        firstContentChunkObserved: diagnostics.firstContentChunkObserved,
        eventCount: diagnostics.eventCount,
        contentChunkCount: diagnostics.contentChunkCount,
        isRetry: diagnostics.isRetry,
      });
      emitEf77Trace('stream_terminal_observed', {
        timestamp: Date.now(),
        doneObserved: terminal.doneObserved,
        eofObserved: terminal.eofObserved,
        resolved: terminal.resolved,
        rejected: terminal.rejected,
        eventCount: diagnostics.eventCount,
        contentChunkCount: diagnostics.contentChunkCount,
        errorType: terminal.error === undefined ? null : getEf77ErrorType(terminal.error),
        isRetry: diagnostics.isRetry,
      });
    };

    // Web 端和 RN 端统一使用 fetch SSE
    if (Platform.OS === 'web') {
      fetch(url, { signal, headers: identityHeaders })
        .then(async (response) => {
          emitEf77Trace('stream_response_observed', {
            timestamp: Date.now(),
            durationMs: Date.now() - requestStartedAt,
            httpStatus: response.status,
            responseOk: response.ok,
            readerPresent: !!response.body,
            isRetry: diagnostics?.isRetry ?? false,
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('No reader available');
          }
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;
              const data = trimmed.slice(6);
              if (data === '[DONE]') {
                if (diagnostics) diagnostics.doneObserved = true;
                callbacks.onDone?.();
                observeTerminal({ doneObserved: true, eofObserved: false, resolved: true, rejected: false });
                resolve();
                return;
              }
              const parsed = parseVersionedStreamEvent(data);
              if (parsed.kind === 'rejected') throw parsed.error;
              const sequenceError = validateSequence(parsed.sequence);
              if (sequenceError) throw sequenceError;
              if (parsed.kind === 'ignored-compatible') continue;
              observeProgress(parsed.serialized);
              callbacks.onChunk?.(parsed.serialized);
              if (parsed.terminal) {
                if (diagnostics) diagnostics.doneObserved = true;
                void reader.cancel().catch(() => undefined);
                callbacks.onDone?.();
                observeTerminal({ doneObserved: true, eofObserved: false, resolved: true, rejected: false });
                resolve();
                return;
              }
            }
          }
          callbacks.onDone?.();
          observeTerminal({ doneObserved: false, eofObserved: true, resolved: true, rejected: false });
          resolve();
        })
        .catch((err) => {
          callbacks.onError?.(err);
          observeTerminal({ doneObserved: diagnostics?.doneObserved ?? false, eofObserved: false, resolved: false, rejected: true, error: err });
          reject(err);
        });
    } else {
      // RN 端使用 react-native-sse
      import('react-native-sse').then((mod) => {
        const RNSSE = mod.default;
        const sse = new RNSSE(url, {
          headers: {
            'Accept': 'text/event-stream',
            ...identityHeaders,
          },
        });
        let versionedTerminalObserved = false;
        let settled = false;
        const settleResolved = (eofObserved: boolean) => {
          if (settled) return;
          settled = true;
          callbacks.onDone?.();
          observeTerminal({
            doneObserved: diagnostics?.doneObserved ?? versionedTerminalObserved,
            eofObserved,
            resolved: true,
            rejected: false,
          });
          resolve();
        };
        const settleRejected = (error: Error) => {
          if (settled) return;
          settled = true;
          callbacks.onError?.(error);
          observeTerminal({
            doneObserved: diagnostics?.doneObserved ?? false,
            eofObserved: false,
            resolved: false,
            rejected: true,
            error,
          });
          reject(error);
        };
        signal?.addEventListener('abort', () => sse.close(), { once: true });
        sse.addEventListener('message', (event: any) => {
          if (settled) return;
          if (event.data === '[DONE]') {
            if (diagnostics) diagnostics.doneObserved = true;
            sse.close();
            return;
          }
          const parsed = parseVersionedStreamEvent(event.data);
          if (parsed.kind === 'rejected') {
            settleRejected(parsed.error);
            sse.close();
            return;
          }
          const sequenceError = validateSequence(parsed.sequence);
          if (sequenceError) {
            settleRejected(sequenceError);
            sse.close();
            return;
          }
          if (parsed.kind === 'ignored-compatible') return;
          observeProgress(parsed.serialized);
          callbacks.onChunk?.(parsed.serialized);
          if (parsed.terminal) {
            versionedTerminalObserved = true;
            if (diagnostics) diagnostics.doneObserved = true;
            sse.close();
          }
        });
        sse.addEventListener('error', (error: any) => {
          const err = new Error(error.message || 'stream error');
          settleRejected(err);
          sse.close();
        });
        sse.addEventListener('close', () => {
          settleResolved(!versionedTerminalObserved);
        });
      });
    }
  });
}

/**
 * 新版：一次调用，只发选中角色，返回结构化 JSON（reply + light_analysis + deep_analysis + next_step）
 * 服务端文件：server/src/index.ts
 * 接口：POST /api/v1/chat/analyze
 * Body 参数：userMessage: string, targetRole: string
 * 响应：SSE 流式，累加后解析 JSON
 */
export async function chatAnalyze(
  userMessage: string,
  targetRole: string,
  callbacks: {
    onLightChunk?: (chunk: string) => void;
    onDeepChunk?: (chunk: string) => void;
    onComplete?: (result: { reply: string; light_analysis?: any; deep_analysis?: any; next_step?: string }) => void;
    onError?: (error: Error) => void;
  }
): Promise<void> {
  const url = `${process.env.EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/chat/analyze`;

  return new Promise((resolve, reject) => {
    const sse = new RNSSE(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userMessage,
        targetRole,
      }),
      timeoutBeforeConnection: 10000, // 10s 连接超时
      timeout: 30000,                // 30s 响应超时
    });

    let accumulatedContent = '';

    sse.addEventListener('message', (event: any) => {
      if (event.data === '[DONE]') {
        // 流结束，尝试解析完整 JSON
        try {
          const result = JSON.parse(accumulatedContent);
          callbacks.onComplete?.(result);
        } catch (e) {
          console.error('解析分析结果失败:', e, accumulatedContent);
        }
        sse.close();
        resolve();
        return;
      }

      accumulatedContent += event.data;

      // 尝试增量解析 key 以提供实时反馈
      // 如果包含 "reply" 字段，可以渐进显示
      try {
        const partial = JSON.parse(accumulatedContent);
        if (partial.reply) {
          callbacks.onLightChunk?.(partial.reply);
        }
        if (partial.deep_analysis) {
          callbacks.onDeepChunk?.(JSON.stringify(partial.deep_analysis, null, 2));
        }
      } catch {
        // JSON 还未完整，暂时忽略
      }
    });

    sse.addEventListener('error', (error: any) => {
      sse.close();
      let errorMsg = '分析请求失败';
      if (error?.type === 'timeout') {
        errorMsg = '请求超时，模型响应较慢，请重试';
      } else if (error?.message) {
        errorMsg = error.message;
      }
      callbacks.onError?.(new Error(errorMsg));
      reject(new Error(errorMsg));
    });

    sse.addEventListener('close', () => {
      resolve();
    });
  });
}

/**
 * 非流式版本（备用）
 */
export async function chatWithDashScopeSync(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  roleName: string,
): Promise<string> {
  const response = await fetch(`${STREAM_API_URL.replace('/stream', '')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      role: roleName,
      systemPrompt,
      messages,
      model: 'qwen3.6-plus',
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.content || data.response || '';
}

// 深度分析结果类型
export interface DeepAnalysis {
  [roleName: string]: {
    analysis: string;
    insight: string;
  };
}

/**
 * 组合分析接口（轻量 + 深度）
 * Web 环境实现
 */
export async function chatCombined(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onLightChunk?: (text: string) => void,
  onDeepChunk?: (text: string) => void,
  onDeepAnalysis?: (analysis: DeepAnalysis) => void,
  targetRole?: string, // 指定角色，只返回该角色的深度分析
): Promise<void> {
  if (Platform.OS === 'web') {
    await chatCombinedWeb(messages, onLightChunk, onDeepChunk, onDeepAnalysis, targetRole);
  } else {
    await chatCombinedNative(messages, onLightChunk, onDeepChunk, onDeepAnalysis);
  }
}

async function chatCombinedWeb(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onLightChunk?: (text: string) => void,
  onDeepChunk?: (text: string) => void,
  onDeepAnalysis?: (analysis: DeepAnalysis) => void,
  targetRole?: string, // 指定角色，只返回该角色的深度分析
): Promise<void> {
  try {
    // 获取最后一条用户消息用于深度分析
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    const requestBody: Record<string, unknown> = {
      messages,
      userMessage: lastUserMessage,
    };
    
    // 如果指定了角色，只分析该角色
    if (targetRole) {
      requestBody.targetRole = targetRole;
    }

    // 并行调用 Light 流式接口和 Deep 流式接口
    const lightPromise = fetch(LIGHT_STREAM_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, ...(targetRole && { targetRole }) }),
    });

    const deepPromise = fetch(DEEP_STREAM_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        userMessage: lastUserMessage,
        ...(targetRole && { targetRole }),
      }),
    });

    // 并行处理 Light 和 Deep 流式响应
    let lightComplete = false;
    let deepComplete = false;
    let deepFullContent = '';
    let deepAnalysisData: DeepAnalysis | null = null;

    // 处理 Light 流式响应
    const processLightResponse = async () => {
      const lightResponse = await lightPromise;
      if (!lightResponse.ok) {
        throw new Error(`Light API error: ${lightResponse.status}`);
      }

      const lightReader = lightResponse.body?.getReader();
      if (lightReader) {
        const decoder = new TextDecoder();
        let buffer = '';

        while (!lightComplete) {
          const { done, value } = await lightReader.read();
          if (done) {
            lightComplete = true;
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                lightComplete = true;
                break;
              }
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'light' && parsed.content) {
                  onLightChunk?.(parsed.content);
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        }
      }
    };

    // 处理 Deep 流式响应
    const processDeepResponse = async () => {
      const deepResponse = await deepPromise;
      if (!deepResponse.ok) {
        const errorData = await deepResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `Deep API error: ${deepResponse.status}`);
      }

      const deepReader = deepResponse.body?.getReader();
      if (deepReader) {
        const decoder = new TextDecoder();
        let buffer = '';

        while (!deepComplete) {
          const { done, value } = await deepReader.read();
          if (done) {
            deepComplete = true;
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                deepComplete = true;
                break;
              }
              try {
                const parsed = JSON.parse(data);
                // Deep 流式内容
                if (parsed.type === 'deep' && parsed.content) {
                  onDeepChunk?.(parsed.content);
                  deepFullContent += parsed.content;
                }
                // Deep 分析完整结果
                if (parsed.type === 'deep' && parsed.analysis) {
                  deepAnalysisData = parsed.analysis;
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        }
      }
    };

    // 并行执行 Light 和 Deep 处理
    await Promise.all([processLightResponse(), processDeepResponse()]);

    // Deep 分析完成后回调
    if (deepAnalysisData) {
      onDeepAnalysis?.(deepAnalysisData);
    }
  } catch (error) {
    console.error('Combined chat error:', error);
    throw error;
  }
}

async function chatCombinedNative(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onLightChunk?: (text: string) => void,
  onDeepChunk?: (text: string) => void,
  onDeepAnalysis?: (analysis: DeepAnalysis) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!RNSSE) {
      reject(new Error('react-native-sse not available'));
      return;
    }

    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    const sse = new RNSSE(COMBINED_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        userMessage: lastUserMessage,
      }),
    });

    const timeout = setTimeout(() => {
      sse.close();
      reject(new Error('Request timeout'));
    }, 180000); // 3分钟超时（深度分析需要更长时间）

    sse.addEventListener('message', (event: any) => {
      if (event.data === '[DONE]') {
        clearTimeout(timeout);
        sse.close();
        resolve();
        return;
      }

      try {
        const parsed = JSON.parse(event.data);
        
        if (parsed.type === 'light' && parsed.content) {
          onLightChunk?.(parsed.content);
        }
        
        if (parsed.type === 'deep' && parsed.content) {
          onDeepChunk?.(parsed.content);
        }
        
        if (parsed.type === 'deep' && parsed.analysis) {
          onDeepAnalysis?.(parsed.analysis);
        }
      } catch (e) {
        // 忽略解析错误
      }
    });

    sse.addEventListener('error', (error: any) => {
      clearTimeout(timeout);
      sse.close();
      reject(new Error(error.message || 'SSE connection error'));
    });

    sse.addEventListener('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
