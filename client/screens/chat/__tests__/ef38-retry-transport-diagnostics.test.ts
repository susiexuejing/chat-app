import { Platform } from 'react-native';
import {
  chatStart,
  chatStream,
  createRetryTransportDiagnostics,
} from '../api/cozeApi';
import { EF77_TRACE_PREFIX } from '../utils/ef77Diagnostics';

const fetchMock = jest.fn();
(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

const sentinels = {
  backendSession: 'DIAGNOSTIC_FIXTURE_BACKEND_SESSION',
  request: 'DIAGNOSTIC_FIXTURE_REQUEST_ID',
  conversation: 'DIAGNOSTIC_FIXTURE_CONVERSATION_ID',
  message: 'DIAGNOSTIC_FIXTURE_USER_TEXT',
  modelText: 'DIAGNOSTIC_FIXTURE_MODEL_TEXT',
  authValue: 'DIAGNOSTIC_FIXTURE_AUTH_VALUE',
  cookieValue: 'DIAGNOSTIC_FIXTURE_COOKIE_VALUE',
  credentialValue: 'DIAGNOSTIC_FIXTURE_CREDENTIAL_VALUE',
  errorText: 'DIAGNOSTIC_FIXTURE_ERROR_TEXT',
  stackText: 'DIAGNOSTIC_FIXTURE_STACK_TEXT',
};

function installWindow(enabled: boolean) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        search: enabled ? '?ef77trace=true' : '',
        origin: 'https://diagnostic.invalid',
        pathname: '/chat',
        hostname: 'diagnostic.invalid',
        protocol: 'https:',
      },
    },
  });
}

function traceEvents(spy: jest.SpyInstance) {
  return spy.mock.calls
    .filter(call => call[0] === EF77_TRACE_PREFIX)
    .map(call => JSON.parse(call[1] as string) as Record<string, unknown>);
}

function responseWithSse(parts: string[], status = 200) {
  const encoder = new TextEncoder();
  let index = 0;
  const reader = {
    read: jest.fn(async () => index < parts.length
      ? { done: false, value: encoder.encode(parts[index++]) }
      : { done: true, value: undefined }),
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    body: { getReader: () => reader },
    text: jest.fn(async () => sentinels.errorText),
    json: jest.fn(),
  };
}

