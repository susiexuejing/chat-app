// Real controller, synthetic transport and callback failures only. These checks
// do not establish live provider quality or the cause of an observed UI failure.
import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, loadTsModule } from './moduleHarness.mjs';

const source = new URL('../realRequestController.ts', import.meta.url);
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const receipt = {
  sessionId: 'synthetic-session', devConversationId: 'synthetic-conversation',
  expiresAt: 700000, remainingLifetimeMs: 600000,
  devReplyContract: 'dev-reply-practice-v1', devRetryContract: 'dev-manual-retry-v1',
  reactionText: '', companionText: '',
};

async function setup() {
  const timers = [], logs = [], calls = { starts: [], streams: [], ends: [], ids: 0 };
  const mod = await loadTsModule(source, {}, {
    setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimeout: timer => { if (timer) timer.cleared = true; },
    console: Object.fromEntries(['log', 'warn', 'error'].map(name => [name, (...args) => logs.push(args)])),
  });
  const transport = {
    start: async (input, signal) => { calls.starts.push({ input, signal }); return receipt; },
    stream: async (sessionId, callbacks, signal, expected) => {
      calls.streams.push({ sessionId, callbacks, signal, expected });
      callbacks.onDeepChunk('Synthetic reply.');
      callbacks.onDone({ contract: 'dev-reply-practice-v1', reply: 'Synthetic reply.', practiceCandidate: null,
        source: { sessionId, devConversationId: receipt.devConversationId, requestId: expected.requestId } });
    },
    end: async id => { calls.ends.push(id); },
  };
  const c = mod.createDevRealRequestController({ enabled: true, transport,
    createRequestId: () => `synthetic-${++calls.ids}` });
  const seen = [];
  function faultAt(predicate) {
    c.subscribe(() => { if (predicate(c.getSnapshot())) throw new Error('synthetic callback fault with private content'); });
    c.subscribe(() => { seen.push(c.getSnapshot()); });
  }
  return { c, calls, transport, timers, logs, seen, faultAt };
}

for (const status of ['starting', 'streaming', 'success']) test(`throwing ${status} observer cannot wedge a send or turn success into a retry`, async t => {
  const x = await setup(); t.after(() => x.c.dispose());
  x.faultAt(s => s.status === status);
  assert.equal(await x.c.send('Fictional input.'), true);
  assert.equal(x.c.getSnapshot().status, 'success');
  assert.deepEqual(x.seen.map(s => s.status), ['starting', 'streaming', 'success']);
  assert.equal(x.calls.starts.length, 1); assert.equal(x.calls.streams.length, 1);
  assert.equal(x.c.getSnapshot().canRetry, false); assert.equal(await x.c.retry(), false);
  assert.equal(x.calls.starts.length, 1, 'there is no automatic or spurious retry');
  assert.equal(await x.c.send('Second explicit fictional input.'), true);
  assert.equal(x.calls.starts.length, 2);
  assert.equal(x.calls.starts[1].input.afterRequestId, 'synthetic-1');
  assert.equal(x.c.getSnapshot().completedTurns.length, 1);
  assert.deepEqual(x.logs, [], 'raw observer errors and content are not logged');
});

test('throwing preflight observer cannot consume the unsent turn', async t => {
  const x = await setup(); t.after(() => x.c.dispose());
  x.faultAt(s => !!s.error);
  assert.equal(await x.c.send('a'.repeat(1001)), false);
  assert.equal(x.calls.ids, 0); assert.equal(x.calls.starts.length, 0);
  assert.equal(x.c.getSnapshot().status, 'idle'); assert.equal(x.c.getSnapshot().canSend, true);
  assert.equal(x.seen.length, 1); assert.equal(await x.c.send('Explicit valid input.'), true);
  assert.equal(x.calls.starts.length, 1); assert.deepEqual(x.logs, []);
});

test('throwing failure observer cannot turn a rejected start into an unhandled rejection', async t => {
  const x = await setup(); t.after(() => x.c.dispose());
  x.faultAt(s => s.status === 'failed');
  x.transport.start = async (input, signal) => { x.calls.starts.push({ input, signal }); throw new Error('synthetic start failure'); };
  assert.equal(await x.c.send('Fictional input.'), false);
  assert.equal(x.c.getSnapshot().status, 'failed');
  assert.equal(x.seen.at(-1).status, 'failed'); assert.equal(x.c.getSnapshot().inputText, '');
  assert.equal(x.calls.starts.length, 1); assert.equal(x.calls.streams.length, 0);
  assert.deepEqual(x.calls.ends, ['synthetic-1']); assert.deepEqual(x.logs, []);
});

