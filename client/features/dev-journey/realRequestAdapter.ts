import * as Crypto from 'expo-crypto';
import { chatStart, chatStream, endDevConversation } from '@/screens/chat/api/cozeApi';
import {
  createDevRealRequestController,
  DEV_REAL_REQUEST_ID_PATTERN,
  DEV_REAL_REQUEST_MAX_INPUT,
  type DevPracticeReply,
  type DevRealRequestController,
  type DevRealRequestTransport,
} from '@/features/dev-journey/realRequestController';

function assertAllowed(signal: AbortSignal) {
  // DEV web exports use production JavaScript, so __DEV__ is not this boundary.
  if (process.env.EXPO_PUBLIC_APP_ENV !== 'DEV') throw new Error('dev_request_disabled');
  if (signal.aborted) {
    const error = new Error('dev_request_stopped');
    error.name = 'AbortError';
    throw error;
  }
}

/** Uses only the existing authenticated helpers. Never reads/persists chat history. */
export function createDevRealRequestTransport(): DevRealRequestTransport {
  return {
    start: async (input, signal) => {
      assertAllowed(signal);
      if (typeof input.message !== 'string' || !input.message.trim()
        || input.message.length > DEV_REAL_REQUEST_MAX_INPUT
        || typeof input.requestId !== 'string' || !DEV_REAL_REQUEST_ID_PATTERN.test(input.requestId)) {
        throw new Error('invalid_dev_request');
      }
      if ((input.devConversationId === undefined) !== (input.afterRequestId === undefined)
        || (input.devConversationId !== undefined && (typeof input.devConversationId !== 'string'
          || !DEV_REAL_REQUEST_ID_PATTERN.test(input.devConversationId)
          || typeof input.afterRequestId !== 'string' || !DEV_REAL_REQUEST_ID_PATTERN.test(input.afterRequestId)))) {
        throw new Error('invalid_dev_context');
      }
      if (input.retryOfRequestId !== undefined && (typeof input.retryOfRequestId !== 'string'
        || !DEV_REAL_REQUEST_ID_PATTERN.test(input.retryOfRequestId) || input.devConversationId !== undefined)) throw new Error('invalid_dev_retry');
      // Explicit allowlist: opaque DEV continuation only. Never caller history,
      // account ID, pattern state, diagnostic marker or durable conversation ID.
      const result = await chatStart(
        'clever-fox', input.message, undefined, input.requestId, undefined, undefined, signal, 'dev-ephemeral-v1',
        input.devConversationId === undefined ? undefined : { devConversationId: input.devConversationId, afterRequestId: input.afterRequestId },
        'dev-reply-practice-v1',
        { contract: 'dev-manual-retry-v1', ...(input.retryOfRequestId ? { retryOfRequestId: input.retryOfRequestId } : {}) },
      );
      assertAllowed(signal);
      if (result.requestMode !== 'dev-ephemeral-v1') throw new Error('dev_isolation_not_confirmed');
      if (result.devReplyContract !== undefined && result.devReplyContract !== 'dev-reply-practice-v1') throw new Error('unsupported_dev_reply_contract');
      if (result.devRetryContract !== undefined && (result.devRetryContract !== 'dev-manual-retry-v1'
        || result.devReplyContract !== 'dev-reply-practice-v1')) throw new Error('unsupported_dev_retry_contract');
      return {
        devRetryContract: result.devRetryContract,
        devReplyContract: result.devReplyContract,
        sessionId: result.sessionId,
        devConversationId: result.devConversationId!,
        expiresAt: result.expiresAt!,
        remainingLifetimeMs: result.remainingLifetimeMs!,
        reactionText: '',
        companionText: '',
      };
    },
    end: requestId => endDevConversation(requestId),
    stream: async (sessionId, callbacks, signal, expected) => {
      assertAllowed(signal);
      let terminal = false;
      let successfulTerminal = false;
      const fail = (reason: 'retry_turn' | 'transport' | 'terminal' = 'terminal') => {
        if (terminal || signal.aborted) return;
        terminal = true;
        callbacks.onError(reason);
      };
      // Protocol/HTTP/auth failures are terminal. Only transport loss or an
      // explicitly recoverable technical event may offer manual recovery.
      const transportFailure = (error: Error) => fail(
        /^(HTTP |Unsupported stream event:|anonymous_|auth|dev_)/i.test(error?.message ?? '') ? 'terminal' : 'transport');
      try { await chatStream(sessionId, {
        onChunk: serialized => {
          if (signal.aborted || terminal) return;
          try {
            // chatStream validates EF-102 envelopes before this projection.
            const event = JSON.parse(serialized) as {
              eventType?: string;
              content?: unknown;
              payload?: { practiceReply?: DevPracticeReply; recoverable?: boolean; recoveryAction?: string };
            };
            if (event.eventType === 'error') {
              fail(expected?.retryContract === 'dev-manual-retry-v1' && event.payload?.recoverable === true
                && event.payload?.recoveryAction === 'retry_turn' ? 'retry_turn' : 'terminal');
            } else if (event.eventType === 'deep.delta' && typeof event.content === 'string') {
              callbacks.onDeepChunk(event.content);
            } else if (event.eventType === 'turn.completed') {
              const reply = event.payload?.practiceReply;
              if (expected?.contract) {
                if (!reply || reply.contract !== expected.contract || reply.source.sessionId !== sessionId
                  || reply.source.devConversationId !== expected.devConversationId || reply.source.requestId !== expected.requestId) { fail(); return; }
              } else if (reply) { fail(); return; }
              successfulTerminal = true;
              terminal = true;
              callbacks.onDone(reply);
            }
            // Reaction/Companion/timeline are not Deep or proof of provider success.
          } catch {
            fail();
          }
        },
        onError: transportFailure,
        // EOF/[DONE] alone is insufficient: require the versioned turn terminal.
        onDone: () => { if (!successfulTerminal) fail('transport'); },
      }, undefined, signal); } catch (error) { transportFailure(error as Error); }
      assertAllowed(signal);
      if (!terminal) fail('transport');
    },
  };
}

/** Construction/subscription never initiates authentication or any request. */
export function createDevRealRequestControllerForRuntime(): DevRealRequestController {
  return createDevRealRequestController({
    enabled: process.env.EXPO_PUBLIC_APP_ENV === 'DEV',
    transport: createDevRealRequestTransport(),
    createRequestId: () => `${Date.now()}_${Crypto.randomUUID()}`,
  });
}
