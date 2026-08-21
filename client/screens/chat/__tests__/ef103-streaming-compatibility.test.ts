import {
  createStreamSequenceValidator,
  parseVersionedStreamEvent,
} from '../api/cozeApi';

const timestamp = '2026-08-21T00:00:00.000Z';

function event(eventType: string, sequence: number, payload: Record<string, unknown>): string {
  return JSON.stringify({ schemaVersion: 1, eventType, sequence, timestamp, payload });
}

describe('EF-103 typed stream compatibility', () => {
  it('parses every known EF-102 event into the current client projection', () => {
    const events = [
      event('turn.started', 1, {
        sessionId: 'session-1', deepReadyAt: 0, reactionLayer: 'reaction', companionLayer: 'companion', flowContext: null,
      }),
      event('reaction', 2, { content: 'reaction' }),
      event('companion', 3, { content: 'companion' }),
      event('deep.delta', 4, { content: 'deep' }),
      event('deep.completed', 5, {}),
      event('turn.completed', 6, { status: 'completed' }),
      event('error', 7, {
        code: 'DEEP_RESPONSE_FAILED', message: 'Safe message', recoverable: true, recoveryAction: 'retry_turn',
      }),
    ];

    const results = events.map(parseVersionedStreamEvent);
    expect(results.every(result => result.kind === 'known')).toBe(true);
    expect(results.filter(result => result.kind === 'known').map(result => result.eventType)).toEqual([
      'turn.started', 'reaction', 'companion', 'deep.delta', 'deep.completed', 'turn.completed', 'error',
    ]);
    const deep = results[3];
    expect(deep).toMatchObject({
      kind: 'known',
      eventType: 'deep.delta',
      serialized: expect.stringContaining('"content":"deep"'),
    });
  });

  it('ignores a valid compatible unknown event without producing a dispatch payload', () => {
    expect(parseVersionedStreamEvent(event('future.notice', 8, { feature: 'vNext' }))).toEqual({
      kind: 'ignored-compatible', sequence: 8,
    });
  });

  it.each([
    ['invalid JSON', '{'],
    ['unsupported version', JSON.stringify({ schemaVersion: 2, eventType: 'reaction', sequence: 1, timestamp, payload: { content: 'x' } })],
    ['missing payload field', event('deep.delta', 1, {})],
    ['additional known payload field', event('reaction', 1, { content: 'reaction', extra: 'reject' })],
    ['additional error payload field', event('error', 1, {
      code: 'STREAM_TIMEOUT', message: 'Safe', recoverable: true, recoveryAction: 'retry_turn', extra: 'reject',
    })],
  ])('rejects %s before it can dispatch', (_label, data) => {
    expect(parseVersionedStreamEvent(data)).toMatchObject({ kind: 'rejected' });
  });

  it('rejects duplicate and out-of-order sequences before active-turn dispatch', () => {
    const validateSequence = createStreamSequenceValidator();
    expect(validateSequence(1)).toBeNull();
    expect(validateSequence(1)?.message).toContain('non-increasing sequence');
    expect(validateSequence(0)?.message).toContain('non-increasing sequence');
    expect(validateSequence(2)).toBeNull();
  });

  it('marks only approved terminal envelopes as terminal', () => {
    const completed = parseVersionedStreamEvent(event('turn.completed', 1, { status: 'completed' }));
    const error = parseVersionedStreamEvent(event('error', 2, {
      code: 'STREAM_TIMEOUT', message: 'Safe', recoverable: true, recoveryAction: 'retry_turn',
    }));
    const delta = parseVersionedStreamEvent(event('deep.delta', 3, { content: 'deep' }));
    expect(completed).toMatchObject({ kind: 'known', terminal: true });
    expect(error).toMatchObject({ kind: 'known', terminal: true });
    expect(delta).toMatchObject({ kind: 'known', terminal: false });
  });
});
