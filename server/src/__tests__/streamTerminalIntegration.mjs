// Offline only. No sockets, external credentials, real provider, or production writes.
import assert from 'node:assert/strict';
import test from 'node:test';

const source = new URL('../../../', import.meta.url);
const { harness, body, START, STREAM, settle, providerResponse } = await import(new URL('server/src/__tests__/devEphemeralHarness.mjs', source));
const { loadTsModule } = await import(new URL('client/features/dev-journey/__tests__/moduleHarness.mjs', source));

const partialReply = '这是一段用于离线验证的合成回复，后续内容尚未完成。';
async function partialThenReadFailure() {
  let reads = 0;
  return { status: 200, ok: true, body: { getReader: () => ({ read: async () => {
    if (reads++) throw new Error('synthetic midstream failure');
    const event = { choices: [{ delta: { content: partialReply } }] };
    return { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`) };
  } }) } };
}

// The harness captures semantic server events using a mocked serializer.
// This fixture only wraps those events in the documented v1 envelope. It does
// not invent terminal events or modify the production handler's decisions.
function versionedFixture(event) {
  const { eventType, sequence, ...fields } = event;
  const payload = eventType === 'error'
    ? { code: 'DEEP_RESPONSE_FAILED', message: 'The response could not be completed.', recoverable: true, recoveryAction: 'retry_turn' }
    : fields;
  return { schemaVersion: 1, eventType, sequence, timestamp: '2026-11-08T00:52:30.000Z', payload };
}

for (const [name, provider, expected, timeout = false] of [
  ['partial-then-reader-reject', partialThenReadFailure, false],
  ['empty-then-reader-reject', async () => providerResponse({ readError: true }), false],
  ['HTTP-failure-control', async () => providerResponse({ status: 401 }), false],
  ['partial-then-timeout', async () => {
    let reads = 0;
    return { status: 200, ok: true, body: { getReader: () => ({
      read: async () => reads++ ? new Promise(() => {}) : { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: partialReply } }] })}\n\n`) },
      cancel: async () => {},
    }) } };
  }, false, true],
  ['clean-completion-control', async () => providerResponse(), true],
]) {
  test(`actual server → parser → adapter → controller: ${name}`, async () => {
  const h = await harness({ provider });
  let wireEvents = [];
  const api = await loadTsModule(new URL('client/screens/chat/api/cozeApi.ts', source), {
    'expo-constants': { default: { expoConfig: { extra: { EXPO_PUBLIC_BACKEND_BASE_URL: 'https://mock.invalid' } } } },
    'react-native': { Platform: { OS: 'web' } },
    // Only zod's timestamp dependency is mocked. All client-owned metadata,
    // payload-key, known-event and sequence checks execute from cozeApi.ts.
    zod: { z: { iso: { datetime: () => ({ safeParse: value => ({ success: typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) }) }) } } },
    '../utils/ef77Diagnostics': { emitEf77Trace() {}, getEf77ErrorType: () => '', isEf77DiagnosticEnabled: () => false },
    '../stores/anonymousSession': { getAnonymousRequestOptions: async () => ({ credentials: 'include', headers: {} }) },
  }, { process: { env: { EXPO_PUBLIC_APP_ENV: 'DEV' } }, fetch: async (url, options) => {
    if (options.method === 'POST') {
      const { res } = await h.request('POST', START, { input: JSON.parse(options.body) });
      await settle();
      return { ok: res.statusCode === 200, status: res.statusCode, json: async () => res.body };
    }
    const sessionId = new URL(url).searchParams.get('sessionId');
    const stream = await h.request('GET', STREAM, { query: { sessionId } });
    h.tick(timeout ? 60000 : 3100); await settle();
    if (timeout) { h.tick(100); await settle(); }
    wireEvents = stream.events().map(versionedFixture);
    let sent = false;
    return { ok: stream.res.statusCode === 200, status: stream.res.statusCode, body: { getReader: () => ({
      read: async () => {
        if (sent) return { done: true };
        sent = true;
        return { done: false, value: new TextEncoder().encode(wireEvents.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')) };
      }, cancel: async () => {},
    }) } };
  } });
  const controller = await loadTsModule(new URL('client/features/dev-journey/realRequestController.ts', source), {});
  const adapter = await loadTsModule(new URL('client/features/dev-journey/realRequestAdapter.ts', source), {
    'expo-crypto': { randomUUID: () => 'synthetic-request' },
    '@/screens/chat/api/cozeApi': api,
    '@/features/dev-journey/realRequestController': controller,
  }, { process: { env: { EXPO_PUBLIC_APP_ENV: 'DEV' } } });
  const c = adapter.createDevRealRequestControllerForRuntime();
  const success = await c.send('虚构测试：仅用于离线验证。');
  const snapshot = c.getSnapshot();
  // Exact state predicates from DevConversation's confirm handler, plus its
  // identity guard. UI is not mounted and onConfirm is never invoked.
  const confirmEligible = c.getSnapshot() === snapshot
    && snapshot.status === 'success' && snapshot.source === 'backend-deep' && !!snapshot.requestId;
  assert.equal(success, expected);
  assert.equal(confirmEligible, expected);
  if (!expected) {
    assert.equal(snapshot.status, 'failed');
    assert.equal(snapshot.deepText, '');
    assert.ok(!wireEvents.some(event => ['deep.delta', 'deep.completed', 'turn.completed'].includes(event.eventType)));
  }
  assert.deepEqual(h.identityCalls(), []);
  assert.equal(h.providerRequests.length, 1);
  });
}
