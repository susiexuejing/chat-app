import {
  attributedRemoveItem,
  attributedSetItem,
  EF77_TRACE_PREFIX,
} from '../utils/ef77Diagnostics';

function installWindow(search: string) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { search, origin: 'https://diagnostic.invalid', pathname: '/chat' },
    },
  });
}

const attribution = {
  writerSource: 'test.writer',
  transitionReason: 'test_transition',
  queueKind: 'managed' as const,
  activeSessionId: 'PRIVATE_SESSION_ID_DO_NOT_LOG',
};

describe('EF-77 storage attribution boundary', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    jest.restoreAllMocks();
  });

  it('returns the original Promise and performs no diagnostic work when disabled', () => {
    installWindow('');
    const original = Promise.resolve();
    const adapter = { setItem: jest.fn(() => original), removeItem: jest.fn(() => original) };
    const parse = jest.spyOn(JSON, 'parse');
    const hash = jest.spyOn(BigInt, 'asUintN');
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    const returned = attributedSetItem(adapter, 'chat_sessions', 'not-json', attribution);

    expect(returned).toBe(original);
    expect(adapter.setItem).toHaveBeenCalledTimes(1);
    expect(parse).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
    expect(info.mock.calls.filter(call => call[0] === EF77_TRACE_PREFIX)).toEqual([]);
  });

  it('passes the exact payload to exactly one underlying set operation', async () => {
    installWindow('?ef77trace=true');
    const payload = '[{"id":"session-safe","messages":[]}]';
    const adapter = { setItem: jest.fn(() => Promise.resolve()), removeItem: jest.fn() };
    jest.spyOn(console, 'info').mockImplementation(() => undefined);

    await attributedSetItem(adapter, 'chat_sessions', payload, attribution);

    expect(adapter.setItem).toHaveBeenCalledTimes(1);
    expect(adapter.setItem).toHaveBeenCalledWith('chat_sessions', payload);
  });

  it('preserves invocation order without reads, retries or fallback', async () => {
    installWindow('?ef77trace=true');
    const order: string[] = [];
    const adapter = {
      setItem: jest.fn((_key: string, value: string) => {
        order.push(value);
        return Promise.resolve();
      }),
      removeItem: jest.fn(),
    };
    jest.spyOn(console, 'info').mockImplementation(() => undefined);

    await attributedSetItem(adapter, 'chat_sessions', '[]', attribution);
    await attributedSetItem(adapter, 'chat_sessions', '[1]', attribution);

    expect(order).toEqual(['[]', '[1]']);
    expect(adapter.setItem).toHaveBeenCalledTimes(2);
    expect(Object.prototype.hasOwnProperty.call(adapter, 'getItem')).toBe(false);
  });

  it('returns the identical rejected Promise and error object', async () => {
    installWindow('?ef77trace=true');
    const error = new TypeError('PRIVATE_ERROR_TEXT');
    const original = Promise.reject(error);
    const adapter = { setItem: jest.fn(() => original), removeItem: jest.fn() };
    jest.spyOn(console, 'info').mockImplementation(() => undefined);

    const returned = attributedSetItem(adapter, 'chat_sessions', '[]', attribution);

    expect(returned).toBe(original);
    await expect(returned).rejects.toBe(error);
    expect(adapter.setItem).toHaveBeenCalledTimes(1);
  });

  it('performs exactly one remove operation and preserves its Promise', async () => {
    installWindow('?ef77trace=true');
    const original = Promise.resolve();
    const adapter = { setItem: jest.fn(), removeItem: jest.fn(() => original) };
    jest.spyOn(console, 'info').mockImplementation(() => undefined);

    const returned = attributedRemoveItem(adapter, 'chat_sessions', {
      ...attribution,
      queueKind: 'bypass',
    });

    expect(returned).toBe(original);
    await returned;
    expect(adapter.removeItem).toHaveBeenCalledTimes(1);
  });

  it('distinguishes managed and bypass attribution', async () => {
    installWindow('?ef77trace=true');
    const adapter = { setItem: jest.fn(() => Promise.resolve()), removeItem: jest.fn() };
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);

    await attributedSetItem(adapter, 'chat_sessions', '[]', attribution);
    await attributedSetItem(adapter, 'chat_sessions', '[]', {
      ...attribution,
      writerSource: 'test.bypass',
      queueKind: 'bypass',
    });

    const output = info.mock.calls
      .filter(call => call[0] === EF77_TRACE_PREFIX)
      .map(call => JSON.parse(call[1] as string));
    expect(output.some(event => event.queueKind === 'managed')).toBe(true);
    expect(output.some(event => event.queueKind === 'bypass')).toBe(true);
  });

  it('never emits payload, identifier values or error text', async () => {
    installWindow('?ef77trace=true');
    const secret = 'PRIVATE_MESSAGE_AND_IDENTIFIER';
    const adapter = {
      setItem: jest.fn(() => Promise.reject(new Error(secret))),
      removeItem: jest.fn(),
    };
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const payload = JSON.stringify([{
      id: attribution.activeSessionId,
      messages: [{ content: secret }],
      pendingTurn: { requestId: secret, userMessageId: secret },
    }]);

    await expect(attributedSetItem(adapter, 'chat_sessions', payload, attribution)).rejects.toThrow();
    const output = info.mock.calls.map(call => String(call[1])).join('\n');
    expect(output).not.toContain(secret);
    expect(output).not.toContain(attribution.activeSessionId);
    expect(output).toContain('"activeSessionIdPresent":true');
    expect(output).toContain('Error');
  });
});
