'use strict';
/* global module */
/**
 * Local-only journey repository adapted from PR #160, fixed reference SHA:
 * 519b67ddc476751c43f76f439ddeb5ed75cee701
 * https://github.com/susiexuejing/chat-app/pull/160
 * https://github.com/susiexuejing/chat-app/tree/519b67ddc476751c43f76f439ddeb5ed75cee701/demos/ef377/ef377-integrated-v01
 * Sources: journey.mjs, integration.mjs, vendor/auth.mjs, vendor/practice.mjs,
 * vendor/editor.mjs. No API calls, credentials, real accounts, or live chat keys.
 * EF-385 adds explicitly confirmed DEV-response provenance; legacy fixed
 * fixtures retain their original source and immutable facts.
 * One localStorage setItem atomically replaces the whole aggregate. Every write
 * rereads and checks versions, but localStorage provides no cross-tab lock/CAS.
 * This demo supports one active tab; it does not promise concurrent-tab safety.
 */
const STORAGE_KEY = 'emotionflow.ef384.native.v1';
const DEMO_NUMBER = '00000000000';
const ACCOUNT_ID = 'ef384-synthetic-account';
const CHAT_INPUT = '最近太累了，总觉得自己做得不够好。';
const CANDIDATE = '累的时候，会不会容易先把责任揽到自己身上？';
const PATTERN_ID = 'mode-fatigue-self-criticism-v1';
const PRACTICE_ID = 'practice-pause-10s-v1';
const PRACTICE_TEXT = '听到自责时，先叫儿子的名字，停十秒，回到眼前。';
const decisions = ['candidate', 'confirmed', 'uncertain', 'rejected'];
const clone = value => JSON.parse(JSON.stringify(value));
const plain = x => !!x && Object.getPrototypeOf(x) === Object.prototype;
const text = (x, max, empty = false) => typeof x === 'string' && x.length <= max && (empty || !!x.trim());
const version = x => Number.isSafeInteger(x) && x >= 1;
const stamp = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
const keys = (x, allowed) => plain(x) && Object.keys(x).every(k => allowed.includes(k));
function requireThat(ok, message = '内容无效，请检查后重试。') { if (!ok) throw Error(message); }
const owned = x => plain(x) && x.accountId === ACCOUNT_ID && x.patternId === PATTERN_ID;
const validOrigin = x => keys(x, ['input','requestId']) && text(x.input,1000) && typeof x.requestId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(x.requestId);
const marked = x => owned(x) && x.schemaVersion === 1 && ['synthetic','dev-api-test'].includes(x.demoSource)
  && (x.origin === undefined || (x.demoSource === 'dev-api-test' && validOrigin(x.origin)));
