'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
// Explicit compilation keeps this suite runnable under the existing Node 20 CI.
// It executes the real TypeScript source, not a copied controller implementation.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require(require.resolve('typescript', { paths: [path.join(__dirname, '../../client'), __dirname] }));
const filename = path.resolve(__dirname, '../../client/features/dev-journey/practiceCandidateDraft.ts');
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createPracticeCandidateDraftController } = compiled.exports;
const { createDemoRepository, DEMO_NUMBER, STORAGE_KEY } = require('../../client/features/synthetic-demo/repository.js');
// Test-only content, not a generator, prompt, fallback or UI fixture.
const suggestion = { ifCue: 'AI proposed cue', thenAction: 'AI proposed new action' };
function fixture() {
  const data = new Map(); let fail = false, writes = 0, saveCalls = 0;
  const repo = createDemoRepository({ getItem: key => data.get(key) ?? null, setItem(key, value) {
    if (fail) throw Error('quota'); data.set(key, value); writes++;
  } }, { now: () => 1000000, random: () => 0.123456 });
  repo.login(repo.requestCode(DEMO_NUMBER));
  const accountId = repo.snapshot().session;
  repo.createPattern(accountId, 'User-confirmed understanding, not a practice.');
  const patternId = repo.snapshot().patterns[0].pattern.patternId;
  let scope = { accountSession: {}, accountId, patternId, devConversationId: 'conversation-1', requestId: 'request-1' };
  const boundary = createPracticeCandidateDraftController({ repository: {
    getPattern: (...args) => repo.getPattern(...args),
    savePractice: (...args) => { saveCalls++; return repo.savePractice(...args); },
  }, getCurrentScope: () => scope });
  return { repo, boundary, data, accountId, patternId, scope: () => scope, setScope: next => { scope = next; },
    fail: value => { fail = value; }, writes: () => writes, saveCalls: () => saveCalls,
    raw: () => data.get(STORAGE_KEY), state: () => repo.getPattern(accountId, patternId),
    start() { const ticket = boundary.begin(scope); assert.ok(ticket); return ticket; },
    receive() { const ticket = this.start(); assert.equal(boundary.receive(ticket, suggestion), true); return boundary.getDraft(); },
  };
}
test('receipt is memory-only, suggestion identity is independent of understanding and not a user fact', () => {
  const f = fixture(), before = f.raw(), count = f.writes(); const draft = f.receive();
  assert.equal(draft.source, 'ai-suggestion'); assert.deepEqual(draft.content, suggestion);
  assert.equal(draft.scope.requestId, 'request-1'); assert.equal(draft.scope.devConversationId, 'conversation-1');
  assert.equal(f.raw(), before); assert.equal(f.writes(), count); assert.equal(f.saveCalls(), 0);
  assert.equal(f.state().practice, null);
});
test('explicit save uses existing repository once, creates paused practice, clears draft and rejects repeat', () => {
  const f = fixture(), draft = f.receive(), old = f.state();
  assert.equal(f.boundary.save(draft).status, 'saved'); assert.equal(f.saveCalls(), 1);
  assert.equal(f.state().practice.paused, true); assert.equal(f.repo.snapshot().activePracticePatternId, null);
  assert.deepEqual(f.state().records, old.records); assert.deepEqual(f.state().path, old.path);
  assert.equal(f.boundary.getDraft(), null); assert.equal(f.boundary.save(draft).status, 'stale');
  assert.equal(f.saveCalls(), 1);
});
test('editing requires current displayed revision; no writes; save only edited content', () => {
  const f = fixture(), first = f.receive(), before = f.raw();
  assert.equal(f.boundary.edit(first, { ifCue: '', thenAction: '' }), true);
  const blank = f.boundary.getDraft(); assert.equal(f.boundary.save(blank).status, 'failed');
  assert.equal(f.boundary.getDraft(), blank); assert.equal(f.boundary.save(first).status, 'stale');
  assert.equal(f.boundary.edit(first, suggestion), false); assert.equal(f.boundary.cancel(first), false);
  assert.equal(f.raw(), before); assert.equal(f.saveCalls(), 0);
  const edited = { ifCue: 'User changed cue', thenAction: 'User chose action' };
  assert.equal(f.boundary.edit(blank, edited), true); assert.equal(f.boundary.save(f.boundary.getDraft()).status, 'saved');
  assert.equal(f.state().practice.thenAction, edited.thenAction);
});
test('cancel revokes both late receipts and stale saves', () => {
  const f = fixture(), ticket = f.start(), before = f.raw();
  f.boundary.receive(ticket, suggestion); const draft = f.boundary.getDraft();
  assert.equal(f.boundary.cancel(draft), true); assert.equal(f.boundary.receive(ticket, suggestion), false);
  assert.equal(f.boundary.save(draft).status, 'stale'); assert.equal(f.raw(), before);
});
test('duplicate receipt cannot overwrite user edits', () => {
  const f = fixture(), ticket = f.start(); f.boundary.receive(ticket, suggestion);
  f.boundary.edit(f.boundary.getDraft(), { ifCue: 'edit', thenAction: 'edited' }); const draft = f.boundary.getDraft();
  assert.equal(f.boundary.receive(ticket, suggestion), false); assert.equal(f.boundary.getDraft(), draft);
});
test('storage failure keeps exact draft and old data; explicit retry succeeds', () => {
  const f = fixture(); f.repo.savePractice(f.accountId, f.patternId, { ifCue: 'old', thenAction: 'old' }, 0);
  const draft = f.receive(), before = f.raw(); f.fail(true);
  assert.equal(f.boundary.save(draft).status, 'failed'); assert.equal(f.boundary.getDraft(), draft); assert.equal(f.raw(), before);
  f.fail(false); assert.equal(f.boundary.save(draft).status, 'saved'); assert.equal(f.state().practice.version, 2);
});
for (const key of ['accountSession', 'accountId', 'patternId', 'devConversationId', 'requestId']) {
  test(`scope change ${key} rejects late receipt and old save`, () => {
    const f = fixture(), ticket = f.start(); f.boundary.receive(ticket, suggestion); const draft = f.boundary.getDraft(), before = f.raw();
    f.setScope({ ...f.scope(), [key]: key === 'accountSession' ? {} : 'changed' });
    assert.equal(f.boundary.receive(ticket, suggestion), false); assert.equal(f.boundary.save(draft).status, 'stale');
    assert.equal(f.boundary.getDraft(), null); assert.equal(f.raw(), before); assert.equal(f.saveCalls(), 0);
  });
}
test('same-account logout/login with rotated host lifecycle cannot restore draft', () => {
  const f = fixture(), draft = f.receive(); f.repo.logout(); f.repo.login(f.repo.requestCode(DEMO_NUMBER));
  f.setScope({ ...f.scope(), accountSession: {} }); const before = f.raw();
  assert.equal(f.boundary.save(draft).status, 'stale'); assert.equal(f.raw(), before);
});
test('repository authorization catches logout even before host invalidation', () => {
  const f = fixture(), draft = f.receive(); f.repo.logout(); const before = f.raw();
  assert.equal(f.boundary.save(draft).status, 'failed'); assert.equal(f.raw(), before); assert.equal(f.saveCalls(), 0);
});
for (const method of ['invalidate', 'dispose']) {
  test(`${method} rejects queued receipts, edits and saves`, () => {
    const f = fixture(), ticket = f.start(); f.boundary.receive(ticket, suggestion); const draft = f.boundary.getDraft(), before = f.raw();
    f.boundary[method](); assert.equal(f.boundary.receive(ticket, suggestion), false);
    assert.equal(f.boundary.edit(draft, suggestion), false); assert.equal(f.boundary.save(draft).status, 'stale');
    assert.equal(f.boundary.getDraft(), null); assert.equal(f.raw(), before);
    assert.equal(!!f.boundary.begin(f.scope()), method !== 'dispose');
  });
}
test('new begin invalidates prior handle even with identical scope values; clones cannot act', () => {
  const f = fixture(), old = f.start(), current = f.start();
  assert.equal(f.boundary.receive(old, suggestion), false); assert.equal(f.boundary.receive({ ...current }, suggestion), false);
  assert.equal(f.boundary.receive(current, suggestion), true);
  assert.equal(f.boundary.save({ ...f.boundary.getDraft() }).status, 'stale');
});
for (const value of [null, 'understanding prose', { text: 'deep reply' }, {}, { ...suggestion, diagnostic: 'private' },
  { ...suggestion, thenAction: '' }, { ...suggestion, ifCue: ' ' }, { ...suggestion, ifCue: 'x'.repeat(201) },
  { ...suggestion, thenAction: 'x'.repeat(201) }, { ...suggestion, thenAction: 5 }, []]) {
  test(`reject malformed or non-structured candidate ${JSON.stringify(value).slice(0,65)}`, () => {
    const f = fixture(), ticket = f.start(), before = f.raw();
    assert.equal(f.boundary.receive(ticket, value), false); assert.equal(f.boundary.getDraft(), null); assert.equal(f.raw(), before);
    assert.equal(f.boundary.receive(ticket, suggestion), true);
  });
}
test('copies input and freezes read-only snapshots; mutation cannot redirect target or candidate', () => {
  const f = fixture(), originalScope = f.scope(), ticket = f.start(), content = { ...suggestion };
  f.boundary.receive(ticket, content); const draft = f.boundary.getDraft(); content.thenAction = 'mutated';
  assert.equal(draft.content.thenAction, suggestion.thenAction);
  assert.throws(() => { draft.content.thenAction = 'mutated'; });
  assert.throws(() => { ticket.scope.patternId = 'other'; });
  originalScope.patternId = 'other'; assert.equal(f.boundary.save(draft).status, 'stale');
});
for (const when of ['before-receive', 'before-save']) {
  for (const change of ['practice', 'understanding', 'decision-roundtrip']) {
    test(`version conflict ${change} ${when} never rebases or overwrites`, () => {
      const f = fixture(), ticket = f.start();
      if (when === 'before-save') f.boundary.receive(ticket, suggestion);
      const draft = f.boundary.getDraft();
      if (change === 'practice') f.repo.savePractice(f.accountId, f.patternId, { ifCue: 'newer', thenAction: 'newer' }, 0);
      else if (change === 'understanding') f.repo.updatePattern(f.accountId, f.patternId, { currentUnderstanding: 'newer' }, 1);
      else { f.repo.updatePattern(f.accountId, f.patternId, { decision: 'uncertain' }, 1); f.repo.updatePattern(f.accountId, f.patternId, { decision: 'confirmed' }, 2); }
      const before = f.raw();
      if (draft) { assert.equal(f.boundary.save(draft).status, 'failed'); assert.equal(f.boundary.getDraft(), draft); }
      else assert.equal(f.boundary.receive(ticket, suggestion), false);
      assert.equal(f.raw(), before); assert.equal(f.saveCalls(), 0);
    });
  }
}
test('saving to exact second pattern preserves first pattern active practice and data', () => {
  const f = fixture(); f.repo.savePractice(f.accountId, f.patternId, suggestion, 0); f.repo.activatePractice(f.accountId, f.patternId, 1);
  const original = f.state(); f.repo.createPattern(f.accountId, 'second');
  const second = f.repo.snapshot().patterns[1].pattern.patternId; f.setScope({ ...f.scope(), patternId: second });
  assert.equal(f.boundary.save(f.receive()).status, 'saved'); assert.deepEqual(f.state(), original);
  assert.equal(f.repo.getPattern(f.accountId, second).practice.paused, true); assert.equal(f.repo.snapshot().activePracticePatternId, f.patternId);
});
test('editing existing active practice preserves activation; never invokes activation operation', () => {
  const f = fixture(); f.repo.savePractice(f.accountId, f.patternId, suggestion, 0); f.repo.activatePractice(f.accountId, f.patternId, 1);
  assert.equal(f.boundary.save(f.receive()).status, 'saved'); assert.equal(f.state().practice.paused, false);
  assert.equal(f.repo.snapshot().activePracticePatternId, f.patternId);
});
test('unconfirmed target cannot start and no pattern is invented', () => {
  const f = fixture(); f.repo.updatePattern(f.accountId, f.patternId, { decision: 'uncertain' }, 1);
  const before = f.raw(); assert.equal(f.boundary.begin(f.scope()), null); assert.equal(f.raw(), before);
});
test('no live scope means no generation, receipt, draft or save', () => {
  const f = fixture(), scope = f.scope(), draft = f.receive(); f.setScope(null);
  assert.equal(f.boundary.getDraft(), null); assert.equal(f.boundary.save(draft).status, 'stale'); assert.equal(f.boundary.begin(scope), null);
});
