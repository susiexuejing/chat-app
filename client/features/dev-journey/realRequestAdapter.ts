import * as Crypto from 'expo-crypto';
import { chatStart, chatStream } from '@/screens/chat/api/cozeApi';
import {
  createDevRealRequestController,
  DEV_REAL_REQUEST_ID_PATTERN,
  DEV_REAL_REQUEST_MAX_INPUT,
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

function frontText(timeline: Array<{ text: string }> | undefined, fallback: string | undefined): string {
  const text = Array.isArray(timeline)
    ? timeline.map(item => typeof item?.text === 'string' ? item.text : '').filter(Boolean).join('\n\n')
    : '';
  return text || (typeof fallback === 'string' ? fallback : '');
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
      // Explicit allowlist: no account ID, demo history/state, conversation ID,
      // provider settings, diagnostic marker or long-term context is accepted.
      const result = await chatStart(
        'clever-fox', input.message, undefined, input.requestId, undefined, undefined, signal, 'dev-ephemeral-v1',
      );
      assertAllowed(signal);
      if (result.requestMode !== 'dev-ephemeral-v1') throw new Error('dev_isolation_not_confirmed');
      return {
        sessionId: result.sessionId,
        reactionText: frontText(result.reactionTimeline, result.reactionLayer || result.frontFlowText),
        companionText: frontText(result.companionTimeline, result.companionLayer),
      };
    },
    stream: async (sessionId, callbacks, signal) => {
      assertAllowed(signal);
      let terminal = false;
      let successfulTerminal = false;
      const fail = () => {
        if (terminal || signal.aborted) return;
        terminal = true;
        callbacks.onError();
      };
      await chatStream(sessionId, {
        onChunk: serialized => {
          if (signal.aborted || terminal) return;
          try {
            // chatStream validates EF-102 envelopes before this projection.
            const event = JSON.parse(serialized) as {
              eventType?: string;
              content?: unknown;
            };
            if (event.eventType === 'error') {
              fail();
            } else if (event.eventType === 'deep.delta' && typeof event.content === 'string') {
              callbacks.onDeepChunk(event.content);
            } else if (event.eventType === 'turn.completed') {
              successfulTerminal = true;
              terminal = true;
              callbacks.onDone();
            }
            // Reaction/Companion/timeline are not Deep or proof of provider success.
          } catch {
            fail();
          }
        },
        onError: fail,
        // EOF/[DONE] alone is insufficient: require the versioned turn terminal.
        onDone: () => { if (!successfulTerminal) fail(); },
      }, undefined, signal);
      assertAllowed(signal);
      if (!terminal) fail();
    },
  };
}

/** Construction/subscription never initiates authentication or any request. */
export function createDevRealRequestControllerForRuntime(): DevRealRequestController {
  return createDevRealRequestController({
    enabled: process.env.EXPO_PUBLIC_APP_ENV === 'DEV',
    transport: createDevRealRequestTransport(),
    createRequestId: () => Crypto.randomUUID(),
  });
}
