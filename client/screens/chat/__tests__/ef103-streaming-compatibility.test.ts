import { Platform } from 'react-native';
import {
  chatStream,
  createStreamSequenceValidator,
  parseVersionedStreamEvent,
} from '../api/cozeApi';

const timestamp = '2026-08-21T00:00:00.000Z';

function event(eventType: string, sequence: number, payload: Record<string, unknown>): string {
  return JSON.stringify({ schemaVersion: 1, eventType, sequence, timestamp, payload });
}

function sseFrame(data: string): string {
  return `data: ${data}\n\n`;
}

function sseResponse(parts: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: jest.fn(async () => index < parts.length
          ? { done: false, value: encoder.encode(parts[index++]) }
          : { done: true, value: undefined }),
        cancel: jest.fn(async () => undefined),
      }),
    },
  };
}

const fetchMock = jest.fn();
const originalFetch = globalThis.fetch;
const originalPlatform = Platform.OS;

describe('EF-103 typed stream compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch });
  });

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
    ['non-ISO timestamp accepted by Date.parse', JSON.stringify({ schemaVersion: 1, eventType: 'reaction', sequence: 1, timestamp: '2026-08-21 00:00:00Z', payload: { content: 'x' } })],
    ['calendar-invalid timestamp normalized by Date.parse', JSON.stringify({ schemaVersion: 1, eventType: 'reaction', sequence: 1, timestamp: '2026-02-30T00:00:00.000Z', payload: { content: 'x' } })],
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

  it.each([
    ['malformed JSON', [sseFrame('{')]],
    ['incompatible schema', [sseFrame(JSON.stringify({ schemaVersion: 2, eventType: 'deep.delta', sequence: 1, timestamp, payload: { content: 'x' } }))]],
    ['duplicate sequence', [
      sseFrame(event('future.notice', 1, {})),
      sseFrame(event('deep.delta', 1, { content: 'must not dispatch' })),
    ]],
    ['out-of-order sequence', [
      sseFrame(event('future.notice', 2, {})),
      sseFrame(event('deep.delta', 1, { content: 'must not dispatch' })),
    ]],
  ])('rejects %s at transport level without false completion or dispatch', async (_label, parts) => {
    fetchMock.mockResolvedValue(sseResponse(parts));
    const onChunk = jest.fn();
    const onError = jest.fn();
    const onDone = jest.fn();

    await expect(chatStream('test-session', { onChunk, onError, onDone })).rejects.toThrow('Unsupported stream event');

    expect(onChunk).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('ignores a compatible unknown frame and still dispatches the following valid terminal event', async () => {
    fetchMock.mockResolvedValue(sseResponse([
      sseFrame(event('future.notice', 1, { feature: 'vNext' })),
      sseFrame(event('turn.completed', 2, { status: 'completed' })),
    ]));
    const onChunk = jest.fn();
    const onError = jest.fn();
    const onDone = jest.fn();

    await expect(chatStream('test-session', { onChunk, onError, onDone })).resolves.toBeUndefined();

    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk.mock.calls[0][0]).toContain('"eventType":"turn.completed"');
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
