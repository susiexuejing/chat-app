import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { createIntegrated } from './integration.mjs';
import { CHAT_INPUT, PATTERN_ID } from './journey.mjs';
import { STORAGE_KEY } from './vendor/editor.mjs';

const key = 'emotionflow.ef377.integrated.v1.' + STORAGE_KEY;
function memory() {
  const values = new Map();
  let fail = false;
  return {
    getItem: k => values.get(k) ?? null,
    setItem(k, value) { if (fail) { fail = false; throw Error('write failed'); } values.set(k, value); },
    failNext() { fail = true; },
    raw: () => values.get(key),
    data: () => JSON.parse(values.get(key)),
  };
}
function ready() {
  const storage = memory();
  const app = createIntegrated(storage, { now: () => Date.parse('2026-11-06T10:00:00Z'), random: () => .5 });
  const accountId = app.auth.verify(app.auth.request('00000000000')).id;
  assert.equal(app.journey.confirm('原来的合成理解').ok, true);
  return { storage, app, accountId };
}
const corrections = storage => storage.data().journey.entries.filter(row => row.type === 'correction');

test('understanding edit and history commit atomically; failure keeps draft and retry adds exactly one entry', async () => {
  const { storage, app, accountId } = ready();
  await app.editor.open(accountId, PATTERN_ID);
  app.editor.edit('currentUnderstanding', '新的合成理解');
  const before = storage.raw();
  storage.failNext();
  assert.equal((await app.editor.save()).error, 'unavailable');
  assert.equal(storage.raw(), before);
  assert.equal(app.editor.view().draft.currentUnderstanding, '新的合成理解');
  assert.equal((await app.editor.save()).error, null);
  assert.equal(corrections(storage).length, 1);
  assert.equal(corrections(storage)[0].oldUnderstanding, '原来的合成理解');
  assert.equal(corrections(storage)[0].currentUnderstanding, '新的合成理解');
  assert.equal(corrections(storage)[0].accountId, accountId);
  assert.equal(corrections(storage)[0].patternId, PATTERN_ID);
  assert.equal(storage.data().patterns[0].currentUnderstanding, '新的合成理解');
  assert.equal((await app.editor.save()).error, null);
  assert.equal(corrections(storage).length, 1);
});

test('name-only edit and cancelled understanding edit do not create history', async () => {
  const { storage, app, accountId } = ready();
  await app.editor.open(accountId, PATTERN_ID);
  app.editor.edit('currentUnderstanding', '不应保存');
  app.editor.cancel();
  assert.equal(corrections(storage).length, 0);
  await app.editor.open(accountId, PATTERN_ID);
  app.editor.edit('name', '合成名称');
  assert.equal((await app.editor.save()).error, null);
  assert.equal(corrections(storage).length, 0);
});

test('later explicit chat confirmations append ordered history without changing earlier revisions', () => {
  const { storage, app } = ready();
  assert.equal(app.journey.confirm('第二版合成理解').ok, true);
  const first = structuredClone(corrections(storage)[0]);
  assert.equal(app.journey.confirm('第三版合成理解').ok, true);
  const history = corrections(storage);
  assert.equal(history.length, 2);
  assert.deepEqual(history[0], first);
  assert.equal(history[1].oldUnderstanding, '第二版合成理解');
  assert.equal(history[1].currentUnderstanding, '第三版合成理解');
  assert.ok(history[1].createdAt > history[0].createdAt);
  assert.notEqual(history[0].entryId, history[1].entryId);
  assert.equal(app.journey.confirm('第三版合成理解').ok, true);
  assert.equal(corrections(storage).length, 2);
});

test('stale editor write and post-logout writes cannot append history', async () => {
  const { storage, app, accountId } = ready();
  await app.editor.open(accountId, PATTERN_ID);
  app.editor.edit('currentUnderstanding', '迟到的理解');
  assert.equal(app.journey.confirm('已经保存的新理解').ok, true);
  const before = storage.raw();
  assert.equal((await app.editor.save()).error, 'conflict');
  assert.equal(storage.raw(), before);
  app.logout();
  assert.equal(app.journey.confirm('退出后的理解').error, 'unauthenticated');
  assert.equal(storage.raw(), before);
});

