import { Platform } from 'react-native';
import { chatStream } from '../api/cozeApi';

const NATIVE_BEARER = 'Bearer native-securestore-fixture';
jest.mock('../stores/anonymousSession', () => ({
  getAnonymousRequestOptions: jest.fn(async () => ({
    headers: { Authorization: NATIVE_BEARER },
  })),
}));

class FakeXMLHttpRequest {
  static readonly LOADING = 3;
  static readonly DONE = 4;
  static readonly instances: FakeXMLHttpRequest[] = [];
  static responseText = '';

  readyState = 0;
  status = 0;
  responseText = '';
  timeout = 0;
  withCredentials = false;
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  abortCount = 0;

  constructor() {
    FakeXMLHttpRequest.instances.push(this);
  }

  open(): void {
    this.readyState = 1;
  }

  setRequestHeader(name: string, value: string): void {
    void name;
    void value;
  }

  send(): void {
    this.status = 200;
    this.responseText = FakeXMLHttpRequest.responseText;
    this.readyState = FakeXMLHttpRequest.LOADING;
    this.onreadystatechange?.();

    this.readyState = FakeXMLHttpRequest.DONE;
    this.onreadystatechange?.();
  }

  abort(): void {
    this.abortCount += 1;
  }
}

type HarnessEvent = { data?: string; message?: string };
type HarnessListener = (event: HarnessEvent) => void;

class ReactNativeSseHarness {
  static lastUrl = '';
  static lastOptions: { headers?: Record<string, string> } | undefined;
  private closed = false;
  private processedLength = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private xhr: FakeXMLHttpRequest | null = null;
  private readonly listeners = new Map<string, HarnessListener[]>();

  constructor(url: string, options?: { headers?: Record<string, string> }) {
    ReactNativeSseHarness.lastUrl = url;
    ReactNativeSseHarness.lastOptions = options;
    this.pollTimer = setTimeout(() => this.open(), 500);
  }

  private open(): void {
    if (this.closed) return;
    this.processedLength = 0;
    this.xhr = new FakeXMLHttpRequest();
    this.xhr.onreadystatechange = () => {
      if (this.closed || !this.xhr) return;
      if (this.xhr.readyState === FakeXMLHttpRequest.LOADING) {
        this.dispatchFrames(this.xhr.responseText);
      } else if (this.xhr.readyState === FakeXMLHttpRequest.DONE) {
        this.dispatchFrames(this.xhr.responseText);
        if (!this.closed) this.pollTimer = setTimeout(() => this.open(), 5_000);
      }
    };
    this.xhr.open();
    this.xhr.send();
  }

  private dispatchFrames(responseText: string): void {
    const newText = responseText.slice(this.processedLength);
    this.processedLength = responseText.length;
    for (const frame of newText.split('\n\n')) {
      if (!frame.startsWith('data: ')) continue;
      this.dispatch('message', { data: frame.slice(6) });
    }
  }

