import { z } from 'zod';

export const STREAM_SCHEMA_VERSION = 1 as const;

const flowContextSchema = z.object({
  flowType: z.string(),
  flowStage: z.string(),
  flowStrength: z.number(),
  flowConfidence: z.number(),
  flowRisk: z.string().nullable(),
}).strict();

export const streamPayloadSchemas = {
  'turn.started': z.object({
    sessionId: z.string().min(1),
    deepReadyAt: z.number().int().nonnegative(),
    reactionLayer: z.string(),
    companionLayer: z.string(),
    flowContext: flowContextSchema.nullable(),
  }).strict(),
  reaction: z.object({ content: z.string() }).strict(),
  companion: z.object({ content: z.string() }).strict(),
  'deep.delta': z.object({ content: z.string().min(1) }).strict(),
  'deep.completed': z.object({}).strict(),
  'turn.completed': z.object({ status: z.literal('completed') }).strict(),
  error: z.object({
    code: z.enum(['DEEP_RESPONSE_FAILED', 'STREAM_TIMEOUT']),
    message: z.string().min(1),
    recoverable: z.boolean(),
    recoveryAction: z.enum(['retry_turn', 'restart_turn']),
  }).strict(),
} as const;

export type StreamEventType = keyof typeof streamPayloadSchemas;
export type StreamPayloadByType = {
  [K in StreamEventType]: z.infer<(typeof streamPayloadSchemas)[K]>;
};

export type LegacyCompatibilityByType = {
  'turn.started': {
    type: 'timeline';
    deepReadyAt: number;
    reactionLayer: string;
    companionLayer: string;
    flowContext: StreamPayloadByType['turn.started']['flowContext'];
  };
  reaction: { type: 'reaction' };
  companion: { type: 'companion' };
  'deep.delta': { type: 'deep'; content: string };
  'deep.completed': { type: 'deep'; done: true };
  'turn.completed': { type: 'turn.completed' };
  error: StreamPayloadByType['error'] & { type: 'error'; done: true };
};

export type StreamEvent<T extends StreamEventType = StreamEventType> = {
  [K in T]: {
    schemaVersion: typeof STREAM_SCHEMA_VERSION;
    eventType: K;
    sequence: number;
    timestamp: string;
    payload: StreamPayloadByType[K];
  } & LegacyCompatibilityByType[K]
}[T];

const envelopeFields = {
  schemaVersion: z.literal(STREAM_SCHEMA_VERSION),
  sequence: z.number().int().positive(),
  timestamp: z.iso.datetime(),
};

export const streamEventSchema = z.discriminatedUnion('eventType', [
  z.object({
    ...envelopeFields,
    eventType: z.literal('turn.started'),
    payload: streamPayloadSchemas['turn.started'],
    type: z.literal('timeline'),
    deepReadyAt: z.number().int().nonnegative(),
    reactionLayer: z.string(),
    companionLayer: z.string(),
    flowContext: flowContextSchema.nullable(),
  }).strict(),
  z.object({ ...envelopeFields, eventType: z.literal('reaction'), payload: streamPayloadSchemas.reaction, type: z.literal('reaction') }).strict(),
  z.object({ ...envelopeFields, eventType: z.literal('companion'), payload: streamPayloadSchemas.companion, type: z.literal('companion') }).strict(),
  z.object({ ...envelopeFields, eventType: z.literal('deep.delta'), payload: streamPayloadSchemas['deep.delta'], type: z.literal('deep'), content: z.string().min(1) }).strict(),
  z.object({ ...envelopeFields, eventType: z.literal('deep.completed'), payload: streamPayloadSchemas['deep.completed'], type: z.literal('deep'), done: z.literal(true) }).strict(),
  z.object({ ...envelopeFields, eventType: z.literal('turn.completed'), payload: streamPayloadSchemas['turn.completed'], type: z.literal('turn.completed') }).strict(),
  z.object({
    ...envelopeFields,
    eventType: z.literal('error'),
    payload: streamPayloadSchemas.error,
    type: z.literal('error'),
    code: streamPayloadSchemas.error.shape.code,
    message: z.string().min(1),
    recoverable: z.boolean(),
    recoveryAction: streamPayloadSchemas.error.shape.recoveryAction,
    done: z.literal(true),
  }).strict(),
]);

/**
 * Temporary EF-102 -> EF-103 projection for the current client parser. These
 * fields are derived only from the authoritative typed payload and must be
 * removed when EF-103 migrates the client to eventType/payload.
 */
export function projectLegacyCompatibility<T extends StreamEventType>(
  eventType: T,
  payload: StreamPayloadByType[T],
): LegacyCompatibilityByType[T] {
  switch (eventType) {
    case 'turn.started': {
      const value = payload as StreamPayloadByType['turn.started'];
      return {
        type: 'timeline',
        deepReadyAt: value.deepReadyAt,
        reactionLayer: value.reactionLayer,
        companionLayer: value.companionLayer,
        flowContext: value.flowContext,
      } as LegacyCompatibilityByType[T];
    }
    case 'reaction':
      return { type: 'reaction' } as LegacyCompatibilityByType[T];
    case 'companion':
      return { type: 'companion' } as LegacyCompatibilityByType[T];
    case 'deep.delta':
      return { type: 'deep', content: (payload as StreamPayloadByType['deep.delta']).content } as LegacyCompatibilityByType[T];
    case 'deep.completed':
      return { type: 'deep', done: true } as LegacyCompatibilityByType[T];
    case 'turn.completed':
      return { type: 'turn.completed' } as LegacyCompatibilityByType[T];
    case 'error': {
      const value = payload as StreamPayloadByType['error'];
      return { type: 'error', ...value, done: true } as LegacyCompatibilityByType[T];
    }
  }
}

export function createStreamEvent<T extends StreamEventType>(
  eventType: T,
  payload: StreamPayloadByType[T],
  sequence: number,
  now: () => Date = () => new Date(),
): StreamEvent<T> {
  const validated: unknown = streamEventSchema.parse({
    schemaVersion: STREAM_SCHEMA_VERSION,
    eventType,
    sequence,
    timestamp: now().toISOString(),
    payload,
    ...projectLegacyCompatibility(eventType, payload),
  });
  return validated as StreamEvent<T>;
}

export function serializeStreamEvent<T extends StreamEventType>(event: StreamEvent<T>): string {
  const validated = streamEventSchema.parse(event);
  return `data: ${JSON.stringify(validated)}\n\n`;
}

/** Server-owned, process-local sequence for one existing ChatSession/turn. */
export class TurnEventSequencer {
  private sequence = 0;

  next<T extends StreamEventType>(eventType: T, payload: StreamPayloadByType[T]): StreamEvent<T> {
    this.sequence += 1;
    return createStreamEvent(eventType, payload, this.sequence);
  }
}

export type StreamFailureKind = 'deep_response_failed' | 'stream_timeout';

export function mapSafeStreamError(kind: StreamFailureKind): StreamPayloadByType['error'] {
  if (kind === 'stream_timeout') {
    return {
      code: 'STREAM_TIMEOUT',
      message: 'The response timed out before completion.',
      recoverable: true,
      recoveryAction: 'retry_turn',
    };
  }

  return {
    code: 'DEEP_RESPONSE_FAILED',
    message: 'The response could not be completed.',
    recoverable: true,
    recoveryAction: 'retry_turn',
  };
}