test('path feeling failure/retry is atomic, versioned and cannot rewrite facts or understanding history', async () => {
  const { storage, app, accountId } = ready(), path = app.journey.path;
  await path.open(accountId, PATTERN_ID);
  const before = storage.raw();
  storage.failNext();
  assert.equal((await path.save('evt-1', { feeling: '合成感受', explanation: '合成说明' }, 1)).ok, false);
  assert.equal(storage.raw(), before);
  assert.equal((await path.save('evt-1', { feeling: '合成感受', explanation: '合成说明' }, 1)).ok, true);
  const saved = storage.raw();
  assert.equal((await path.save('evt-1', { feeling: '迟到' }, 1)).error, 'conflict');
  for (const patch of [null, { feeling: 'x'.repeat(1001) }, { feeling: 1 }, { fact: '伪造事实' }, { oldUnderstanding: '改写历史' }]) {
    assert.equal((await path.save('evt-1', patch, 2)).error, 'invalid');
    assert.equal(storage.raw(), saved);
  }
  assert.equal((await path.save('evt-1', { feeling: '' }, 2)).ok, true);
  assert.equal(storage.data().journey.entries[0].feeling, '');
});

test('path remains account/mode scoped and history survives same-account return', async () => {
  const { storage, app, accountId } = ready(), path = app.journey.path;
  app.journey.confirm('新理解');
  const before = storage.raw();
  await path.open('other-account', PATTERN_ID);
  assert.equal((await path.save('evt-1', { feeling: 'wrong account' }, 1)).ok, false);
  assert.equal(storage.raw(), before);
  await path.open(accountId, 'other-pattern');
  assert.equal((await path.save('evt-1', { feeling: 'wrong pattern' }, 1)).ok, false);
  assert.equal(storage.raw(), before);
  app.logout();
  const restored = createIntegrated(storage);
  assert.equal(restored.auth.verify(restored.auth.request('00000000000')).id, accountId);
  await restored.journey.path.open(accountId, PATTERN_ID);
  assert.equal(restored.journey.path.snapshot().entries.filter(e => e.type === 'correction').length, 1);
});

const html = readFileSync(new URL('./EmotionFlow-EF377-Integrated.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function ui(storage = memory()) {
  let markup = '', nodes = {}, cards = [];
  const nav = { 'chat-nav': {}, 'me-nav': {} };
  const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const root = {
    set innerHTML(value) {
      markup = value;
      nodes = {};
      for (const match of value.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
        const initial = match[1] === 'textarea' ? value.slice(match.index + match[0].length).split('</textarea>')[0]
          : match[0].match(/\bvalue="([^"]*)"/)?.[1] ?? '';
        nodes[match[2]] = { value: decode(initial) };
      }
      cards = [...value.matchAll(/<button class="card pattern" data-index="(\d+)"/g)].map(([, index]) => ({ dataset: { index } }));
    },
    querySelectorAll: () => cards,
  };
  vm.runInNewContext(script, {
    document: { getElementById: id => id === 'root' ? root : nav[id] ?? nodes[id] ?? null },
    window: { localStorage: storage, confirm: () => true }, Date, Math, structuredClone,
  });
  return {
    storage, get html() { return markup; }, has: id => !!nodes[id], value: id => nodes[id]?.value,
    async click(id) { assert.ok((nav[id] ?? nodes[id])?.onclick, id); await (nav[id] ?? nodes[id]).onclick(); },
    enter(id, value) { assert.ok(nodes[id], id); nodes[id].value = value; nodes[id].oninput?.({ target: nodes[id] }); },
    async login() {
      await this.click('login'); this.enter('number', '00000000000');
      await nodes['number-form'].onsubmit({ preventDefault() {} });
      this.enter('code', markup.match(/class="code">(\d{6})/)[1]);
      await nodes['code-form'].onsubmit({ preventDefault() {} });
    },
    async confirm() {
      await this.click('chat-nav'); this.enter('chat-input', CHAT_INPUT); await this.click('chat-send');
      await this.click('candidate-edit'); this.enter('candidate-text', '原来的合成理解'); await this.click('candidate-save');
    },
    async firstPattern() { await cards[0].onclick(); },
  };
}

