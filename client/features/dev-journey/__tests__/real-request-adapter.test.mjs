import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadTsModule } from './moduleHarness.mjs';

const source = new URL('../realRequestAdapter.ts', import.meta.url);
const controllerModule = await loadTsModule(new URL('../realRequestController.ts', import.meta.url), {});
async function setup(env = 'DEV', streamEvents = [], receipt = 'dev-ephemeral-v1', devReplyContract) {
  const calls = { start: [], stream: [], uuid: 0 };
  const module = await loadTsModule(source, {
    'expo-crypto': { randomUUID: () => `uuid-${++calls.uuid}` },
    '@/features/dev-journey/realRequestController': controllerModule,
    '@/screens/chat/api/cozeApi': {
      endDevConversation: async () => undefined,
      chatStart: async (...args) => {
        calls.start.push(args);
        return { devReplyContract, devConversationId: 'dev-conversation', expiresAt: 700000, remainingLifetimeMs: 600000, requestMode: receipt, sessionId: 's', reactionLayer: 'fixed front', companionLayer: 'fixed companion' };
      },
      chatStream: async (...args) => {
        calls.stream.push(args);
        for (const event of streamEvents) args[1].onChunk(JSON.stringify(event));
        args[1].onDone();
      },
    },
  }, { process: { env: { EXPO_PUBLIC_APP_ENV: env } } });
  return { module, calls };
}

test('runtime factory is lazy and exact DEV guard fails closed despite attempted send', async () => {
  for (const env of ['PROD', 'dev', '', undefined]) {
    const { module, calls } = await setup(env === undefined ? null : env);
    const controller = module.createDevRealRequestControllerForRuntime();
    assert.equal(controller.getSnapshot().canSend, false);
    assert.equal(await controller.send('text'), false);
    assert.deepEqual(calls, { start: [], stream: [], uuid: 0 });
    await assert.rejects(module.createDevRealRequestTransport().start({ message: 'text', requestId: 'id' }, new AbortController().signal));
    assert.equal(calls.start.length, 0);
  }
  const { module, calls } = await setup();
  module.createDevRealRequestControllerForRuntime().reset();
  assert.deepEqual(calls, { start: [], stream: [], uuid: 0 });
});

test('adapter allowlists fields and uses only existing helpers with the same signal', async () => {
  const { module, calls } = await setup('DEV', [
    { eventType: 'reaction', content: 'not Deep' },
    { eventType: 'companion', content: 'also not Deep' },
    { eventType: 'deep.delta', content: 'real backend text' },
    { eventType: 'turn.completed' },
  ]);
  const signal = new AbortController().signal;
  const transport = module.createDevRealRequestTransport();
  const result = await transport.start({ roleId: 'unexpected', message: 'current text', requestId: 'id',
    accountId: 'synthetic-account', conversationId: 'old-conversation', history: ['private history'],
    patterns: ['pattern'], practice: 'practice', path: 'path', }, signal);
  assert.deepEqual(calls.start[0], ['clever-fox', 'current text', undefined, 'id', undefined, undefined, signal, 'dev-ephemeral-v1', undefined, 'dev-reply-practice-v1']);
  assert.equal(result.reactionText, '');
  assert.equal(result.companionText, '');
  const deep = []; let done = 0, failed = 0;
  await transport.stream(result.sessionId, { onDeepChunk: value => deep.push(value),
    onDone: () => done++, onError: () => failed++, }, signal);
  assert.deepEqual(deep, ['real backend text']); assert.equal(done, 1); assert.equal(failed, 0);
  assert.equal(calls.stream[0][0], 's'); assert.equal(calls.stream[0][2], undefined);
  assert.equal(calls.stream[0][3], signal);
});

for (const [name, events] of [
  ['front only', [{ eventType: 'reaction', content: 'front' }, { eventType: 'turn.completed' }]],
  ['EOF without terminal', [{ eventType: 'deep.delta', content: 'partial' }]],
  ['backend error', [{ eventType: 'deep.delta', content: 'partial' }, { eventType: 'error' }, { eventType: 'turn.completed' }]],
]) {
  test(`${name} cannot be reported as successful Deep`, async () => {
    const { module } = await setup('DEV', events);
    const controller = module.createDevRealRequestControllerForRuntime();
    assert.equal(await controller.send('hello'), false);
    assert.equal(controller.getSnapshot().status, 'failed');
  });
}

