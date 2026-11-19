/* global require, __filename */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const fileURL = pathToFileURL(__filename);
const { initialState, reduce, quizzes, currentResult } = require('../model.ts');
const at = '2026-11-18T12:00:00.000Z';
function answerAll(state = initialState(), id = 'stress', answer = 0) {
  state = reduce(reduce(state, { type: 'select', id }), { type: 'start' });
  for (let i = 0; i < 6; i++) {
    state = reduce(state, { type: 'answer', index: answer });
    state = reduce(state, { type: 'next', at });
  }
  return state;
}
const authenticate = (state, identity = 'A', outcome = 'success') => reduce(state, { type: 'authenticate', identity, outcome, at });
test('initially tests only, no identity, result or answers', () => {
  const s = initialState(); assert.equal(s.view, 'list'); assert.equal(s.identity, null); assert.equal(currentResult(s), null); assert.deepEqual(s.answers, {});
});
test('all three fixture journeys require mock login and keep result in tests', () => {
  for (const q of quizzes) { let s = answerAll(initialState(), q.id); assert.equal(s.view, 'login'); assert.equal(currentResult(s), null); s = authenticate(s); assert.equal(s.view, 'result'); assert.equal(currentResult(s).quiz.id, q.id); assert.equal(currentResult(s).at, at); }
});
test('incomplete quiz cannot finish or reveal result', () => {
  let s = reduce(reduce(initialState(), { type: 'select', id: 'stress' }), { type: 'start' });
  s = reduce(s, { type: 'next', at }); assert.equal(s.question, 0); assert.ok(s.notice); assert.equal(currentResult(s), null);
});
test('back and list interruption keep answers and resume first unanswered', () => {
  let s = reduce(reduce(initialState(), { type: 'select', id: 'stress' }), { type: 'start' });
  s = reduce(s, { type: 'answer', index: 2 }); s = reduce(s, { type: 'next', at }); s = reduce(s, { type: 'list' });
  s = reduce(reduce(s, { type: 'select', id: 'stress' }), { type: 'start' }); assert.equal(s.question, 1); assert.equal(s.answers.stress[0], 2);
  s = reduce(s, { type: 'previous' }); assert.equal(s.question, 0); assert.equal(s.answers.stress[0], 2);
});
test('login cancellation, invalid, expiry and failure preserve answers', () => {
  for (const outcome of ['invalid', 'expired', 'failure']) { const before = answerAll(); let s = authenticate(before, 'A', outcome); assert.equal(s.view, 'login'); assert.deepEqual(s.answers, before.answers); assert.equal(s.identity, null); s = reduce(s, { type: 'cancel-login' }); assert.equal(s.view, 'question'); assert.deepEqual(s.answers, before.answers); s = reduce(s, { type: 'next', at }); assert.equal(authenticate(s).view, 'result'); }
});
test('logged in user completes another test without login', () => {
  let s = authenticate(answerAll()); s = answerAll(s, 'boundaries', 1); assert.equal(s.view, 'result'); assert.equal(currentResult(s).quiz.id, 'boundaries');
});
test('identity switch removes previous answers and result; logout does too', () => {
  let s = authenticate(answerAll()); s = authenticate(reduce(s, { type: 'login' }), 'B'); assert.equal(s.identity, 'B'); assert.deepEqual(s.answers, {}); assert.equal(currentResult(s), null); assert.equal(s.view, 'list');
  s = reduce(answerAll(s), { type: 'logout' }); assert.equal(s.identity, null); assert.equal(s.completed, null); assert.deepEqual(s.answers, {});
});
test('modified answers replace previous result; same answers map deterministically', () => {
  const original = authenticate(answerAll()); const edited = answerAll(original, 'stress', 1); assert.notEqual(currentResult(original).title, currentResult(edited).title); assert.equal(currentResult(edited).title, currentResult(authenticate(answerAll(initialState(), 'stress', 1))).title);
});
test('repeated completion/login does not duplicate or mutate completed result', () => {
  const s = authenticate(answerAll()); assert.deepEqual(reduce(s, { type: 'next', at: 'later' }), s); assert.deepEqual(authenticate(s), s); assert.equal(Object.keys(s.completed).length, 3);
});
test('refresh starts fresh; no history or storage used', () => { authenticate(answerAll()); assert.deepEqual(initialState().answers, {}); assert.equal(initialState().completed, null); });
test('fixtures load/empty/error/retry are local states', () => { for (const target of ['catalog', 'result']) { for (const value of ['loading', 'empty', 'error']) { let s = reduce(initialState(), { type: 'fixture', target, value }); assert.equal(s[target], value); s = reduce(s, { type: 'fixture', target, value: 'ready' }); assert.equal(s[target], 'ready'); } } });
test('fourth local fixture uses same reducer and data driven layout', () => { const fourth = { ...quizzes[0], id: 'fourth', title: '第四个示例' }; const all = [...quizzes, fourth]; let s = reduce(initialState(), { type: 'select', id: 'fourth' }, all); s = reduce(s, { type: 'start' }, all); assert.equal(s.view, 'question'); assert.equal(s.selected, 'fourth'); const ui = readFileSync(new URL('../../../screens/tests-demo/index.tsx', fileURL), 'utf8'); assert.match(ui, /quizzes\.map/); });
test('new route tree contains no legacy entry or API imports', () => {
  const root = new URL('../../../tests-app/', fileURL); assert.deepEqual(readdirSync(root).sort(), ['[...unavailable].tsx', '_layout.tsx', 'index.tsx']);
  for (const path of ['../model.ts', '../../../screens/tests-demo/index.tsx', '../../../tests-app/_layout.tsx']) { const source = readFileSync(new URL(path, fileURL), 'utf8'); assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|AsyncStorage|localStorage|sessionStorage)\b|ChatProvider|\/api\//); }
  const config = readFileSync(new URL('../../../app.config.ts', fileURL), 'utf8'); assert.match(config, /EXPO_PUBLIC_TESTS_DEMO === '1'/); assert.match(config, /root: '\.\/tests-app'/);
});
test('mid-question login resumes the unfinished question rather than claiming completion', () => {
  let s = reduce(reduce(initialState(), { type: 'select', id: 'stress' }), { type: 'start' });
  s = reduce(s, { type: 'answer', index: 0 }); s = reduce(s, { type: 'next', at });
  s = authenticate(reduce(s, { type: 'login' })); assert.equal(s.view, 'question'); assert.equal(s.question, 1); assert.equal(currentResult(s), null);
});
test('guest completion timestamp survives delayed login and login failure', () => {
  const s = reduce(authenticate(answerAll(), 'A', 'failure'), { type: 'authenticate', identity: 'A', outcome: 'success', at: '2026-11-19T00:00:00.000Z' }); assert.equal(currentResult(s).at, at);
});
test('repeated login opening is idempotent and cancel reaches original screen', () => {
  const once = reduce(initialState(), { type: 'login' }); const twice = reduce(once, { type: 'login' }); assert.deepEqual(twice, once); assert.equal(reduce(twice, { type: 'cancel-login' }).view, 'list');
});
test('changing selected quiz cannot borrow another quiz completion time', () => {
  let s = authenticate(answerAll()); s = answerAll(s, 'boundaries'); s = reduce(s, { type: 'select', id: 'stress' }); s = authenticate(reduce(s, { type: 'login' })); assert.equal(s.view, 'intro'); assert.equal(s.completed.quiz, 'boundaries');
});

test('fully answered draft resumes at final question after list or cancelled login', () => {
  for (const cancelled of [false, true]) {
    let s = reduce(reduce(initialState(), { type: 'select', id: 'stress' }), { type: 'start' });
    for (let i = 0; i < 6; i++) {
      s = reduce(s, { type: 'answer', index: 0 });
      if (i < 5 || cancelled) s = reduce(s, { type: 'next', at });
    }
    if (cancelled) s = reduce(s, { type: 'cancel-login' });
    s = reduce(s, { type: 'list' });
    s = reduce(reduce(s, { type: 'select', id: 'stress' }), { type: 'start' });
    assert.equal(s.question, 5);
    assert.equal(s.answers.stress.length, 6);
    assert.equal(reduce(s, { type: 'next', at }).view, 'login');
  }
});
test('editing a completed result still opens the first question', () => {
  let s = authenticate(answerAll());
  s = reduce(reduce(s, { type: 'select', id: 'stress' }), { type: 'start' });
  assert.equal(s.question, 0);
});
