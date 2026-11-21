export const VERSION = 'EF383-C-v0.1-20261027';
export const STORAGE_KEY = 'emotionflow.ef383.synthetic.v1';
export const DECISIONS = ['candidate', 'confirmed', 'uncertain', 'rejected'];
const copy = x => JSON.parse(JSON.stringify(x));
const fail = error => ({ok:false,error});
const success = data => ({ok:true,data:copy(data)});
const kinds = ['situation','thought','feeling','behavior','exception'];
export function validPattern(p) {
  return !!p && p.schemaVersion===1 && typeof p.accountId==='string' && !!p.accountId &&
    typeof p.patternId==='string' && !!p.patternId && typeof p.name==='string' && p.name.length<=80 &&
    typeof p.currentUnderstanding==='string' && p.currentUnderstanding.length<=2000 &&
    DECISIONS.includes(p.decision) && p.demoSource==='synthetic' &&
    Array.isArray(p.clues) && p.clues.every(c=>c && kinds.includes(c.kind) && typeof c.text==='string' && typeof c.source==='string' && typeof c.userConfirmed==='boolean') &&
    typeof p.createdAt==='string' && Number.isFinite(Date.parse(p.createdAt)) &&
    typeof p.updatedAt==='string' && Number.isFinite(Date.parse(p.updatedAt));
}
export function fixtures() {
  const make=(accountId,patternId,name,understanding)=>({schemaVersion:1,accountId,patternId,name,currentUnderstanding:understanding,decision:'candidate',demoSource:'synthetic',clues:[],createdAt:'2026-10-27T00:00:00.000Z',updatedAt:'2026-10-27T00:00:00.000Z'});
  return [make('demo-account-a','pattern-one','整理前先想排得整齐','有时整理三本虚构的书之前，我会先想怎样摆放。这里只留作候选。'),make('demo-account-a','pattern-two','看书脊找书','这是另一条独立的合成模式。'),make('demo-account-b','pattern-one','账户 B 的合成模式','这属于另一个虚构账户，不能被账户 A 修改。')];
}
// A local synthetic adapter, not EF376 login or the shared Epic repository.
// Storage must provide synchronous getItem/setItem. Each write is one atomic local setItem.
export function createRepository({storage,session,clock=()=>Date.now()}={}) {
  function authorized(a) {try{return typeof a==='string' && !!a && session()===a;}catch{return false;}}
  function load() {
    const raw=storage.getItem(STORAGE_KEY);
    if(raw===null)return [];
    const decoded=JSON.parse(raw);
    if(decoded.schemaVersion!==1 || !Array.isArray(decoded.patterns) || !decoded.patterns.every(validPattern))throw Error('invalid');
    const keys=new Set(decoded.patterns.map(p=>JSON.stringify([p.accountId,p.patternId])));
    if(keys.size!==decoded.patterns.length)throw Error('duplicate');
    return decoded.patterns;
  }
  return Object.freeze({
    async listPatterns(a) {if(!authorized(a))return fail('unauthenticated');try{return success(load().filter(p=>p.accountId===a));}catch{return fail('unavailable');}},
    async getPattern(a,id) {if(!authorized(a))return fail('unauthenticated');try {const p=load().find(p=>p.accountId===a&&p.patternId===id);return p?success(p):fail('not_found');}catch{return fail('unavailable');}},
    async updatePattern(a,id,patch,expectedUpdatedAt) {
      if(!authorized(a))return fail('unauthenticated');
      try {
        if(!patch || Object.getPrototypeOf(patch)!==Object.prototype || Object.keys(patch).some(k=>!['name','currentUnderstanding','decision'].includes(k)))return fail('unavailable');
        const all=load(), index=all.findIndex(p=>p.accountId===a&&p.patternId===id);
        if(index<0)return fail('not_found');
        const previous=all[index];
        if(previous.updatedAt!==expectedUpdatedAt)return fail('conflict');
        const next={...previous,...patch,updatedAt:new Date(Math.max(clock(),Date.parse(previous.updatedAt)+1)).toISOString()};
        if(!validPattern(next) || !next.name.trim())return fail('unavailable');
        if(!authorized(a))return fail('unauthenticated');
        all[index]=next;
        storage.setItem(STORAGE_KEY,JSON.stringify({schemaVersion:1,patterns:all}));
        return success(next);
      } catch {return fail('unavailable');}
    }
  });
}
export function createEditor({repository,session,onChange=()=>{},onSaved=()=>{}}={}) {
  const activeAccount=()=>{try{return session();}catch{return null;}};
  let generation=0, state={phase:'closed',saved:null,draft:null,error:null,notice:''};
  const view=()=>copy(state);
  const publish=()=>{try{onChange(view());}catch{/* host render must not cause another write */}return view();};
  const error=e=>['not_found','unauthenticated','unavailable','conflict'].includes(e)?e:'unavailable';
  const match=(p,a,id)=>validPattern(p)&&p.accountId===a&&p.patternId===id;
  function invalidate(){generation++;state={phase:'closed',saved:null,draft:null,error:null,notice:'已取消，未保存的修改已丢弃。'};return publish();}
  async function open(a,id) {
    const g=++generation;
    state={phase:'loading',saved:null,draft:null,error:null,notice:''};publish();
    if(!a || activeAccount()!==a){state.phase='error';state.error='unauthenticated';return publish();}
    let result;try{result=await repository.getPattern(a,id);}catch{result=fail('unavailable');}
    if(g!==generation)return view();
    if(activeAccount()!==a){state.phase='error';state.error='unauthenticated';return publish();}
    if(!result?.ok || !match(result.data,a,id)){state.phase='error';state.error=error(result?.error);return publish();}
    state={phase:'editing',saved:copy(result.data),draft:{name:result.data.name,currentUnderstanding:result.data.currentUnderstanding,decision:result.data.decision},error:null,notice:''};return publish();
  }
  function edit(field,value) {
    if(state.phase!=='editing' || !['name','currentUnderstanding'].includes(field) || typeof value!=='string')return view();
    state.draft[field]=value;state.error=null;state.notice='';return publish();
  }
  function decide(value) {
    if(state.phase!=='editing' || !DECISIONS.includes(value))return view();
    state.draft.decision=value;state.error=null;state.notice='';return publish();
  }
  async function save() {
    if(state.phase!=='editing' || !state.saved || !state.draft)return view();
    if(!state.draft.name.trim() || state.draft.name.length>80 || state.draft.currentUnderstanding.length>2000){state.notice='未保存：请填写 1–80 字的名称，当前理解最多 2000 字，可留空。';return publish();}
    const a=state.saved.accountId,id=state.saved.patternId,g=generation,original=copy(state.saved),draft=copy(state.draft);
    if(activeAccount()!==a){state.error='unauthenticated';return publish();}
    const patch={};for(const k of ['name','currentUnderstanding','decision'])if(draft[k]!==original[k])patch[k]=draft[k];
    state.phase='saving';state.error=null;state.notice='正在保存，请稍候。';publish();
    let result;try{result=await repository.updatePattern(a,id,patch,original.updatedAt);}catch{result=fail('unavailable');}
    if(g!==generation)return view();
    state.phase='editing';state.notice='';
    if(activeAccount()!==a){state.error='unauthenticated';return publish();}
    if(!result?.ok){state.error=error(result?.error);return publish();}
    const p=result.data;
    const expected={...original,...patch};
    if(!match(p,a,id) || ['name','currentUnderstanding','decision','createdAt','demoSource','schemaVersion'].some(k=>p[k]!==expected[k]) || JSON.stringify(p.clues)!==JSON.stringify(original.clues) || Date.parse(p.updatedAt)<=Date.parse(original.updatedAt)) {state.error='unavailable';return publish();}
    state.saved=copy(p);state.draft={name:p.name,currentUnderstanding:p.currentUnderstanding,decision:p.decision};state.notice='已保存你的修改。';
    try{onSaved(copy(p));}catch{state.notice='已保存；宿主显示未同步，可重新打开核对。';}
    return publish();
  }
  async function refreshBase() {
    if(state.phase!=='editing' || !state.saved)return view();
    const a=state.saved.accountId,id=state.saved.patternId,g=generation,draft=copy(state.draft);
    state.phase='loading';publish();let r;try{r=await repository.getPattern(a,id);}catch{r=fail('unavailable');}
    if(g!==generation)return view();
    state.phase='editing';
    if(activeAccount()!==a){state.error='unauthenticated';return publish();}
    if(!r?.ok || !match(r.data,a,id)){state.error=error(r?.error);return publish();}
    state.saved=copy(r.data);state.draft=draft;state.error=null;state.notice='已读取最新已存版本，保留你的草稿。请核对后再保存。';return publish();
  }
  return Object.freeze({view,open,edit,decide,save,refreshBase,cancel:()=>state.phase==='saving'||state.phase==='loading'?view():invalidate(),close:invalidate,sessionChanged:invalidate});
}
