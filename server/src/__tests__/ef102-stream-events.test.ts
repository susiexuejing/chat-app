import { describe, expect, it } from '@jest/globals';
import {
  mapSafeStreamError,
  projectLegacyCompatibility,
  serializeStreamEvent,
  STREAM_SCHEMA_VERSION,
  streamEventSchema,
  TurnEventSequencer,
} from '../contracts/streamEvents';
import type { StreamEvent, StreamPayloadByType } from '../contracts/streamEvents';

const startedPayload: StreamPayloadByType['turn.started'] = {
  sessionId: 'session-1',
  deepReadyAt: 1_700_000_000_000,
  reactionLayer: 'reaction text',
  companionLayer: 'companion text',
  flowContext: {
    flowType: 'anxiety_overwhelm',
    flowStage: 'beginning',
    flowStrength: 0.8,
    flowConfidence: 0.9,
    flowRisk: null,
  },
};

function fullSuccessfulTurn(): StreamEvent[] {
  const sequencer = new TurnEventSequencer();
  return [
    sequencer.next('turn.started', startedPayload),
    sequencer.next('reaction', { content: 'reaction text' }),
    sequencer.next('companion', { content: 'companion text' }),
    sequencer.next('deep.delta', { content: 'deep text' }),
    sequencer.next('deep.completed', {}),
    sequencer.next('turn.completed', { status: 'completed' }),
  ];
}

describe('EF-102 versioned streaming event contract', () => {
  it('covers every required event type with one schema', () => {
    const events = fullSuccessfulTurn();
    const sequencer = new TurnEventSequencer();
    events.push(sequencer.next('error', mapSafeStreamError('deep_response_failed')));

    expect(new Set(events.map(event => event.eventType))).toEqual(new Set([
      'turn.started',
      'reaction',
      'companion',
      'deep.delta',
      'deep.completed',
      'turn.completed',
      'error',
    ]));
    for (const event of events) {
      expect(streamEventSchema.safeParse(event).success).toBe(true);
      expect(event.schemaVersion).toBe(STREAM_SCHEMA_VERSION);
      expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
    }
  });

  it('assigns strictly increasing sequence within a turn', () => {
    const events = fullSuccessfulTurn();
    expect(events.map(event => event.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index].sequence).toBeGreaterThan(events[index - 1].sequence);
    }
  });

  it('serializes one validated data event per authoritative event', () => {
    const events = fullSuccessfulTurn();
    const serialized = events.map(serializeStreamEvent);

    expect(serialized).toHaveLength(events.length);
    serialized.forEach((frame, index) => {
      expect(frame.match(/^data: /g)).toHaveLength(1);
      const parsed = JSON.parse(frame.slice(6).trim());
      expect(streamEventSchema.parse(parsed)).toEqual(events[index]);
    });
  });

  it('derives the temporary legacy projection from typed payloads', () => {
    expect(projectLegacyCompatibility('turn.started', startedPayload)).toEqual({
      type: 'timeline',
      deepReadyAt: startedPayload.deepReadyAt,
      reactionLayer: startedPayload.reactionLayer,
      companionLayer: startedPayload.companionLayer,
      flowContext: startedPayload.flowContext,
    });
    expect(projectLegacyCompatibility('deep.delta', { content: 'deep text' })).toEqual({
      type: 'deep',
      content: 'deep text',
    });
    expect(projectLegacyCompatibility('deep.completed', {})).toEqual({ type: 'deep', done: true });
  });

  it('preserves the current client core-path observations without duplicate legacy events', () => {
    const events = fullSuccessfulTurn();
    const legacyContent: string[] = [];
    let doneCount = 0;

    for (const event of events) {
      const parsed = JSON.parse(serializeStreamEvent(event).slice(6).trim()) as {
        type: string;
        content?: string;
        done?: boolean;
      };
      if (parsed.content) legacyContent.push(parsed.content);
      if (parsed.done) doneCount += 1;
    }

    expect(events).toHaveLength(6);
    expect(legacyContent).toEqual(['deep text']);
    expect(doneCount).toBe(1);
  });

  it('maps failures to safe recoverability without exposing raw internals', () => {
    const rawInternal = 'Error: secret=abc at /srv/private/index.ts:42';
    const payloads = [
      mapSafeStreamError('deep_response_failed'),
      mapSafeStreamError('stream_timeout'),
    ];

    for (const payload of payloads) {
      const serialized = JSON.stringify(payload);
      expect(payload.recoverable).toBe(true);
      expect(payload.recoveryAction).toBe('retry_turn');
      expect(serialized).not.toContain(rawInternal);
      expect(serialized).not.toMatch(/secret|stack|\/srv\/|\.ts:/i);
    }
  });

  it('keeps error paths ordered and exposes only the safe legacy error projection', () => {
    const sequencer = new TurnEventSequencer();
    const events = [
      sequencer.next('turn.started', startedPayload),
      sequencer.next('reaction', { content: 'reaction text' }),
      sequencer.next('companion', { content: 'companion text' }),
      sequencer.next('error', mapSafeStreamError('deep_response_failed')),
    ];
    const errorEvent = events[3];

    expect(events.map(event => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(errorEvent).toMatchObject({
      eventType: 'error',
      type: 'error',
      code: 'DEEP_RESPONSE_FAILED',
      recoverable: true,
      recoveryAction: 'retry_turn',
      done: true,
    });
    expect(streamEventSchema.safeParse(errorEvent).success).toBe(true);
  });

  it('rejects malformed envelopes and payloads', () => {
    const event = fullSuccessfulTurn()[0];
    expect(streamEventSchema.safeParse({ ...event, sequence: 0 }).success).toBe(false);
    expect(streamEventSchema.safeParse({ ...event, schemaVersion: 2 }).success).toBe(false);
    expect(streamEventSchema.safeParse({ ...event, payload: { ...event.payload, internalError: 'raw' } }).success).toBe(false);
  });
});
