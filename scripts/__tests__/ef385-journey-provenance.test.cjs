'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDemoRepository, STORAGE_KEY, DEMO_NUMBER, CANDIDATE } = require('../../client/features/synthetic-demo/repository.js');
function fixture() {
  const map = new Map([['old-live-chat', 'untouched']]); let fail = false, writes = 0;
  const storage = { getItem: key => map.get(key) ?? null, setItem(key, value) { if (fail) throw Error('quota'); writes++; map.set(key, value); } };
  const repo = createDemoRepository(storage, { now: () => 1000000, random: () => 0.123456 });
  repo.login(repo.requestCode(DEMO_NUMBER));
  return { repo, map, storage, writes: () => writes, fail: value => { fail = value; } };
}
const reply = { text: '我可以先写一个版本。', input: '虚构场景：小林准备普通工作汇报。', requestId: 'dev-request-1' };
test('confirmed DEV understanding records actual input and bounded source, never invented fixed facts', () => {
  const f = fixture(), count = f.writes(); const s = f.repo.confirmDevUnderstanding(reply, 0);
  assert.equal(f.writes(), count + 1); assert.equal(s.pattern.name, '我想保留的理解');
  assert.equal(s.pattern.currentUnderstanding, reply.text); assert.equal(s.pattern.demoSource, 'dev-api-test');
  assert.deepEqual(s.pattern.origin, { input: reply.input, requestId: reply.requestId });
  assert.equal(s.path.length, 1); assert.equal(s.path[0].fact, '用户明确保存的 DEV 测试输入：' + reply.input);
  assert.match(s.path[0].source, /模型未核验/); assert.doesNotMatch(JSON.stringify(s), /先责备自己|儿子|qwen|DashScope/);
  assert.equal(s.practice, null); assert.equal(f.map.get('old-live-chat'), 'untouched');
});
test('duplicate confirmation is a no-op; request identity cannot attach different input or understanding', () => {
  const f = fixture(), s = f.repo.confirmDevUnderstanding(reply, 0), count = f.writes();
  assert.deepEqual(f.repo.confirmDevUnderstanding(reply, 0), s); assert.equal(f.writes(), count);
  assert.throws(() => f.repo.confirmDevUnderstanding({ ...reply, input: '不同输入' }, 1));
  assert.throws(() => f.repo.confirmDevUnderstanding({ ...reply, text: '不同理解' }, 1));
  assert.deepEqual(f.repo.snapshot(), s);
});
test('new completion stores input and old/new correction atomically with version checks', () => {
  const f = fixture(), before = f.repo.confirmDevUnderstanding(reply, 0);
  const next = { ...reply, text: '我决定暂停修改。', requestId: 'dev-request-2', relation: 'correct-current' };
  assert.throws(() => f.repo.confirmDevUnderstanding(next, 0), /版本/);
  f.fail(true); assert.throws(() => f.repo.confirmDevUnderstanding(next, 1), /未保存/);
  assert.deepEqual(f.repo.snapshot(), before); f.fail(false); const count = f.writes();
  const saved = f.repo.confirmDevUnderstanding(next, 1); assert.equal(f.writes(), count + 1);
  assert.equal(saved.path.length, 3); assert.equal(saved.path[1].oldUnderstanding, reply.text);
  assert.equal(saved.path[1].currentUnderstanding, next.text); assert.equal(saved.path[2].origin.requestId, next.requestId);
  assert.deepEqual(saved.path[0], before.path[0]);
  assert.throws(() => f.repo.confirmDevUnderstanding(reply, 2), /已经保存/);
});
test('legacy snapshots remain readable without migration and old events/records keep fixed source', () => {
  const f = fixture(); f.repo.confirmPattern(CANDIDATE);
  f.repo.savePractice({ ifCue: '旧触发', thenAction: '旧动作' }, 0);
  const before = f.repo.saveRecord({ occurred: false, action: null, feeling: null }, 1, 'legacy-record');
  const raw = f.map.get(STORAGE_KEY); assert.deepEqual(createDemoRepository(f.storage).snapshot(), before); assert.equal(f.map.get(STORAGE_KEY), raw);
  const next = f.repo.confirmDevUnderstanding({ ...reply, relation: 'correct-current' }, 1);
  assert.deepEqual(next.path.slice(0, 2), before.path); assert.deepEqual(next.records, before.records);
  assert.deepEqual(next.practice, before.practice); assert.equal(next.path[0].demoSource, 'synthetic');
});
test('new local practice/records use neutral names and user source rather than model conclusions', () => {
  const f = fixture(); f.repo.confirmDevUnderstanding(reply, 0);
  assert.throws(() => f.repo.savePractice({ ifCue: '', thenAction: '' }, 0));
  f.repo.savePractice({ ifCue: '虚构汇报前', thenAction: '写一个开场版本' }, 0);
  const s = f.repo.saveRecord({ occurred: true, action: 'other', feeling: 'not_recorded' }, 1, 'local-record');
  assert.equal(s.practice.name, '我确认的小练习'); assert.equal(s.records[0].demoSource, 'dev-api-test');
  assert.equal(s.path[1].source, '用户明确保存的练习记录'); assert.equal(s.path.some(e => e.type === 'exception'), false);
});
test('annotations cannot rewrite immutable origin/fact/type or the accepted understanding history', () => {
  const f = fixture(), s = f.repo.confirmDevUnderstanding(reply, 0);
  for (const patch of [{ origin: { input: 'changed', requestId: 'x' } }, { fact: 'changed' }, { type: 'exception' }, { source: 'model verified' }]) {
    assert.throws(() => f.repo.updatePath('evt-1', patch, 1));
  }
  const next = f.repo.updatePath('evt-1', { feeling: '虚构感受', explanation: '我的解释', linked: false }, 1);
  assert.equal(next.path[0].fact, s.path[0].fact); assert.deepEqual(next.path[0].origin, s.path[0].origin);
});
test('malformed or expanded payloads are rejected without writes or credential acceptance', () => {
  const f = fixture(), raw = f.map.get(STORAGE_KEY);
  for (const payload of [{ ...reply, userId: 'live-user' }, { ...reply, apiKey: 'not-a-secret' }, { ...reply, requestId: 'bad/id' }, { ...reply, input: 'x'.repeat(1001) }, { ...reply, text: '' }]) {
    assert.throws(() => f.repo.confirmDevUnderstanding(payload, 0)); assert.equal(f.map.get(STORAGE_KEY), raw);
  }
});
test('invalid persisted DEV provenance fails closed without overwriting saved bytes', () => {
  const f = fixture(); const s = f.repo.confirmDevUnderstanding(reply, 0);
  delete s.pattern.origin; const raw = JSON.stringify(s); f.map.set(STORAGE_KEY, raw);
  assert.throws(() => createDemoRepository(f.storage).snapshot(), /无法读取/); assert.equal(f.map.get(STORAGE_KEY), raw);
});
test('logout hides local API-derived understanding; re-login restores only explicitly saved content', () => {
  const f = fixture(), before = f.repo.confirmDevUnderstanding(reply, 0);
  assert.equal(f.repo.logout().pattern, null); assert.throws(() => f.repo.confirmDevUnderstanding({ ...reply, requestId: 'other' }, 1), /登录/);
  f.repo.login(f.repo.requestCode(DEMO_NUMBER)); assert.deepEqual(f.repo.snapshot().pattern, before.pattern);
  assert.deepEqual([...f.map.keys()].sort(), ['old-live-chat', STORAGE_KEY].sort());
});