test('generated HTML saves every agreed/other feeling choice and clears downstream choices', async () => {
  const u = ui(); await u.login(); await u.confirm();
  await u.click('practice-edit'); await u.click('practice-save');
  for (const action of ['agreed', 'other']) for (const feeling of ['helped', 'unchanged', 'worse', 'not_recorded']) {
    await u.click('record-open'); await u.click('occurred-yes'); await u.click('action-' + action);
    await u.click('feeling-' + feeling);
    const before = u.storage.raw(); u.storage.failNext(); await u.click('record-save');
    assert.equal(u.storage.raw(), before); assert.ok(u.has('record-save'));
    await u.click('record-save');
    const row = u.storage.data().journey.records.at(-1);
    assert.equal(row.action, action); assert.equal(row.feeling, feeling);
  }
  assert.equal(u.storage.data().journey.records.length, 8);
  await u.click('path-open'); assert.match(u.html, /做了别的动作 → 不想记录感受/);
  await u.click('record-open'); await u.click('occurred-yes'); await u.click('action-other'); await u.click('feeling-helped');
  await u.click('action-none'); assert.equal(u.has('feeling-helped'), false);
  await u.click('action-other'); assert.doesNotMatch(u.html, /已选：有一点帮助/);
  await u.click('occurred-no'); assert.equal(u.has('action-other'), false); assert.equal(u.has('feeling-helped'), false);
  const before = u.storage.raw(); await u.click('record-skip'); assert.equal(u.storage.raw(), before);
});

test('generated HTML reviews both understanding versions after explicit edit and return', async () => {
  const u = ui(); await u.login(); await u.confirm();
  await u.click('edit'); u.enter('understanding', '新的合成理解');
  u.storage.failNext(); const before = u.storage.raw(); await u.click('save-edit');
  assert.equal(u.storage.raw(), before); assert.equal(u.value('understanding'), '新的合成理解');
  await u.click('save-edit'); await u.click('path-open');
  assert.match(u.html, /理解修正/); assert.match(u.html, /原来的理解：原来的合成理解/);
  assert.match(u.html, /这次保存的理解：新的合成理解/);
  await u.click('me-nav'); await u.click('logout'); await u.login(); await u.click('list'); await u.firstPattern(); await u.click('path-open');
  assert.match(u.html, /原来的理解：原来的合成理解/); assert.match(u.html, /这次保存的理解：新的合成理解/);
});

test('generated HTML feeling edit, cancellation, failed save and retry preserve original facts', async () => {
  const u = ui(); await u.login(); await u.confirm(); await u.click('path-open');
  const before = u.storage.raw(); await u.click('path-edit-0');
  u.enter('path-feeling', '不应保存'); await u.click('path-cancel'); assert.equal(u.storage.raw(), before);
  await u.click('path-edit-0'); u.enter('path-feeling', '<img src=x>合成感受'); u.enter('path-text', '合成说明');
  u.storage.failNext(); await u.click('path-save-0'); assert.equal(u.storage.raw(), before);
  assert.equal(u.value('path-feeling'), '<img src=x>合成感受'); assert.equal(u.value('path-text'), '合成说明');
  await u.click('path-save-0'); assert.match(u.html, /补充／修正感受：&lt;img src=x&gt;合成感受/);
  assert.doesNotMatch(u.html, /<img src=x>/);
  assert.equal(u.storage.data().journey.entries[0].fact, JSON.parse(before).journey.entries[0].fact);
});

test('generated HTML labels an existing synthetic exception and renders old/new correction text safely; no automatic exceptions', async () => {
  const { storage, app, accountId } = ready();
  assert.equal(storage.data().journey.entries.some(e => e.type === 'exception'), false);
  const data = storage.data();
  data.journey.entries.push({ schemaVersion: 1, demoSource: 'synthetic', accountId, patternId: PATTERN_ID,
    entryId: 'test-exception', type: 'exception', createdAt: '2026-11-06T11:00:00Z', linked: true, version: 1,
    fact: '固定合成例外', source: '测试夹具', userConfirmed: true });
  storage.setItem(key, JSON.stringify(data));
  app.journey.confirm('<script>合成修正</script>');
  const u = ui(storage); await u.click('list'); await u.firstPattern(); await u.click('path-open');
  assert.match(u.html, /例外 · test-exception/); assert.match(u.html, /原来的理解：原来的合成理解/);
  assert.match(u.html, /这次保存的理解：&lt;script&gt;合成修正&lt;\/script&gt;/);
  assert.doesNotMatch(u.html, /<script>合成修正/);
});
