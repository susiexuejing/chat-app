import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CHAT_INPUT } from './journey.mjs';

const build = readFileSync(new URL('EmotionFlow-EF377-Integrated.html', import.meta.url), 'utf8');
const script = build.match(/<script>([\s\S]*?)<\/script>/)[1];
assert.ok(build.includes('sha256-' + createHash('sha256').update(script).digest('base64')));
const data = new Map();
let failWrite = false;
const storage = {
  getItem: key => data.get(key) ?? null,
  setItem(key, value) {
    if (failWrite) { failWrite = false; throw Error('write failed'); }
    data.set(key, value);
  },
};
let html, elements, patterns, navigation;
function boot() {
  const root = {
    set innerHTML(value) {
      html = value;
      elements = Object.fromEntries([...value.matchAll(/\bid="([^"]+)"/g)].map(([,id]) => [id,{value:''}]));
      patterns = [...value.matchAll(/<button class="card pattern" data-index="(\d+)"/g)]
        .map(([,index]) => ({dataset:{index}}));
    },
    querySelectorAll: () => patterns,
  };
  navigation = { root, 'chat-nav': {}, 'me-nav': {} };
  vm.runInNewContext(script, {
    document: { getElementById: id => navigation[id] ?? elements[id] ?? null },
    window: { localStorage: storage, confirm: () => true },
    Date, Math, structuredClone,
  });
}
const click = id => (navigation[id] ?? elements[id]).onclick();
function enter(id, value) { const el = elements[id]; el.value = value; el.oninput?.({target:el}); }
const submit = id => elements[id].onsubmit({ preventDefault() {} });
const account = () => html.match(/账户 ID：([^<]+)/)?.[1];
const getCode = () => html.match(/class="code">(\d{6})/)[1];
const stored = () => [...data.values()].find(value => value.includes('"patterns"'));
async function login(wrong = false) {
  await click('login');
  enter('number','00000000000');
  await submit('number-form');
  const code = getCode();
  if (wrong) {
    enter('code',code === '000000' ? '000001' : '000000');
    await submit('code-form');
    assert.match(html,/验证码不正确/);
    assert.equal(data.size,0);
  }
  enter('code',code);
  await submit('code-form');
  assert.ok(account());
  return code;
}
async function candidate() {
  enter('chat-input',CHAT_INPUT);
  await click('chat-send');
  assert.match(html,/待观察候选/);
}

boot();
await login(true);
const firstAccount = account();
await click('list');
assert.equal(patterns.length,0);
await click('chat-nav');
enter('chat-input','非固定输入');
await click('chat-send');
assert.match(html,/未匹配/);
await candidate();
await click('candidate-reject');
assert.equal(stored(),undefined);
await candidate();
await click('candidate-edit');
enter('candidate-text','累时我容易先责备自己，想先停一下再看。');
failWrite = true;
await click('candidate-save');
assert.match(html,/未保存/);
assert.equal(stored(),undefined);
await click('candidate-save');
assert.match(html,/累时我容易先责备自己，想先停一下再看。/);
assert.ok(!stored().includes(CHAT_INPUT));

await click('edit');
enter('name','累时先暂停');
await click('save-edit');
assert.match(html,/累时先暂停/);
await click('practice-edit');
await click('practice-cancel');
assert.match(html,/等待你保存/);
await click('practice-edit');
failWrite = true;
await click('practice-save');
assert.match(html,/未保存/);
assert.ok(elements['practice-save']);
await click('practice-save');
assert.match(html,/当前练习/);
await click('record-open');
await click('occurred-no');
assert.equal(elements['action-agreed'],undefined);
await click('record-skip');
assert.equal(JSON.parse(stored()).journey.records.length,0);
await click('record-open');
await click('occurred-yes');
await click('action-none');
assert.equal(elements['feeling-helped'],undefined);
await click('action-agreed');
await click('feeling-helped');
const beforeRecord = stored();
failWrite = true;
await click('record-save');
assert.equal(stored(),beforeRecord);
assert.ok(elements['record-save']);
await click('record-save');
const {records} = JSON.parse(stored()).journey;
assert.equal(records.length,1);
assert.equal(records[0].practiceId,'practice-pause-10s-v1');
assert.equal(records[0].accountId,firstAccount);
assert.equal(records[0].patternId,'mode-fatigue-self-criticism-v1');
assert.equal(records[0].recordId,'record-1');
assert.equal('note' in records[0],false);

await click('path-open');
assert.match(html,/发生了 → 试了 → 有一点帮助/);
assert.match(html,/evt-1/);
const eventIndex = JSON.parse(stored()).journey.entries
  .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).findIndex(row=>row.entryId==='evt-1');
await click('path-edit-'+eventIndex);
enter('path-text','我确认这是我的观察。');
await click('path-save-'+eventIndex);
assert.match(html,/我确认这是我的观察。/);
const beforeRemove = stored();
failWrite = true;
await click('path-remove-'+eventIndex);
assert.equal(stored(),beforeRemove);
assert.match(html,/evt-1/);
await click('path-remove-'+eventIndex);
assert.doesNotMatch(html,/evt-1/);

await click('me-nav');
await click('logout');
await click('list');
assert.equal(patterns.length,0);
boot();
await login();
assert.equal(account(),firstAccount);
await click('list');
assert.equal(patterns.length,1);
await patterns[0].onclick();
assert.match(html,/累时先暂停/);
assert.match(html,/当前练习/);
await click('path-open');
assert.match(html,/发生了 → 试了 → 有一点帮助/);
assert.doesNotMatch(html,/evt-1/);
console.log('Integrated HTML Node DOM simulation passed: login, chat, mode, practice, record, path and same-account return, including failed writes and retry.');