test('an unrelated completion cannot automatically correct existing mode or inherit its practice', () => {
  const f = fixture(); f.repo.confirmPattern(CANDIDATE);
  f.repo.savePractice({ ifCue: '旧触发', thenAction: '旧练习' }, 0);
  const before = f.repo.saveRecord({ occurred: false, action: null, feeling: null }, 1, 'before');
  assert.throws(() => f.repo.confirmDevUnderstanding(reply, 1), /明确选择/);
  assert.deepEqual(f.repo.snapshot(), before);
  const next = f.repo.confirmDevUnderstanding({ ...reply, relation: 'correct-current' }, 1);
  assert.equal(next.pattern.name, before.pattern.name);
  assert.deepEqual(next.practice, before.practice); assert.deepEqual(next.records, before.records);
  const recorded = f.repo.saveRecord({ occurred: false, action: null, feeling: null }, 1, 'after');
  assert.equal(recorded.records[1].demoSource, 'synthetic');
  assert.equal(recorded.path.at(-1).demoSource, 'synthetic');
  assert.equal(recorded.path.at(-1).origin, undefined);
});
test('practice provenance remains tied to the understanding it was explicitly created with', () => {
  const f = fixture(); f.repo.confirmDevUnderstanding(reply, 0);
  f.repo.savePractice({ ifCue: '原触发', thenAction: '原练习' }, 0);
  const oldPractice = f.repo.snapshot().practice;
  f.repo.confirmDevUnderstanding({ ...reply, text: '新理解', input: '不同虚构话题', requestId: 'next', relation: 'correct-current' }, 1);
  const s = f.repo.saveRecord({ occurred: true, action: 'other', feeling: 'not_recorded' }, 1, 'after');
  assert.deepEqual(s.practice, oldPractice); assert.deepEqual(s.path.at(-1).origin, oldPractice.origin);
  assert.notEqual(s.path.at(-1).origin.requestId, s.pattern.origin.requestId);
});