test('only backend Deep with terminal permits success; provider/model/cost are not fabricated', async () => {
  const { module } = await setup('DEV', [
    { eventType: 'deep.delta', content: 'answer' }, { eventType: 'turn.completed' },
  ]);
  const controller = module.createDevRealRequestControllerForRuntime();
  assert.equal(await controller.send('hello'), true);
  assert.equal(controller.getSnapshot().source, 'backend-deep');
  for (const field of ['provider', 'model', 'cost', 'accountId', 'history']) assert.ok(!(field in controller.getSnapshot()));
});

test('already aborted adapter never calls start or stream helpers', async () => {
  const { module, calls } = await setup();
  const transport = module.createDevRealRequestTransport();
  const abort = new AbortController(); abort.abort();
  await assert.rejects(transport.start({ message: 'one', requestId: 'id' }, abort.signal), { name: 'AbortError' });
  await assert.rejects(transport.stream('s', {}, abort.signal), { name: 'AbortError' });
  assert.equal(calls.start.length, 0); assert.equal(calls.stream.length, 0);
});

test('adapter also rejects invalid direct input without calling helpers', async () => {
  const { module, calls } = await setup(); const transport = module.createDevRealRequestTransport();
  for (const input of [
    { message: ' ', requestId: 'id' }, { message: 'a'.repeat(1001), requestId: 'id' },
    { message: 'valid', requestId: 'invalid id' },
  ]) await assert.rejects(transport.start(input, new AbortController().signal));
  assert.equal(calls.start.length, 0);
});

test('missing or wrong isolation receipt cannot start SSE or report success', async () => {
  for (const receipt of [null, '', 'other']) {
    const { module, calls } = await setup('DEV', [], receipt);
    const controller = module.createDevRealRequestControllerForRuntime();
    assert.equal(await controller.send('fictional'), false);
    assert.equal(controller.getSnapshot().status, 'failed');
    assert.equal(calls.start.length, 1); assert.equal(calls.stream.length, 0);
  }
});

const contract = 'dev-reply-practice-v1';
const resultEnvelope = () => ({ contract, reply: 'reply', practiceCandidate: { ifCue: 'cue', thenAction: 'action' },
  source: { sessionId: 's', devConversationId: 'dev-conversation', requestId: 'id' } });
for (const [name, result, expectedSuccess] of [
  ['valid', resultEnvelope(), true], ['missing', undefined, false],
  ['cross session', { ...resultEnvelope(), source: { ...resultEnvelope().source, sessionId: 'other' } }, false],
  ['cross conversation', { ...resultEnvelope(), source: { ...resultEnvelope().source, devConversationId: 'other' } }, false],
  ['cross request', { ...resultEnvelope(), source: { ...resultEnvelope().source, requestId: 'other' } }, false],
]) test(`adapter negotiated terminal ${name}`, async () => {
  const { module } = await setup('DEV', [{ eventType: 'deep.delta', content: 'reply' },
    { eventType: 'turn.completed', payload: { practiceReply: result } }], 'dev-ephemeral-v1', contract);
  const transport = module.createDevRealRequestTransport(); const signal = new AbortController().signal;
  const start = await transport.start({ message: 'current text', requestId: 'id' }, signal); assert.equal(start.devReplyContract, contract);
  let done = 0, error = 0;
  await transport.stream(start.sessionId, { onDeepChunk() {}, onDone: r => { done++; assert.equal(r.contract, contract); }, onError: () => error++ }, signal,
    { contract, devConversationId: 'dev-conversation', requestId: 'id' });
  assert.equal(done, expectedSuccess ? 1 : 0); assert.equal(error, expectedSuccess ? 0 : 1);
});
test('unsupported negotiated contract fails without additional request', async () => {
  const { module, calls } = await setup('DEV', [], 'dev-ephemeral-v1', 'unknown');
  await assert.rejects(module.createDevRealRequestTransport().start({ message: 'text', requestId: 'id' }, new AbortController().signal));
  assert.equal(calls.start.length, 1); assert.equal(calls.stream.length, 0);
});
