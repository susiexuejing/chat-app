// Full offline client -> HTTP helper -> actual handler -> validated SSE round trip.
// Native hosts/auth/provider/network I/O are synthetic; no socket is opened.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';
import { harness, providerResponse, settle } from './devEphemeralHarness.mjs';
const { z } = createRequire(import.meta.url)('zod');
const CONTRACT = 'dev-reply-practice-v1';
const reply = '周四的图书馆预约还没有确认。';
const output = () => JSON.stringify({ contract: CONTRACT, reply, practiceCandidate: null });
async function setup({ failSecond = false, loseTerminal = false } = {}) {
  let n = 0, sequence = 0, firstStream = true;
  const requests = [];
  const h = await harness({ realValidator: true, realStreamContract: true,
    provider: async () => providerResponse({ text: failSecond && ++n === 2 ? 'synthetic malformed JSON' : output() }),
  });
  const fetchMock = async (url, options) => {
    const u = new URL(url); requests.push({ path: u.pathname, options });
    const started = options.method === 'POST';
    const r = await h.request(started ? 'POST' : 'GET', u.pathname, {
      input: started ? JSON.parse(options.body) : undefined,
      query: { sessionId: u.searchParams.get('sessionId') },
      accept: options.headers.Accept, retryContract: options.headers['X-Dev-Retry-Contract'],
    });
    await settle();
    let bytes = '';
    if (!started) {
      h.tick(100); await settle();
      bytes = r.res.writes.filter(line => !(loseTerminal && firstStream && line.includes('turn.completed'))).join('');
      firstStream = false;
    }
    let read = false;
    return { ok: r.res.statusCode === 200, status: r.res.statusCode,
      headers: { get: name => Object.entries(r.res.headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] },
      json: async () => r.res.body,
      body: { getReader: () => ({ read: async () => {
        if (read) return { done: true }; read = true;
        return { done: false, value: new TextEncoder().encode(bytes) };
      }, cancel: async () => {}, releaseLock() {} }) },
    };
  };
  const controllerModule = await loadTsModule(new URL('../../../client/features/dev-journey/realRequestController.ts', import.meta.url), {}, {
    Date: class extends Date { static now() { return h.now(); } },
  });
  const api = await loadTsModule(new URL('../../../client/screens/chat/api/cozeApi.ts', import.meta.url), {
    'expo-constants': { default: { expoConfig: { extra: { EXPO_PUBLIC_BACKEND_BASE_URL: 'https://mock.invalid' } } } },
    'react-native': { Platform: { OS: 'web' } }, zod: { z },
    '../utils/ef77Diagnostics': { emitEf77Trace() {}, getEf77ErrorType: () => 'synthetic', isEf77DiagnosticEnabled: () => false },
    '../stores/anonymousSession': { getAnonymousRequestOptions: async () => ({ credentials: 'include', headers: {} }) },
    'react-native-sse': { default: class {} },
  }, { process: { env: { EXPO_PUBLIC_APP_ENV: 'DEV' } }, fetch: fetchMock });
  const adapter = await loadTsModule(new URL('../../../client/features/dev-journey/realRequestAdapter.ts', import.meta.url), {
    'expo-crypto': { randomUUID: () => `synthetic-${++sequence}` },
    '@/features/dev-journey/realRequestController': controllerModule,
    '@/screens/chat/api/cozeApi': api,
  }, { process: { env: { EXPO_PUBLIC_APP_ENV: 'DEV' } } });
  const controller = controllerModule.createDevRealRequestController({ enabled: true,
    transport: adapter.createDevRealRequestTransport(), createRequestId: () => `${h.now()}_integration-${++sequence}` });
  return { controller, h, requests };
}

test('actual client/server technical failure preserves prior turn and explicit retry uses exact negotiated header and source', async t => {
  const { controller: c, h, requests } = await setup({ failSecond: true }); t.after(() => c.dispose());
  assert.equal(await c.send('虚构场景：周四的图书馆预约还没有确认。'), true);
  assert.equal(await c.send('虚构场景：我只是把课程抄在纸上。'), false);
  assert.equal(c.getSnapshot().status, 'recoverable');
  assert.equal(c.getSnapshot().error, '刚才的回复没有完成，可以重试');
  assert.equal(c.getSnapshot().completedTurns.length, 1);
  assert.equal(h.providerRequests.length, 2);
  assert.equal(await c.retry(), true);
  assert.equal(c.getSnapshot().completedTurns.length, 1);
  assert.equal(h.providerRequests.length, 3);
  const starts = requests.filter(x => x.path.endsWith('/start'));
  for (const r of starts) {
    assert.equal(r.options.headers.Accept, `application/json; dev-reply-contract=${CONTRACT}`);
    assert.equal(r.options.headers['X-Dev-Retry-Contract'], 'dev-manual-retry-v1');
  }
  assert.equal(JSON.parse(starts[2].options.body).retryOfRequestId, JSON.parse(starts[1].options.body).requestId);
  assert.equal(JSON.parse(h.providerRequests[2].options.body).messages.length, 4);
});

test('actual client EOF after accepted output recovers by replay, not a duplicate provider call', async t => {
  const { controller: c, h } = await setup({ loseTerminal: true }); t.after(() => c.dispose());
  assert.equal(await c.send('虚构场景：周四的图书馆预约还没有确认。'), false);
  assert.equal(c.getSnapshot().status, 'recoverable'); assert.equal(c.getSnapshot().deepText, '');
  const before = c.getSnapshot().requestId;
  assert.equal(await c.retry(), true); assert.notEqual(c.getSnapshot().requestId, before);
  assert.equal(h.providerRequests.length, 1); assert.equal(c.getSnapshot().deepText, reply);
  assert.equal(c.getSnapshot().completedTurns.length, 0);
});
