'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDemoRepository, STORAGE_KEY, LEGACY_STORAGE_KEY, DEMO_NUMBER, CANDIDATE } = require('../../client/features/synthetic-demo/repository.js');
const legacyFixture = require('../__fixtures__/ef384-single-pattern-v1.json');
function fixture(legacy = false) {
  const map = new Map([['old-live-chat', 'untouched']]); let fail = false, writes = 0;
  if (legacy) map.set(LEGACY_STORAGE_KEY, JSON.stringify(legacyFixture));
  const storage = { getItem: key => map.get(key) ?? null, setItem(key, value) { if (fail) throw Error('quota'); writes++; map.set(key, value); } };
  const repo = createDemoRepository(storage, { now: () => 1000000, random: () => 0.123456 });
  if (!legacy) repo.login(repo.requestCode(DEMO_NUMBER));
  return { repo, map, storage, account: repo.snapshot().accountId, writes: () => writes, fail: value => { fail = value; } };
}
const reply = { text: '我可以先写一个版本。', input: '虚构场景：小林准备普通工作汇报。', requestId: 'dev-request-1', relation: 'create-new' };
const state = (snapshot, id) => snapshot.patterns.find(item => item.pattern.patternId === id);
function first(f, payload = reply) {
  const saved = f.repo.confirmDevUnderstanding(f.account, payload, 0);
  return saved.patterns.at(-1).pattern.patternId;
}
function activate(f, id) {
  f.repo.savePractice(f.account, id, { ifCue: '虚构汇报前', thenAction: '写一个开场版本' }, 0);
  f.repo.activatePractice(f.account, id, 1);
  return f.repo.getPattern(f.account, id).practice.version;
}
test('confirmed DEV understanding records actual input and bounded source, never invented fixed facts', () => {
  const f = fixture(), count = f.writes(), id = first(f), s = f.repo.getPattern(f.account, id);
  assert.equal(f.writes(), count + 1); assert.equal(s.pattern.name, '我想保留的理解');
  assert.equal(s.pattern.currentUnderstanding, reply.text); assert.equal(s.pattern.demoSource, 'dev-api-test');
  assert.deepEqual(s.pattern.origin, { input: reply.input, requestId: reply.requestId });
  assert.equal(s.path.length, 1); assert.equal(s.path[0].fact, '用户明确保存的 DEV 测试输入：' + reply.input);
  assert.match(s.path[0].source, /模型未核验/); assert.doesNotMatch(JSON.stringify(s), /先责备自己|儿子|qwen|DashScope/);
  assert.equal(s.practice, null); assert.equal(f.map.get('old-live-chat'), 'untouched');
});
test('duplicate confirmation is a no-op; request identity cannot attach different input or understanding', () => {
  const f = fixture(); first(f); const before = f.repo.snapshot(), count = f.writes();
  assert.deepEqual(f.repo.confirmDevUnderstanding(f.account, reply, 0), before); assert.equal(f.writes(), count);
  assert.throws(() => f.repo.confirmDevUnderstanding(f.account, { ...reply, input: '不同输入' }, 0));
  assert.throws(() => f.repo.confirmDevUnderstanding(f.account, { ...reply, text: '不同理解' }, 0));
  assert.deepEqual(f.repo.snapshot(), before);
});
test('new completion stores input and old/new correction atomically with version checks', () => {
  const f = fixture(), id = first(f), before = f.repo.snapshot();
  const next = { ...reply, text: '我决定暂停修改。', requestId: 'dev-request-2', relation: 'correct-current' };
  assert.throws(() => f.repo.confirmDevUnderstanding(f.account, next, 0, id), /版本/);
  f.fail(true); assert.throws(() => f.repo.confirmDevUnderstanding(f.account, next, 1, id), /未保存/);
  assert.deepEqual(f.repo.snapshot(), before); f.fail(false); const count = f.writes();
  const saved = state(f.repo.confirmDevUnderstanding(f.account, next, 1, id), id); assert.equal(f.writes(), count + 1);
  assert.equal(saved.path.length, 3); assert.equal(saved.path[1].oldUnderstanding, reply.text);
  assert.equal(saved.path[1].currentUnderstanding, next.text); assert.equal(saved.path[2].origin.requestId, next.requestId);
  assert.deepEqual(saved.path[0], state(before, id).path[0]);
  assert.throws(() => f.repo.confirmDevUnderstanding(f.account, { ...reply, relation: 'correct-current' }, 2, id), /已经保存/);
});
test('legacy snapshots migrate losslessly on write and old events/records keep fixed source', () => {
  const f = fixture(true), before = f.repo.snapshot(), id = before.patterns[0].pattern.patternId;
  const old = state(before, id), raw = f.map.get(LEGACY_STORAGE_KEY);
  assert.deepEqual(createDemoRepository(f.storage).snapshot(), before); assert.equal(f.map.has(STORAGE_KEY), false);
  assert.deepEqual(old.pattern, legacyFixture.pattern); assert.deepEqual(old.path, legacyFixture.path);
  const next = state(f.repo.confirmDevUnderstanding(f.account, { ...reply, relation: 'correct-current' }, 1, id), id);
  assert.deepEqual(next.path.slice(0, 2), old.path); assert.deepEqual(next.records, old.records);
  assert.deepEqual(next.practice, old.practice); assert.equal(next.path[0].demoSource, 'synthetic');
  assert.equal(f.map.get(LEGACY_STORAGE_KEY), raw); assert.equal(f.repo.snapshot().patterns.length, 1);
});
test('new local practice/records use neutral names and user source rather than model conclusions', () => {
  const f = fixture(), id = first(f);
  assert.throws(() => f.repo.savePractice(f.account, id, { ifCue: '', thenAction: '' }, 0));
  const version = activate(f, id);
  const s = state(f.repo.saveRecord(f.account, id, { occurred: true, action: 'other', feeling: 'not_recorded' }, version, 'local-record'), id);
  assert.equal(s.practice.name, '我确认的小练习'); assert.equal(s.records[0].demoSource, 'dev-api-test');
  assert.equal(s.path[1].source, '用户明确保存的练习记录'); assert.equal(s.path.some(e => e.type === 'exception'), false);
});
test('annotations cannot rewrite immutable origin/fact/type or the accepted understanding history', () => {
  const f = fixture(), id = first(f), s = f.repo.getPattern(f.account, id), entryId = s.path[0].entryId;
  for (const patch of [{ origin: { input: 'changed', requestId: 'x' } }, { fact: 'changed' }, { type: 'exception' }, { source: 'model verified' }]) {
    assert.throws(() => f.repo.updatePath(f.account, id, entryId, patch, 1));
  }
  const next = state(f.repo.updatePath(f.account, id, entryId, { feeling: '虚构感受', explanation: '我的解释', linked: false }, 1), id);
  assert.equal(next.path[0].fact, s.path[0].fact); assert.deepEqual(next.path[0].origin, s.path[0].origin);
});
test('malformed or expanded payloads are rejected without writes or credential acceptance', () => {
  const f = fixture(), raw = f.map.get(STORAGE_KEY);
  for (const payload of [{ ...reply, userId: 'live-user' }, { ...reply, apiKey: 'not-a-secret' }, { ...reply, requestId: 'bad/id' }, { ...reply, input: 'x'.repeat(1001) }, { ...reply, text: '' }]) {
    assert.throws(() => f.repo.confirmDevUnderstanding(f.account, payload, 0)); assert.equal(f.map.get(STORAGE_KEY), raw);
  }
});
test('invalid persisted DEV provenance fails closed without overwriting saved bytes', () => {
  const f = fixture(); first(f);
  const stored = JSON.parse(f.map.get(STORAGE_KEY)); delete stored.patterns[0].pattern.origin;
  const raw = JSON.stringify(stored); f.map.set(STORAGE_KEY, raw);
  assert.throws(() => createDemoRepository(f.storage).snapshot(), /无法读取/); assert.equal(f.map.get(STORAGE_KEY), raw);
});
test('logout hides local API-derived understanding; re-login restores only explicitly saved content', () => {
  const f = fixture(), id = first(f), before = f.repo.getPattern(f.account, id);
  const out = f.repo.logout(); assert.deepEqual(out.patterns, []); assert.equal(out.activePracticePatternId, null);
  assert.throws(() => f.repo.confirmDevUnderstanding(f.account, { ...reply, requestId: 'other' }, 0), /登录/);
  f.repo.login(f.repo.requestCode(DEMO_NUMBER)); assert.deepEqual(f.repo.getPattern(f.account, id), before);
  assert.deepEqual([...f.map.keys()].sort(), ['old-live-chat', STORAGE_KEY].sort());
});
test('an unrelated completion cannot automatically correct existing mode or inherit its practice', () => {
  const f = fixture(true), before = f.repo.snapshot(), id = before.patterns[0].pattern.patternId, old = state(before, id);
  const { relation: _relation, ...unselected } = reply;
  assert.throws(() => f.repo.confirmDevUnderstanding(f.account, unselected, 1, id));
  assert.deepEqual(f.repo.snapshot(), before);
  const next = state(f.repo.confirmDevUnderstanding(f.account, { ...reply, relation: 'correct-current' }, 1, id), id);
  assert.equal(next.pattern.name, old.pattern.name);
  assert.deepEqual(next.practice, old.practice); assert.deepEqual(next.records, old.records);
  const recorded = state(f.repo.saveRecord(f.account, id, { occurred: false, action: null, feeling: null }, 1, 'after'), id);
  assert.equal(recorded.records[1].demoSource, 'synthetic');
  assert.equal(recorded.path.at(-1).demoSource, 'synthetic');
  assert.equal(recorded.path.at(-1).origin, undefined);
});
test('practice provenance remains tied to the understanding it was explicitly created with', () => {
  const f = fixture(), id = first(f), version = activate(f, id), oldPractice = f.repo.getPattern(f.account, id).practice;
  f.repo.confirmDevUnderstanding(f.account, { ...reply, text: '新理解', input: '不同虚构话题', requestId: 'next', relation: 'correct-current' }, 1, id);
  const s = state(f.repo.saveRecord(f.account, id, { occurred: true, action: 'other', feeling: 'not_recorded' }, version, 'after'), id);
  assert.deepEqual(s.practice, oldPractice); assert.deepEqual(s.path.at(-1).origin, oldPractice.origin);
  assert.notEqual(s.path.at(-1).origin.requestId, s.pattern.origin.requestId);
});
test('explicit new mode preserves A and request provenance cannot be reattached to B', () => {
  const f = fixture(), a = first(f), beforeA = f.repo.getPattern(f.account, a);
  const b = first(f, { ...reply, input: '虚构场景：小林安排周末。', text: '我想留出休息时间。', requestId: 'request-b' });
  assert.notEqual(a, b); assert.deepEqual(f.repo.getPattern(f.account, a), beforeA);
  const before = f.repo.snapshot(), count = f.writes();
  assert.throws(() => f.repo.confirmDevUnderstanding(f.account, { ...reply, relation: 'correct-current' }, 1, b));
  assert.deepEqual(f.repo.snapshot(), before); assert.equal(f.writes(), count);
  assert.equal(f.repo.getPattern(f.account, b).path.some(e => e.origin?.requestId === reply.requestId), false);
});