function validPayload(x) {
  return plain(x) && typeof x.occurred === 'boolean' && text(x.note === undefined ? '' : x.note, 200, true)
    && (!x.occurred ? x.action === null && x.feeling === null
      : x.action === 'none' ? x.feeling === null
        : ['agreed', 'other'].includes(x.action) && ['helped', 'unchanged', 'worse', 'not_recorded'].includes(x.feeling));
}
const empty = () => ({ schemaVersion: 1, revision: 0, accountId: null, session: null, pattern: null, practice: null, records: [], path: [] });
function validate(d) {
  requireThat(keys(d, ['schemaVersion','revision','accountId','session','pattern','practice','records','path']) && d.schemaVersion === 1 && Number.isSafeInteger(d.revision) && d.revision >= 0);
  requireThat([null, ACCOUNT_ID].includes(d.accountId) && [null, ACCOUNT_ID].includes(d.session) && (!d.session || d.accountId === d.session));
  requireThat(Array.isArray(d.records) && Array.isArray(d.path));
  const p = d.pattern, q = d.practice;
  requireThat(p === null || (d.accountId === ACCOUNT_ID && marked(p) && (p.demoSource !== 'dev-api-test' || validOrigin(p.origin)) && text(p.name,80) && text(p.currentUnderstanding,2000,true) && decisions.includes(p.decision) && Array.isArray(p.clues) && p.clues.length === 0 && version(p.version) && stamp(p.createdAt) && stamp(p.updatedAt)));
  requireThat(q === null || (p && owned(q) && q.practiceId === PRACTICE_ID && text(q.name,80) && text(q.ifCue,200) && text(q.thenAction,200) && q.confirmed === true && typeof q.paused === 'boolean' && version(q.version)));
  requireThat(!d.records.length || !!q);
  requireThat(!d.path.length || !!p);
  requireThat(d.records.every(r => marked(r) && r.practiceId === PRACTICE_ID && version(r.practiceVersion) && r.practiceVersion <= q.version && text(r.recordId,150) && text(r.operationId,100) && stamp(r.createdAt) && validPayload(r)));
  requireThat(new Set(d.records.map(r=>r.recordId)).size === d.records.length && new Set(d.records.map(r=>r.operationId)).size === d.records.length);
  requireThat(d.path.every(e => marked(e) && text(e.entryId,150) && ['event','correction','practice','exception'].includes(e.type) && text(e.fact,2000) && text(e.source,200) && e.userConfirmed === true && typeof e.linked === 'boolean' && version(e.version) && stamp(e.createdAt) && (e.explanation === undefined || text(e.explanation,1000,true)) && (e.feeling === undefined || text(e.feeling,1000,true)) && (e.type !== 'correction' || (text(e.oldUnderstanding,2000,true) && text(e.currentUnderstanding,2000,true))) && (e.type !== 'practice' || d.records.some(r=>r.recordId === e.recordId && e.entryId === r.recordId))));
  requireThat(new Set(d.path.map(e=>e.entryId)).size === d.path.length);
  requireThat(d.records.every(r=>d.path.filter(e=>e.type === 'practice' && e.recordId === r.recordId).length === 1));
  requireThat(!p || d.path.filter(e=>e.type === 'event' && e.entryId === 'evt-1').length === 1);
}
function createDemoRepository(storage, { now = () => Date.now(), random = () => Math.random() } = {}) {
  let challenge = null, lastCode = null;
  function read() {
    try { const raw = storage.getItem(STORAGE_KEY); const d = raw === null ? empty() : JSON.parse(raw); validate(d); return d; }
    catch { throw Error('本地演示数据无法读取；未覆盖原数据，请检查浏览器存储后重试。'); }
  }
  function view(d) { return clone(d.session ? d : { ...d, pattern: null, practice: null, records: [], path: [] }); }
  function write(d) {
    d.revision += 1; validate(d);
    try { storage.setItem(STORAGE_KEY, JSON.stringify(d)); }
    catch { throw Error('未保存，原内容未改变；请检查浏览器存储后重试。'); }
    return view(d);
  }
  function authorized() { const d = read(); requireThat(d.session === ACCOUNT_ID, '请先使用虚构演示号码登录。'); return d; }
  function hasPattern(d) { requireThat(d.pattern, '请先明确确认保存这条模式。'); }
  function matches(actual, expected) { requireThat(Number.isSafeInteger(expected) && actual === expected, '已存版本已变化，请重新读取并核对草稿后重试。'); }
  function time(previous) { return new Date(Math.max(now(), previous ? Date.parse(previous) + 1 : 0)).toISOString(); }
  function entry(d, type, entryId, extra, createdAt) {
    d.path.push({ schemaVersion:1,demoSource:d.pattern?.demoSource ?? 'synthetic',...(d.pattern?.origin ? {origin:clone(d.pattern.origin)} : {}),accountId:ACCOUNT_ID,patternId:PATTERN_ID,entryId,type,createdAt,version:1,linked:true,userConfirmed:true,...extra });
  }
  function correction(d, old, next, createdAt) {
    if (old !== next) entry(d,'correction','correction-'+(d.revision+1),{fact:'用户明确保存的理解修正。',source:'用户确认修改',oldUnderstanding:old,currentUnderstanding:next},createdAt);
  }
  const api = {
    snapshot() { return view(read()); },
    cancelCode() { challenge = null; },
    requestCode(number) {
      challenge = null;
      requireThat(typeof number === 'string' && number.trim() === DEMO_NUMBER, '仅可使用页面提供的虚构演示号码。');
      read(); const n = Math.floor(random()*1000000);
      requireThat(Number.isInteger(n) && n >= 0 && n < 1000000, '演示验证码生成失败，请重试。');
      let code = String(n).padStart(6,'0'); if (code === lastCode) code = String((n+1)%1000000).padStart(6,'0');
      lastCode = code; challenge = {code,expires:now()+300000,attempts:0}; return code;
    },
    login(code) {
      requireThat(challenge, '演示验证码已失效，请重新获取。');
      if (now() >= challenge.expires) { challenge = null; throw Error('演示验证码已过期，请重新获取。'); }
      if (code !== challenge.code) { challenge.attempts++; if (challenge.attempts >= 5) challenge = null; throw Error('验证码不正确，请重试或重新获取。'); }
      const d = read(); d.accountId = ACCOUNT_ID; d.session = ACCOUNT_ID;
      const result = write(d); challenge = null; return result;
    },
    logout() { const d = read(); d.session = null; const result = write(d); challenge = null; return result; },
    confirmPattern(value) {
      requireThat(text(value,2000)); const d = authorized(); const at = time(d.pattern?.updatedAt);
      if (d.pattern) { correction(d,d.pattern.currentUnderstanding,value.trim(),at); Object.assign(d.pattern,{currentUnderstanding:value.trim(),decision:'confirmed',updatedAt:at,version:d.pattern.version+1}); }
      else {
        d.pattern = { schemaVersion:1,demoSource:'synthetic',accountId:ACCOUNT_ID,patternId:PATTERN_ID,name:'累时容易先责备自己',currentUnderstanding:value.trim(),decision:'confirmed',clues:[],createdAt:at,updatedAt:at,version:1 };
        entry(d,'event','evt-1',{fact:'用户明确保存的合成事件：累的时候注意到自己先责备自己。',source:'用户确认保存'},at);
      }
      return write(d);
    },
    confirmDevUnderstanding(payload, expectedVersion) {
      requireThat(keys(payload,['text','input','requestId']) && text(payload.text,2000) && validOrigin({input:payload.input,requestId:payload.requestId}));
      const value = payload.text.trim(), origin = {input:payload.input.trim(),requestId:payload.requestId};
      const d = authorized();
      // A duplicate confirmation of the same completed turn is a no-op. A
      // reused request identity must never silently attach different content.
      if (d.pattern?.origin?.requestId === origin.requestId) {
        requireThat(d.pattern.origin.input === origin.input && d.pattern.currentUnderstanding === value, '这次请求标识已用于不同内容，请重新核对。');
        return view(d);
      }
      requireThat(!d.path.some(e=>e.origin?.requestId === origin.requestId), '这次请求已经保存，请查看现有路径。');
      matches(d.pattern?.version ?? 0,expectedVersion);
      const at = time(d.pattern?.updatedAt), previous = d.pattern?.currentUnderstanding;
      const source = 'DEV 服务端 Deep 回复（上游供应商/模型未核验），用户编辑确认';
      if (d.pattern) {
        Object.assign(d.pattern,{demoSource:'dev-api-test',origin,currentUnderstanding:value,decision:'confirmed',updatedAt:at,version:d.pattern.version+1});
        if (previous !== value) entry(d,'correction','correction-'+(d.revision+1),{fact:'用户明确保存的理解修正。',source,oldUnderstanding:previous,currentUnderstanding:value},at);
        entry(d,'event','dev-input-'+(d.revision+1),{fact:'用户明确保存的 DEV 测试输入：'+origin.input,source},at);
      } else {
        d.pattern = {schemaVersion:1,demoSource:'dev-api-test',origin,accountId:ACCOUNT_ID,patternId:PATTERN_ID,name:'我想保留的理解',currentUnderstanding:value,decision:'confirmed',clues:[],createdAt:at,updatedAt:at,version:1};
        entry(d,'event','evt-1',{fact:'用户明确保存的 DEV 测试输入：'+origin.input,source},at);
      }
      return write(d);
    },
    updatePattern(patch, expectedVersion) {
      requireThat(keys(patch,['name','currentUnderstanding','decision']) && Object.keys(patch).length > 0);
      if ('name' in patch) requireThat(text(patch.name,80));
      if ('currentUnderstanding' in patch) requireThat(text(patch.currentUnderstanding,2000,true));
      if ('decision' in patch) requireThat(decisions.includes(patch.decision));
      const d = authorized(); hasPattern(d); matches(d.pattern.version,expectedVersion);
      const at = time(d.pattern.updatedAt); const next = { ...d.pattern,...patch,version:expectedVersion+1,updatedAt:at };
      correction(d,d.pattern.currentUnderstanding,next.currentUnderstanding,at); d.pattern = next; return write(d);
    },
    savePractice(patch, expectedVersion) {
      requireThat(keys(patch,['ifCue','thenAction']) && text(patch.ifCue,200) && text(patch.thenAction,200));
      const d = authorized(); hasPattern(d); requireThat(d.pattern.decision === 'confirmed', '请先确认这条模式。'); matches(d.practice?.version ?? 0,expectedVersion);
      d.practice = {accountId:ACCOUNT_ID,patternId:PATTERN_ID,practiceId:PRACTICE_ID,name:d.pattern.demoSource === 'dev-api-test' ? '我确认的小练习' : '停十秒，回到眼前',ifCue:patch.ifCue.trim(),thenAction:patch.thenAction.trim(),confirmed:true,paused:d.practice?.paused ?? false,version:expectedVersion+1};
      return write(d);
    },
    pausePractice(expectedVersion) {
      const d = authorized(); requireThat(d.practice, '请先确认保存练习。'); matches(d.practice.version,expectedVersion);
      d.practice.paused = true; d.practice.version++; return write(d);
    },
    saveRecord(payload, expectedPracticeVersion, operationId) {
      requireThat(keys(payload,['occurred','action','feeling','note']) && validPayload(payload) && text(operationId,100));
      const d = authorized();
      const normalized = {occurred:payload.occurred,action:payload.action,feeling:payload.feeling,...(payload.note?.trim() ? {note:payload.note.trim()} : {})};
      const previous = d.records.find(r=>r.operationId === operationId);
      if (previous) {
        requireThat(previous.practiceVersion === expectedPracticeVersion && ['occurred','action','feeling','note'].every(k=>previous[k] === normalized[k]), '这次保存标识已用于另一条记录，请重新开始记录。');
        return view(d);
      }
      hasPattern(d); requireThat(d.pattern.decision === 'confirmed' && d.practice?.confirmed && !d.practice.paused, '请先确认模式和练习；暂停的练习不能记录。');
      matches(d.practice.version,expectedPracticeVersion);
      const at = time(); const recordId = 'record-'+(d.records.length+1);
      d.records.push({schemaVersion:1,demoSource:d.pattern.demoSource,accountId:ACCOUNT_ID,patternId:PATTERN_ID,practiceId:PRACTICE_ID,practiceVersion:expectedPracticeVersion,recordId,operationId,createdAt:at,...normalized});
      entry(d,'practice',recordId,{fact:'用户明确保存的练习记录。',source:'用户明确保存的练习记录',recordId},at);
      return write(d);
    },
    updatePath(entryId, patch, expectedVersion) {
      requireThat(keys(patch,['linked','explanation','feeling']) && Object.keys(patch).length > 0 && (!('linked' in patch) || typeof patch.linked === 'boolean') && ['explanation','feeling'].every(k=>!(k in patch) || text(patch[k],1000,true)));
      const d = authorized(); const row = d.path.find(e=>e.entryId === entryId); requireThat(row, '找不到这条路径记录。'); matches(row.version,expectedVersion);
      Object.assign(row,patch,{version:expectedVersion+1}); return write(d);
    },
  };
  return Object.freeze(api);
}
module.exports = { STORAGE_KEY,DEMO_NUMBER,CHAT_INPUT,CANDIDATE,PATTERN_ID,PRACTICE_ID,PRACTICE_TEXT,createDemoRepository };