function versionedFrame(eventType: string, sequence: number, payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify({
    schemaVersion: 1,
    eventType,
    sequence,
    timestamp: '2026-08-21T00:00:00.000Z',
    payload,
  })}\n\n`;
}

const startedPayload = {
  sessionId: sentinels.backendSession,
  deepReadyAt: 0,
  reactionLayer: 'fixture reaction',
  companionLayer: 'fixture companion',
  flowContext: null,
};

describe('EF-38 Retry transport diagnostics', () => {
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
    delete (globalThis as { window?: unknown }).window;
  });

  it('emits no diagnostics when disabled and preserves the transport result', async () => {
    installWindow(false);
    const response = responseWithSse(['data: [DONE]\n\n']);
    fetchMock.mockResolvedValue(response);
    const onDone = jest.fn();

    await chatStream(sentinels.backendSession, { onDone }, createRetryTransportDiagnostics(true));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(traceEvents(infoSpy)).toEqual([]);
  });

  it('records ordered chatStart success metadata without identity values', async () => {
    installWindow(true);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ sessionId: sentinels.backendSession }),
    });

    await chatStart('role-fixture', sentinels.message, sentinels.conversation, sentinels.request,
      createRetryTransportDiagnostics(true));

    const events = traceEvents(infoSpy);
    expect(events.map(event => event.event)).toEqual(['chat_start_started', 'chat_start_completed']);
    expect(events[1]).toMatchObject({ httpStatus: 201, backendSessionIdPresent: true, isRetry: true });
    expect(JSON.stringify(events)).not.toMatch(new RegExp(Object.values(sentinels).join('|')));
  });

  it('records chatStart failure using only status and error type', async () => {
    installWindow(true);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => sentinels.errorText,
    });

    await expect(chatStart('role-fixture', sentinels.message, sentinels.conversation, sentinels.request,
      createRetryTransportDiagnostics(true))).rejects.toThrow();

    const failed = traceEvents(infoSpy).find(event => event.event === 'chat_start_failed');
    expect(failed).toMatchObject({ httpStatus: 503, errorType: 'Error', isRetry: true });
    const serialized = JSON.stringify(failed);
    expect(serialized).not.toContain(sentinels.errorText);
    expect(serialized).not.toContain(sentinels.stackText);
  });

  it('records HTTP rejection without exposing the stream URL session parameter', async () => {
    installWindow(true);
    fetchMock.mockResolvedValue(responseWithSse([], 404));

    await expect(chatStream(sentinels.backendSession, {}, createRetryTransportDiagnostics(true))).rejects.toThrow();

    const events = traceEvents(infoSpy);
    expect(events.find(event => event.event === 'stream_response_observed'))
      .toMatchObject({ httpStatus: 404, responseOk: false, isRetry: true });
    expect(events.find(event => event.event === 'stream_terminal_observed'))
      .toMatchObject({ rejected: true, resolved: false, errorType: 'Error' });
    expect(JSON.stringify(events)).not.toContain(sentinels.backendSession);
  });

  it('records first event, first content and DONE with summary counts only', async () => {
    installWindow(true);
    fetchMock.mockResolvedValue(responseWithSse([
      versionedFrame('turn.started', 1, startedPayload),
      versionedFrame('deep.delta', 2, { content: sentinels.modelText }),
      'data: [DONE]\n\n',
    ]));
    const onChunk = jest.fn();
    const onDone = jest.fn();

    await chatStream(sentinels.backendSession, { onChunk, onDone }, createRetryTransportDiagnostics(true));

    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledTimes(1);
    const events = traceEvents(infoSpy);
    const progress = events.filter(event => event.event === 'stream_progress');
    expect(progress).toHaveLength(3);
    expect(progress[0]).toMatchObject({ firstEventObserved: true, firstContentChunkObserved: false, eventCount: 1, contentChunkCount: 0 });
    expect(progress[1]).toMatchObject({ firstEventObserved: true, firstContentChunkObserved: true, eventCount: 2, contentChunkCount: 1 });
    expect(events.find(event => event.event === 'stream_terminal_observed'))
      .toMatchObject({ doneObserved: true, eofObserved: false, resolved: true, rejected: false, eventCount: 2, contentChunkCount: 1 });
    expect(JSON.stringify(events)).not.toContain(sentinels.modelText);
  });

  it('records EOF without DONE while preserving the existing onDone completion', async () => {
    installWindow(true);
    fetchMock.mockResolvedValue(responseWithSse([versionedFrame('turn.started', 1, startedPayload)]));
    const onDone = jest.fn();

    await chatStream(sentinels.backendSession, { onDone }, createRetryTransportDiagnostics(true));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(traceEvents(infoSpy).find(event => event.event === 'stream_terminal_observed'))
      .toMatchObject({ doneObserved: false, eofObserved: true, resolved: true, rejected: false });
  });

  it('records a rejected fetch using only error type', async () => {
    installWindow(true);
    const transportError = Object.assign(new TypeError(sentinels.errorText), { stack: sentinels.stackText });
    fetchMock.mockRejectedValue(transportError);

    await expect(chatStream(sentinels.backendSession, {}, createRetryTransportDiagnostics(true))).rejects.toBe(transportError);

    const events = traceEvents(infoSpy);
    expect(events.find(event => event.event === 'stream_terminal_observed'))
      .toMatchObject({ rejected: true, resolved: false, errorType: 'TypeError' });
    const serialized = JSON.stringify(events);
    Object.values(sentinels).forEach(value => expect(serialized).not.toContain(value));
  });
});