  private dispatch(type: string, event: HarnessEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  addEventListener(type: string, listener: HarnessListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.dispatch('close', {});
    this.xhr?.abort();
  }
}

jest.mock('react-native-sse', () => ({
  __esModule: true,
  default: ReactNativeSseHarness,
}));

type Scenario = 'success' | 'error' | 'timeout';

function payloadFor(eventType: string, compatibility: Record<string, unknown>): Record<string, unknown> {
  switch (eventType) {
    case 'turn.started':
      return {
        sessionId: 'session-1',
        deepReadyAt: 1_700_000_000_000,
        reactionLayer: 'reaction text',
        companionLayer: 'companion text',
        flowContext: null,
      };
    case 'reaction':
    case 'companion':
      return { content: `${eventType} text` };
    case 'deep.delta':
      return { content: compatibility.content };
    case 'deep.completed':
      return {};
    case 'turn.completed':
      return { status: 'completed' };
    case 'error':
      return {
        code: compatibility.code,
        message: compatibility.message,
        recoverable: compatibility.recoverable,
        recoveryAction: compatibility.recoveryAction,
      };
    default:
      throw new Error(`Unhandled fixture event type: ${eventType}`);
  }
}

function envelope(eventType: string, sequence: number, compatibility: Record<string, unknown> = {}): string {
  return `data: ${JSON.stringify({
    schemaVersion: 1,
    eventType,
    sequence,
    timestamp: '2026-08-14T00:00:00.000Z',
    payload: payloadFor(eventType, compatibility),
    ...compatibility,
  })}\n\n`;
}

function responseFor(scenario: Scenario): string {
  const nonTerminal = [
    envelope('turn.started', 1, { type: 'timeline' }),
    envelope('reaction', 2, { type: 'reaction' }),
    envelope('companion', 3, { type: 'companion' }),
  ];

  if (scenario === 'success') {
    return [...nonTerminal,
      envelope('deep.delta', 4, { type: 'deep', content: 'visible deep content' }),
      envelope('deep.completed', 5, { type: 'deep', done: true }),
      envelope('turn.completed', 6, { type: 'turn.completed' }),
    ].join('');
  }

  return [...nonTerminal, envelope('error', 4, {
    type: 'error',
    code: scenario === 'timeout' ? 'STREAM_TIMEOUT' : 'DEEP_RESPONSE_FAILED',
    message: 'Safe terminal message.',
    recoverable: true,
    recoveryAction: 'retry_turn',
    done: true,
  })].join('');
}

describe.each<Scenario>(['success', 'error', 'timeout'])('EF-102 RN terminal close: %s', scenario => {
  beforeEach(() => {
    jest.useFakeTimers();
    FakeXMLHttpRequest.instances.length = 0;
    FakeXMLHttpRequest.responseText = responseFor(scenario);
    ReactNativeSseHarness.lastUrl = '';
    ReactNativeSseHarness.lastOptions = undefined;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    Object.defineProperty(globalThis, 'XMLHttpRequest', {
      configurable: true,
      value: FakeXMLHttpRequest,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
    delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
  });

  it('processes the terminal once, closes once, and never reconnects', async () => {
    const observedTypes: string[] = [];
    const observedCodes: string[] = [];
    const visibleDeep: string[] = [];
    const onDone = jest.fn(() => {
      expect(observedTypes.at(-1)).toBe(scenario === 'success' ? 'turn.completed' : 'error');
    });
    const stream = chatStream('session-1', {
      onChunk: data => {
        const event = JSON.parse(data) as { eventType: string; content?: string; code?: string };
        observedTypes.push(event.eventType);
        if (event.content) visibleDeep.push(event.content);
        if (event.code) observedCodes.push(event.code);
      },
      onDone,
    });

    await jest.advanceTimersByTimeAsync(500);
    await stream;
    await jest.advanceTimersByTimeAsync(6_000);

    expect(FakeXMLHttpRequest.instances).toHaveLength(1);
    expect(ReactNativeSseHarness.lastOptions?.headers).toEqual({
      Accept: 'text/event-stream',
      Authorization: NATIVE_BEARER,
    });
    expect(ReactNativeSseHarness.lastOptions?.headers).not.toHaveProperty('X-EmotionFlow-User-Id');
    expect(ReactNativeSseHarness.lastOptions?.headers).not.toHaveProperty('X-EmotionFlow-Conversation-Id');
    expect(FakeXMLHttpRequest.instances[0].abortCount).toBe(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(observedTypes).toEqual(scenario === 'success'
      ? ['turn.started', 'reaction', 'companion', 'deep.delta', 'deep.completed', 'turn.completed']
      : ['turn.started', 'reaction', 'companion', 'error']);
    expect(observedCodes).toEqual(scenario === 'success'
      ? []
      : [scenario === 'timeout' ? 'STREAM_TIMEOUT' : 'DEEP_RESPONSE_FAILED']);
    expect(visibleDeep).toEqual(scenario === 'success' ? ['visible deep content'] : []);
  });
});