test('throwing recovery observer preserves one explicit retry and the original input', async t => {
  const x = await setup(); t.after(() => x.c.dispose());
  x.faultAt(s => s.status === 'recoverable');
  const succeed = x.transport.stream;
  x.transport.stream = async (_id, cb) => cb.onError('retry_turn');
  assert.equal(await x.c.send('Fictional input.'), false);
  assert.equal(x.seen.at(-1).status, 'recoverable'); assert.equal(x.c.getSnapshot().canRetry, true);
  assert.equal(x.calls.starts.length, 1); assert.deepEqual(x.calls.ends, []);
  x.transport.stream = succeed;
  assert.equal(await x.c.retry(), true);
  assert.equal(x.calls.starts.length, 2);
  assert.equal(x.calls.starts[1].input.message, 'Fictional input.');
  assert.equal(x.calls.starts[1].input.retryOfRequestId, 'synthetic-1');
  assert.equal(x.c.getSnapshot().logicalRequestId, 'synthetic-1'); assert.deepEqual(x.logs, []);
});

for (const action of ['stop', 'reset']) test(`throwing ${action} observer cannot hide cleanup from remaining subscribers or revive a late receipt`, async t => {
  const x = await setup(); t.after(() => x.c.dispose());
  const pending = deferred();
  x.transport.start = (input, signal) => { x.calls.starts.push({ input, signal }); return pending.promise; };
  const result = x.c.send('Fictional pending input.');
  x.faultAt(s => s.status === (action === 'stop' ? 'stopped' : 'idle'));
  assert.doesNotThrow(() => x.c[action]()); assert.equal(await result, false);
  const cleared = x.c.getSnapshot();
  assert.equal(x.seen.at(-1), cleared); assert.equal(cleared.inputText, '');
  assert.equal(cleared.deepText, ''); assert.equal(cleared.requestId, null);
  assert.equal(cleared.canSend, action === 'reset');
  assert.equal(x.calls.starts[0].signal.aborted, true); assert.deepEqual(x.calls.ends, ['synthetic-1']);
  pending.resolve(receipt); await flush();
  assert.equal(x.c.getSnapshot(), cleared); assert.equal(x.calls.streams.length, 0);
  assert.equal(x.calls.starts.length, 1); assert.deepEqual(x.logs, []);
});

test('throwing deadline observer cannot prevent timeout settlement or resurrect late start', async t => {
  const x = await setup(); t.after(() => x.c.dispose());
  const pending = deferred();
  x.transport.start = (input, signal) => { x.calls.starts.push({ input, signal }); return pending.promise; };
  x.faultAt(s => s.status === 'failed');
  const result = x.c.send('Fictional pending input.');
  assert.doesNotThrow(() => x.timers.find(timer => timer.ms === 165000).fn());
  assert.equal(await result, false); assert.equal(x.seen.at(-1).status, 'failed');
  assert.equal(x.calls.starts[0].signal.aborted, true);
  assert.equal(x.c.getSnapshot().canRetry, false); assert.deepEqual(x.calls.ends, ['synthetic-1']);
  pending.resolve(receipt); await flush();
  assert.equal(x.calls.streams.length, 0); assert.equal(x.c.getSnapshot().status, 'failed');
  assert.deepEqual(x.logs, []);
});

for (const action of ['stop', 'safety']) test(`a throwing observer cannot hide synchronous ${action} from the next observer before dispatch`, async t => {
  const x = await setup(); t.after(() => x.c.dispose());
  x.faultAt(s => s.status === 'starting');
  x.c.subscribe(() => { if (x.c.getSnapshot().status === 'starting') {
    if (action === 'safety') x.c.safety('unknown'); else x.c.stop();
  } });
  assert.equal(await x.c.send('Fictional input.'), false);
  assert.equal(x.c.getSnapshot().status, action === 'stop' ? 'stopped' : 'safety');
  assert.equal(x.calls.starts.length, 0); assert.equal(x.calls.streams.length, 0);
  assert.deepEqual(x.calls.ends, ['synthetic-1']); assert.deepEqual(x.logs, []);
});
