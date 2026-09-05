import { isSendIntentCurrent, type SendIntentState } from '../contexts/ChatContext';

type Completion = { name: string; resolve: () => void };

function deferred(name: string): Completion & { promise: Promise<void> } {
  let resolve!: () => void;
  const promise = new Promise<void>(res => { resolve = res; });
  return { name, promise, resolve };
}

describe('EF-189 deterministic New Chat/send completion race', () => {
  it.each([
    ['old completion before new completion', ['old', 'new']],
    ['new completion before old completion', ['new', 'old']],
  ])('%s keeps the new intent authoritative', async (_label, order) => {
    const oldSend = deferred('old');
    const newSend = deferred('new');
    const sends = new Map([['old', oldSend], ['new', newSend]]);
    const persistence: string[] = [];
    const streams: string[] = [];
    const history: string[] = [];

    let state: SendIntentState = { generation: 1, sessionId: 'S_old', mounted: true };
    const oldIntent = { intentGeneration: 1, sessionId: 'S_old' };
    persistence.push('S_old:pending');

    // New Chat/C_new revokes the old intent before S_new is selected.
    state = { generation: 2, sessionId: null, mounted: true };
    state = { generation: 2, sessionId: 'S_new', mounted: true };
    const newIntent = { intentGeneration: 2, sessionId: 'S_new' };
    persistence.push('S_new:pending');

    const complete = async (name: string) => {
      const run = sends.get(name)!;
      await run.promise;
      const intent = name === 'old' ? oldIntent : newIntent;
      const accepted = isSendIntentCurrent(intent, state);
      if (accepted) {
        streams.push(name);
        persistence.push(`${intent.sessionId}:completed`);
        history.push(`${intent.sessionId}:${name}`);
      }
      return accepted;
    };

    const completions = order.map(name => complete(name));
    for (const name of order) {
      sends.get(name)!.resolve();
      await Promise.resolve();
    }
    const accepted = await Promise.all(completions);

    expect(accepted).toEqual(order.map(name => name === 'new'));
    expect(streams).toEqual(['new']);
    expect(persistence).toEqual(['S_old:pending', 'S_new:pending', 'S_new:completed']);
    expect(history).toEqual(['S_new:new']);
    expect(isSendIntentCurrent(oldIntent, state)).toBe(false);
    expect(isSendIntentCurrent(newIntent, state)).toBe(true);
  });
});
