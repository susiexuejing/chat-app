'use strict';
/* global module */
/**
 * Local-only journey repository adapted from PR #160, fixed reference SHA:
 * 519b67ddc476751c43f76f439ddeb5ed75cee701
 * https://github.com/susiexuejing/chat-app/pull/160
 * Sources: journey.mjs, integration.mjs, vendor/auth.mjs, vendor/practice.mjs,
 * vendor/editor.mjs. No API calls, credentials, real accounts, or live chat keys.
 * EF-385 provenance is retained without claiming an upstream provider/model.
 *
 * V2 stores separate pattern aggregates. V1 is read-only and never deleted.
 * Conversion is in-memory until one successful atomic setItem of the whole v2
 * aggregate. Its private legacySource checkpoint detects subsequent old-tab
 * writes, including after reload. Corrupt v2 never falls back to stale v1.
 * Each write rechecks both source strings, but localStorage has no lock/CAS:
 * this is still a one-active-tab demo, not concurrent-tab-safe storage.
 * A rollback to old code cannot see v2 changes. Keep v2 and do not run old and
 * new writers together; deleting v2 is not a supported rollback/migration.
 */
const LEGACY_STORAGE_KEY = 'emotionflow.ef384.native.v1';
const STORAGE_KEY = 'emotionflow.ef384.native.v2';
const DEMO_NUMBER = '00000000000';
const ACCOUNT_ID = 'ef384-synthetic-account';
const CHAT_INPUT = '最近太累了，总觉得自己做得不够好。';
const CANDIDATE = '累的时候，会不会容易先把责任揽到自己身上？';
// Historical IDs only. New patterns never reuse the legacy identity.
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
const owned = (x, patternId) => plain(x) && x.accountId === ACCOUNT_ID && x.patternId === patternId;
const validOrigin = x => keys(x, ['input','requestId']) && text(x.input,1000) && typeof x.requestId === 'string' && /^[\w-]{1,100}$/.test(x.requestId);
const validCandidateOrigin = x => keys(x, ['kind','sessionId','devConversationId','requestId']) && x.kind === 'ai-suggestion'
  && ['sessionId','devConversationId','requestId'].every(key => typeof x[key] === 'string' && /^[\w-]{1,100}$/.test(x[key]));
const marked = (x, patternId) => owned(x,patternId) && x.schemaVersion === 1 && ['synthetic','dev-api-test'].includes(x.demoSource)
  && (x.origin === undefined || (x.demoSource === 'dev-api-test' && validOrigin(x.origin)));
