import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from '../../../client/features/dev-journey/__tests__/moduleHarness.mjs';
const api = await loadTsModule(new URL('../devEphemeralChat.ts', import.meta.url), {});
const plain = x => JSON.parse(JSON.stringify(x));
const digest = 'a'.repeat(64);
const result = () => ({ reply: 'Accepted reply', practiceCandidate: { ifCue: 'When ready', thenAction: 'Take a step' } });
function setup() {
  let now = 100000, sequence = 0;
  const invalidations = [];
  const store = api.createDevConversationStore({ now: () => now, createId: () => `conversation-${++sequence}`, onInvalidate: id => invalidations.push(id) });
  const begin = (name, retryOf, inputDigest = digest, owner = 'owner') => store.begin(owner, `${now}_${name}`, now, undefined, undefined,
    { inputDigest, ...(retryOf ? { retryOfRequestId: retryOf } : {}) });
  return { store, begin, invalidations, tick: ms => { now += ms; store.sweep(); } };
}
test('retry contract is explicitly negotiated and closed; legacy contract unchanged', () => {
  const body = { requestMode: api.DEV_EPHEMERAL_REQUEST_MODE, roleId: 'clever-fox', message: 'hello', requestId: '100000_b' };
  assert.equal(api.DEV_MANUAL_RETRY_CONTRACT, 'dev-manual-retry-v1');
  assert.equal(api.isValidDevEphemeralRequest(body), true);
  const retry = { ...body, retryOfRequestId: '100000_a' };
  assert.equal(api.isValidDevEphemeralRequest(retry), false);
  assert.equal(api.isValidDevEphemeralRequest(retry, true), true);
  for (const extra of [{ devConversationId: undefined }, { afterRequestId: undefined }, { retryOfRequestId: body.requestId }, { retryOfRequestId: '' }, { rawOutput: 'no' }]) {
    assert.equal(api.isValidDevEphemeralRequest({ ...retry, ...extra }, true), false);
  }
});
test('pending probe neither consumes fresh ID nor changes state; failed first turn retries without anchor', () => {
  const h = setup(); const first = h.begin('first'); const c = first.conversation;
  const before = plain(c);
  assert.deepEqual(plain(h.begin('retry', '100000_first')), { ok: false, status: 409, pending: true });
  assert.deepEqual(plain(c), before);
  assert.equal(h.store.fail(c.id, 'foreign', '100000_first'), false);
  assert.equal(h.store.fail(c.id, 'owner', '100000_first'), true);
  assert.equal(h.store.fail(c.id, 'owner', '100000_first'), false);
  const retried = h.begin('retry', '100000_first');
  assert.equal(retried.ok, true); assert.equal(retried.supersededRequestId, '100000_first');
  assert.equal(c.turn, 1); assert.equal(c.retry.logicalAnchorRequestId, null);
  assert.equal(h.store.readable(c.id, 'owner', '100000_first'), false);
  assert.equal(h.store.readable(c.id, 'owner', '100000_retry'), true);
  assert.equal(h.store.complete(c.id, 'owner', '100000_first', 'hello', result().reply, result()), false);
  assert.equal(h.store.complete(c.id, 'owner', '100000_retry', 'hello', result().reply, result()), true);
  assert.equal(c.pairs.length, 1);
  h.store.invalidate(c.id);
});
test('owner, digest, stale head and unknown retries fail closed without creating conversations', () => {
  const h = setup(); const c = h.begin('first').conversation; h.store.fail(c.id, 'owner', '100000_first');
  assert.equal(h.begin('foreign', '100000_first', digest, 'foreign').status, 404);
  assert.equal(h.begin('wrong', '100000_first', 'b'.repeat(64)).status, 409);
  assert.equal(h.begin('unknown', '100000_missing').status, 404);
  assert.equal(h.begin('bad', '100000_first', 'raw rejected message').status, 400);
  assert.equal(h.begin('retry', '100000_first').ok, true);
  assert.equal(h.begin('stale', '100000_first').status, 409);
  assert.equal(h.store.begin('owner', '100000_next', 100000, c.id, '100000_first', { inputDigest: digest }).status, 409);
  h.store.end('owner', '100000_first'); assert.equal(h.store.find(c.id, 'owner'), undefined);
  assert.equal(h.begin('after-end', '100000_retry').status, 404);
  assert.equal(c.retry, undefined); assert.deepEqual(plain(c.pairs), []);
});
test('completed replay moves anchor without provider-facing pending, turn or pair duplication and copies result', () => {
  const h = setup(); const c = h.begin('first').conversation; const accepted = result();
  assert.equal(h.store.complete(c.id, 'owner', '100000_first', 'hello', accepted.reply, accepted), true);
  accepted.practiceCandidate.ifCue = 'Mutated original';
  assert.equal(h.store.complete(c.id, 'owner', '100000_first', 'hello', accepted.reply, accepted), false);
  const replay = h.begin('replay', '100000_first');
  assert.deepEqual(plain(replay.replay), result());
  replay.replay.practiceCandidate.ifCue = 'Mutated replay';
  assert.equal(c.retry.result.practiceCandidate.ifCue, 'When ready');
  assert.equal(c.turn, 1); assert.equal(c.pairs.length, 1); assert.equal(c.pendingRequestId, null);
  assert.equal(c.lastCompletedRequestId, '100000_replay');
  assert.equal(h.begin('stale', '100000_first').status, 409);
  assert.equal(h.store.begin('owner', '100000_next', 100000, c.id, '100000_first', { inputDigest: digest }).status, 409);
  const next = h.store.begin('owner', '100000_next', 100000, c.id, '100000_replay', { inputDigest: digest });
  assert.equal(next.ok, true); assert.equal(c.turn, 2); assert.equal(c.retry.result, undefined);
  assert.equal(c.retry.logicalAnchorRequestId, '100000_replay');
  h.store.fail(c.id, 'owner', '100000_next');
  assert.equal(h.store.begin('owner', '100000_skip', 100000, c.id, '100000_replay', { inputDigest: digest }).status, 409);
  assert.equal(c.pairs.length, 1);
  h.store.end('owner', '100000_replay'); assert.equal(c.retry, undefined);
});
test('absolute TTL, cancellation markers, mode isolation, and bounded content/results', () => {
  const h = setup(); const c = h.begin('first').conversation;
  assert.equal(h.store.complete(c.id, 'owner', '100000_first', 'hello', result().reply), false);
  assert.equal(h.store.complete(c.id, 'owner', '100000_first', 'hello', result().reply, { ...result(), practiceCandidate: { ifCue: 'x'.repeat(201), thenAction: 'a' } }), false);
  assert.equal(h.store.complete(c.id, 'owner', '100000_first', 'hello', result().reply, result()), true);
  assert.equal(h.store.begin('owner', '100000_legacy', 100000, c.id, '100000_first').status, 409);
  let anchor = '100000_first';
  for (let i = 0; i < 6; i++) {
    const id = `100000_turn${i}`;
    assert.equal(h.store.begin('owner', id, 100000, c.id, anchor, { inputDigest: digest }).ok, true);
    const reply = 'a'.repeat(1400);
    assert.equal(h.store.complete(c.id, 'owner', id, 'u'.repeat(1000), reply, { reply, practiceCandidate: null }), true);
    anchor = id;
  }
  assert.ok(c.pairs.length <= 3); assert.ok(c.pairs.reduce((n, p) => n + p.user.length + p.assistant.length, 0) <= 6000);
  h.tick(599999); assert.equal(h.begin('replay', anchor).ok, true); assert.equal(c.expiresAt, 700000);
  h.tick(1); assert.equal(c.retry, undefined); assert.equal(h.begin('expired', '699999_replay').status, 404);
  assert.equal(h.store.end('owner', '700000_cancel'), true);
  assert.equal(h.begin('cancel').status, 409);
});
test('retry reservations retain per-owner and total bounds, pending probes reserve nothing', () => {
  const h = setup(); const c = h.begin('first').conversation;
  for (let i = 0; i < 100; i++) assert.equal(h.begin(`probe${i}`, '100000_first').pending, true);
  h.store.fail(c.id, 'owner', '100000_first'); let anchor = '100000_first';
  for (let i = 1; i < 64; i++) {
    const id = `retry${i}`; assert.equal(h.begin(id, anchor).ok, true);
    anchor = `100000_${id}`; h.store.fail(c.id, 'owner', anchor);
  }
  assert.equal(h.begin('capacity', anchor).status, 429);
  for (let i = 0; i < 2048 - 64; i++) assert.equal(h.store.end(`owner${i}`, `100000_cancel${i}`), true);
  assert.equal(h.store.end('extra-owner', '100000_overflow'), false);
  assert.equal(h.begin('total', anchor, digest, 'extra-owner').status, 404);
  h.store.end('owner', anchor); assert.equal(h.store.find(c.id, 'owner'), undefined);
});
test('legacy completion, oversized whole-pair exclusion, anchoring and cancellation remain unchanged', () => {
  const h = setup(); const first = h.store.begin('legacy', '100000_a', 100000); const c = first.conversation;
  assert.equal(c.retry, undefined);
  assert.equal(h.store.complete(c.id, 'legacy', '100000_a', 'hello', 'answer'), true);
  assert.equal(h.store.begin('legacy', '100000_recovery', 100000, c.id, '100000_a', { inputDigest: digest }).status, 409);
  assert.equal(h.store.begin('legacy', '100000_b', 100000, c.id, '100000_a').ok, true);
  assert.equal(h.store.complete(c.id, 'legacy', '100000_b', 'u'.repeat(6000), 'answer'), true);
  assert.deepEqual(plain(c.pairs), [{ user: 'hello', assistant: 'answer' }]);
  assert.equal(h.store.begin('legacy', '100000_c', 100000, c.id, '100000_a').status, 409);
  assert.equal(h.store.begin('legacy', '100000_c', 100000, c.id, '100000_b').ok, true);
  h.store.end('legacy', '100000_a'); assert.equal(h.store.find(c.id, 'legacy'), undefined);
  assert.equal(c.pairs.length, 0);
});