function validPayload(x) {
  return plain(x) && typeof x.occurred === 'boolean' && text(x.note === undefined ? '' : x.note, 200, true)
    && (!x.occurred ? x.action === null && x.feeling === null
      : x.action === 'none' ? x.feeling === null
        : ['agreed', 'other'].includes(x.action) && ['helped', 'unchanged', 'worse', 'not_recorded'].includes(x.feeling));
}
// Optional only for pre-existing records; never infer missing history from current practice.
const validPracticeSnapshot = x => keys(x,['ifCue','thenAction']) && text(x.ifCue,200) && text(x.thenAction,200);
function validateState(s, accountId, legacy = false) {
  requireThat(keys(s,['pattern','practice','records','path']));
  const p = s.pattern, q = s.practice, id = p?.patternId;
  requireThat(accountId === ACCOUNT_ID && text(id,150) && (!legacy || id === PATTERN_ID));
  requireThat(marked(p,id) && (p.demoSource !== 'dev-api-test' || validOrigin(p.origin)) && text(p.name,80) && text(p.currentUnderstanding,2000,true) && decisions.includes(p.decision) && version(p.version) && stamp(p.createdAt) && stamp(p.updatedAt));
  // Read only factual, explicitly attributed clues. Nothing infers or seeds them.
  requireThat(Array.isArray(p.clues) && p.clues.every(c => keys(c,['schemaVersion','demoSource','origin','accountId','patternId','clueId','kind','fact','source','userConfirmed']) && marked(c,id) && text(c.clueId,150) && ['situation','thought','feeling','behavior','exception'].includes(c.kind) && text(c.fact,2000) && (c.source === undefined || c.source === null || text(c.source,200,true)) && (c.userConfirmed === undefined || c.userConfirmed === null || typeof c.userConfirmed === 'boolean')));
  requireThat(new Set(p.clues.map(c=>c.clueId)).size === p.clues.length);
  requireThat(q === null || (owned(q,id) && text(q.practiceId,150) && (!legacy || q.practiceId === PRACTICE_ID) && (q.demoSource === undefined || ['synthetic','dev-api-test'].includes(q.demoSource)) && (q.origin === undefined || (q.demoSource === 'dev-api-test' && validOrigin(q.origin))) && (q.candidateOrigin === undefined || validCandidateOrigin(q.candidateOrigin)) && text(q.name,80) && text(q.ifCue,200) && text(q.thenAction,200) && q.confirmed === true && typeof q.paused === 'boolean' && version(q.version)));
  requireThat(Array.isArray(s.records) && Array.isArray(s.path) && (!s.records.length || !!q));
  requireThat(s.records.every(r => marked(r,id) && r.practiceId === q.practiceId && version(r.practiceVersion) && r.practiceVersion <= q.version && text(r.recordId,150) && text(r.operationId,100) && stamp(r.createdAt) && validPayload(r) && (r.practiceSnapshot === undefined || validPracticeSnapshot(r.practiceSnapshot))));
  requireThat(new Set(s.records.map(r=>r.recordId)).size === s.records.length && new Set(s.records.map(r=>r.operationId)).size === s.records.length);
  requireThat(s.path.every(e => marked(e,id) && text(e.entryId,150) && ['event','correction','practice','exception'].includes(e.type) && text(e.fact,2000) && text(e.source,200) && e.userConfirmed === true && typeof e.linked === 'boolean' && version(e.version) && stamp(e.createdAt) && (e.explanation === undefined || text(e.explanation,1000,true)) && (e.feeling === undefined || text(e.feeling,1000,true)) && (e.type !== 'correction' || (text(e.oldUnderstanding,2000,true) && text(e.currentUnderstanding,2000,true))) && (e.type !== 'practice' || s.records.some(r=>r.recordId === e.recordId && e.entryId === r.recordId))));
  requireThat(new Set(s.path.map(e=>e.entryId)).size === s.path.length);
  requireThat(s.records.every(r=>s.path.filter(e=>e.type === 'practice' && e.recordId === r.recordId).length === 1));
  requireThat(s.path.filter(e=>e.type === 'event' && e.entryId === 'evt-1').length === 1);
}
function validateAccount(d) {
  requireThat(Number.isSafeInteger(d.revision) && d.revision >= 0);
  requireThat([null, ACCOUNT_ID].includes(d.accountId) && [null, ACCOUNT_ID].includes(d.session) && (!d.session || d.accountId === d.session));
}
const empty = legacySource => ({schemaVersion:2,revision:0,accountId:null,session:null,patterns:[],activePracticePatternId:null,legacySource});
function migrate(raw) {
  if (raw === null) return empty(null);
  const old = JSON.parse(raw);
  requireThat(keys(old,['schemaVersion','revision','accountId','session','pattern','practice','records','path']) && old.schemaVersion === 1);
  validateAccount(old);
  requireThat(Array.isArray(old.records) && Array.isArray(old.path));
  const s = {pattern:old.pattern,practice:old.practice,records:old.records,path:old.path};
  if (old.pattern === null) requireThat(old.practice === null && !old.records.length && !old.path.length);
  else validateState(s,old.accountId,true);
  return {schemaVersion:2,revision:old.revision,accountId:old.accountId,session:old.session,patterns:old.pattern === null ? [] : [s],activePracticePatternId:old.practice && !old.practice.paused ? old.pattern.patternId : null,legacySource:raw};
}
function validate(d) {
  requireThat(keys(d,['schemaVersion','revision','accountId','session','patterns','activePracticePatternId','legacySource']) && d.schemaVersion === 2 && (d.legacySource === null || typeof d.legacySource === 'string'));
  validateAccount(d);
  requireThat(Array.isArray(d.patterns));
  d.patterns.forEach(s=>validateState(s,d.accountId));
  requireThat(new Set(d.patterns.map(s=>s.pattern.patternId)).size === d.patterns.length);
  const active = d.patterns.filter(s=>s.practice && !s.practice.paused);
  requireThat(active.length <= 1 && d.activePracticePatternId === (active[0]?.pattern.patternId ?? null));
}
function createDemoRepository(storage, { now = () => Date.now(), random = () => Math.random() } = {}) {
  let challenge = null, lastCode = null, observedLegacy, seenV2 = false;
  const bases = new WeakMap();
  function read() {
    let raw, legacyRaw, d;
    try {
      raw = storage.getItem(STORAGE_KEY); legacyRaw = storage.getItem(LEGACY_STORAGE_KEY);
      d = raw === null ? migrate(legacyRaw) : JSON.parse(raw);
      validate(d);
    } catch { throw Error('本地演示数据无法读取；未覆盖原数据，请检查浏览器存储后重试。'); }
    requireThat((observedLegacy === undefined || observedLegacy === legacyRaw) && d.legacySource === legacyRaw && (!seenV2 || raw !== null), '旧版或其他页面已更改本地数据；已停止保存，请关闭旧页面并核对数据。原数据未覆盖。');
    observedLegacy = legacyRaw; seenV2 = seenV2 || raw !== null;
    bases.set(d,{raw,legacyRaw}); return d;
  }
  function view(d) {
    // In particular, never return the private checkpoint containing legacy data.
    return clone({schemaVersion:2,revision:d.revision,accountId:d.accountId,session:d.session,patterns:d.session ? d.patterns : [],activePracticePatternId:d.session ? d.activePracticePatternId : null});
  }
  function write(d) {
    const base = bases.get(d);
    d.revision += 1; validate(d);
    let current, legacyCurrent;
    try { current = storage.getItem(STORAGE_KEY); legacyCurrent = storage.getItem(LEGACY_STORAGE_KEY); }
    catch { throw Error('未保存，原内容未改变；请检查浏览器存储后重试。'); }
    requireThat(base && current === base.raw && legacyCurrent === base.legacyRaw, '本地版本已变化；未保存，请关闭其他页面并重新读取后核对草稿。');
    try { storage.setItem(STORAGE_KEY,JSON.stringify(d)); }
    catch { throw Error('未保存，原内容未改变；请检查浏览器存储后重试。'); }
    seenV2 = true; return view(d);
  }
  function authorized(accountId) {
    const d = read();
    requireThat(d.session === ACCOUNT_ID,'请先使用虚构演示号码登录。');
    requireThat(accountId === d.session,'找不到这条模式，或无权查看。');
    return d;
  }
  function selected(d,patternId) {
    const s = d.patterns.find(item=>item.pattern.patternId === patternId);
    requireThat(s,'找不到这条模式，或无权查看。'); return s;
  }
  function matches(actual,expected) { requireThat(Number.isSafeInteger(expected) && actual === expected,'已存版本已变化，请重新读取并核对草稿后重试。'); }
  function time(previous) { return new Date(Math.max(now(),previous ? Date.parse(previous)+1 : 0)).toISOString(); }
  function entry(s,type,entryId,extra,createdAt) {
    s.path.push({schemaVersion:1,demoSource:s.pattern.demoSource,...(s.pattern.origin ? {origin:clone(s.pattern.origin)} : {}),accountId:ACCOUNT_ID,patternId:s.pattern.patternId,entryId,type,createdAt,version:1,linked:true,userConfirmed:true,...extra});
  }
  function correction(d,s,old,next,createdAt) {
    if (old !== next) entry(s,'correction','correction-'+(d.revision+1),{fact:'用户明确保存的理解修正。',source:'用户确认修改',oldUnderstanding:old,currentUnderstanding:next},createdAt);
  }
  function newPattern(d,value,demoSource,origin,at) {
    // Revision-based IDs are unique even with a fixed clock/random source.
    let suffix = d.revision+1;
    requireThat(Number.isSafeInteger(suffix),'本地版本已达到上限；未保存，原数据未改变。');
    let patternId = 'pattern-'+suffix;
    while (d.patterns.some(s=>s.pattern.patternId === patternId)) {
      suffix++; requireThat(Number.isSafeInteger(suffix),'本地版本已达到上限；未保存，原数据未改变。');
      patternId = 'pattern-'+suffix;
    }
    const s = {pattern:{schemaVersion:1,demoSource,...(origin ? {origin} : {}),accountId:ACCOUNT_ID,patternId,name:'我想保留的理解',currentUnderstanding:value,decision:'confirmed',clues:[],createdAt:at,updatedAt:at,version:1},practice:null,records:[],path:[]};
    d.patterns.push(s); return s;
  }
  const api = {
    snapshot() { return view(read()); },
    getPattern(accountId,patternId) { return clone(selected(authorized(accountId),patternId)); },
    cancelCode() { challenge = null; },
    requestCode(number) {
      challenge = null;
      requireThat(typeof number === 'string' && number.trim() === DEMO_NUMBER,'仅可使用页面提供的虚构演示号码。');
      read(); const n = Math.floor(random()*1000000);
      requireThat(Number.isInteger(n) && n >= 0 && n < 1000000,'演示验证码生成失败，请重试。');
      let code = String(n).padStart(6,'0'); if (code === lastCode) code = String((n+1)%1000000).padStart(6,'0');
      lastCode = code; challenge = {code,expires:now()+300000,attempts:0}; return code;
    },
    login(code) {
      requireThat(challenge,'演示验证码已失效，请重新获取。');
      if (now() >= challenge.expires) { challenge = null; throw Error('演示验证码已过期，请重新获取。'); }
      if (code !== challenge.code) { challenge.attempts++; if (challenge.attempts >= 5) challenge = null; throw Error('验证码不正确，请重试或重新获取。'); }
      const d = read(); d.accountId = ACCOUNT_ID; d.session = ACCOUNT_ID;
      const result = write(d); challenge = null; return result;
    },
    logout() { const d = read(); d.session = null; const result = write(d); challenge = null; return result; },
    createPattern(accountId,value) {
      requireThat(text(value,2000)); const d = authorized(accountId), at = time();
      const s = newPattern(d,value.trim(),'synthetic',undefined,at);
      entry(s,'event','evt-1',{fact:'用户明确保存了一条合成理解。',source:'用户确认保存'},at);
      return write(d);
    },
    confirmDevUnderstanding(accountId,payload,expectedVersion,patternId) {
      requireThat(keys(payload,['text','input','requestId','relation']) && ['create-new','correct-current'].includes(payload.relation) && text(payload.text,2000) && validOrigin({input:payload.input,requestId:payload.requestId}));
      const create = payload.relation === 'create-new';
      requireThat(create ? patternId === undefined && expectedVersion === 0 : text(patternId,150),'请明确选择保存为新模式，或修正指定的已有模式。');
      const value = payload.text.trim(), origin = {input:payload.input.trim(),requestId:payload.requestId};
      const d = authorized(accountId), s = create ? null : selected(d,patternId);
      // Same completed turn is idempotent account-wide, never duplicated into
      // another pattern or reused to silently associate a different topic.
      const previousTurn = d.patterns.find(item=>item.pattern.origin?.requestId === origin.requestId);
      if (previousTurn) {
        requireThat((create || previousTurn === s) && previousTurn.pattern.origin.input === origin.input && previousTurn.pattern.currentUnderstanding === value,'这次请求标识已用于不同内容或另一条模式，请重新核对。');
        return view(d);
      }
      requireThat(!d.patterns.some(item=>item.path.some(e=>e.origin?.requestId === origin.requestId)),'这次请求已经保存，请查看现有路径。');
      matches(s?.pattern.version ?? 0,expectedVersion);
      const at = time(s?.pattern.updatedAt), source = 'DEV 服务端 Deep 回复（可能参考本次会话前文；上游供应商/模型未核验），用户编辑确认；仅保留选中输入与理解';
      if (s) {
        const previous = s.pattern.currentUnderstanding;
        Object.assign(s.pattern,{demoSource:'dev-api-test',origin,currentUnderstanding:value,decision:'confirmed',updatedAt:at,version:s.pattern.version+1});
        if (previous !== value) entry(s,'correction','correction-'+(d.revision+1),{fact:'用户明确保存的理解修正。',source,oldUnderstanding:previous,currentUnderstanding:value},at);
        entry(s,'event','dev-input-'+(d.revision+1),{fact:'用户明确保存的 DEV 测试输入：'+origin.input,source},at);
      } else {
        const created = newPattern(d,value,'dev-api-test',origin,at);
        entry(created,'event','evt-1',{fact:'用户明确保存的 DEV 测试输入：'+origin.input,source},at);
      }
      return write(d);
    },
    updatePattern(accountId,patternId,patch,expectedVersion) {
      requireThat(keys(patch,['name','currentUnderstanding','decision']) && Object.keys(patch).length > 0);
      if ('name' in patch) requireThat(text(patch.name,80));
      if ('currentUnderstanding' in patch) requireThat(text(patch.currentUnderstanding,2000,true));
      if ('decision' in patch) requireThat(decisions.includes(patch.decision));
      const d = authorized(accountId), s = selected(d,patternId); matches(s.pattern.version,expectedVersion);
      const at = time(s.pattern.updatedAt), next = {...s.pattern,...patch,version:expectedVersion+1,updatedAt:at};
      correction(d,s,s.pattern.currentUnderstanding,next.currentUnderstanding,at); s.pattern = next; return write(d);
    },
    savePractice(accountId,patternId,patch,expectedVersion) {
      requireThat(keys(patch,['ifCue','thenAction','candidateOrigin']) && (patch.candidateOrigin === undefined || validCandidateOrigin(patch.candidateOrigin)) && text(patch.ifCue,200) && text(patch.thenAction,200));
      const d = authorized(accountId), s = selected(d,patternId);
      requireThat(s.pattern.decision === 'confirmed','请先确认这条模式。'); matches(s.practice?.version ?? 0,expectedVersion);
      s.practice = {...(patch.candidateOrigin ? {candidateOrigin:clone(patch.candidateOrigin)} : {}),demoSource:s.pattern.demoSource,...(s.pattern.origin ? {origin:clone(s.pattern.origin)} : {}),accountId:ACCOUNT_ID,patternId,practiceId:s.practice?.practiceId ?? 'practice-'+patternId,name:s.practice?.name ?? '我确认的小练习',ifCue:patch.ifCue.trim(),thenAction:patch.thenAction.trim(),confirmed:true,paused:s.practice?.paused ?? true,version:expectedVersion+1};
      return write(d);
    },
    pausePractice(accountId,patternId,expectedVersion) {
      const d = authorized(accountId), s = selected(d,patternId); requireThat(s.practice,'请先确认保存练习。'); matches(s.practice.version,expectedVersion);
      s.practice.paused = true; s.practice.version++;
      if (d.activePracticePatternId === patternId) d.activePracticePatternId = null;
      return write(d);
    },
    activatePractice(accountId,patternId,expectedVersion) {
      const d = authorized(accountId), s = selected(d,patternId); requireThat(s.practice,'请先确认保存练习。'); matches(s.practice.version,expectedVersion);
      requireThat(s.pattern.decision === 'confirmed','请先确认这条模式。');
      requireThat(!d.activePracticePatternId || d.activePracticePatternId === patternId,'另一条模式的练习正在进行。请先到该模式明确暂停，再开始这个练习。');
      if (!s.practice.paused) return view(d);
      s.practice.paused = false; s.practice.version++; d.activePracticePatternId = patternId; return write(d);
    },
    saveRecord(accountId,patternId,payload,expectedPracticeVersion,operationId) {
      requireThat(keys(payload,['occurred','action','feeling','note']) && validPayload(payload) && text(operationId,100));
      const d = authorized(accountId), s = selected(d,patternId);
      const normalized = {occurred:payload.occurred,action:payload.action,feeling:payload.feeling,...(payload.note?.trim() ? {note:payload.note.trim()} : {})};
      const previous = s.records.find(r=>r.operationId === operationId);
      if (previous) {
        requireThat(previous.practiceVersion === expectedPracticeVersion && ['occurred','action','feeling','note'].every(k=>previous[k] === normalized[k]),'这次保存标识已用于另一条记录，请重新开始记录。');
        return view(d);
      }
      requireThat(s.pattern.decision === 'confirmed' && s.practice?.confirmed && !s.practice.paused && d.activePracticePatternId === patternId,'请先确认模式并开始练习；未开始或暂停的练习不能记录。');
      matches(s.practice.version,expectedPracticeVersion);
      const at = time(), recordId = 'record-'+(s.records.length+1), practiceSource = s.practice.demoSource ?? 'synthetic';
      s.records.push({schemaVersion:1,demoSource:practiceSource,accountId:ACCOUNT_ID,patternId,practiceId:s.practice.practiceId,practiceVersion:expectedPracticeVersion,practiceSnapshot:{ifCue:s.practice.ifCue,thenAction:s.practice.thenAction},recordId,operationId,createdAt:at,...normalized});
      entry(s,'practice',recordId,{demoSource:practiceSource,origin:practiceSource === 'dev-api-test' ? s.practice.origin : undefined,fact:'用户明确保存的练习记录。',source:'用户明确保存的练习记录',recordId},at);
      return write(d);
    },
    updatePath(accountId,patternId,entryId,patch,expectedVersion) {
      requireThat(keys(patch,['linked','explanation','feeling']) && Object.keys(patch).length > 0 && (!('linked' in patch) || typeof patch.linked === 'boolean') && ['explanation','feeling'].every(k=>!(k in patch) || text(patch[k],1000,true)));
      const d = authorized(accountId), s = selected(d,patternId), row = s.path.find(e=>e.entryId === entryId);
      requireThat(row,'找不到这条路径记录。'); matches(row.version,expectedVersion);
      Object.assign(row,patch,{version:expectedVersion+1}); return write(d);
    },
  };
  return Object.freeze(api);
}
module.exports = {STORAGE_KEY,LEGACY_STORAGE_KEY,DEMO_NUMBER,CHAT_INPUT,CANDIDATE,PATTERN_ID,PRACTICE_ID,PRACTICE_TEXT,createDemoRepository};
