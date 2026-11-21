export const VERSION='EF379-PATH-v0.1';
const copy=v=>structuredClone(v);
const id=v=>typeof v==='string'&&v.trim()&&v.length<201;
const stamp='2026-10-29T08:00:00.000Z';
export const fixtures=[
 {entryId:'event-a',accountId:'demo-account-a',patternId:'demo-pattern-a',type:'event',createdAt:stamp,fact:'虚构事件：讨论稿件时收到修改意见。',source:'合成事件 A',userConfirmed:true,feeling:'有些紧张',explanation:'我把这次经历与收到意见时急着解释联系起来。',version:1},
 {entryId:'exception-a',accountId:'demo-account-a',patternId:'demo-pattern-a',type:'exception',createdAt:'2026-10-28T08:00:00.000Z',fact:'虚构例外：先问清楚修改点，再回应。',source:'合成例外 A',userConfirmed:true,version:1},
 {entryId:'correction-a',accountId:'demo-account-a',patternId:'demo-pattern-a',type:'correction',createdAt:'2026-10-27T08:00:00.000Z',fact:'虚构理解修正：不是每次都急着解释。',source:'合成用户修正',userConfirmed:true,oldUnderstanding:'我总会急着解释。',currentUnderstanding:'收到某些修改意见时，我有时急着解释；也有先问清楚的例外。',version:1},
 {entryId:'practice-a',accountId:'demo-account-a',patternId:'demo-pattern-a',type:'practice',createdAt:'2026-10-29T09:00:00.000Z',source:'合成练习保存记录',userConfirmed:true,record:{schemaVersion:1,accountId:'demo-account-a',patternId:'demo-pattern-a',recordId:'record-a',demoSource:'synthetic',occurred:true,action:'agreed',feeling:'unchanged',note:'虚构备注：先停了一下。',createdAt:'2026-10-29T09:00:00.000Z'},version:1},
 {entryId:'event-b',accountId:'demo-account-a',patternId:'demo-pattern-b',type:'event',createdAt:stamp,fact:'虚构事件 B：安排休息空档。',version:1},
 {entryId:'event-c',accountId:'demo-account-b',patternId:'demo-pattern-c',type:'event',createdAt:stamp,fact:'虚构账户 B 的独立事件。',version:1}
].map(e=>({...e,schemaVersion:1,demoSource:'synthetic',linked:true}));
export function createRepository(){let rows=copy(fixtures),failure=null;return{
 failNext(operation){failure=operation;},
 async list(accountId,patternId){if(!id(accountId))return{ok:false,error:'unauthenticated'};if(!id(patternId))return{ok:false,error:'not_found'};if(failure==='read'){failure=null;return{ok:false,error:'unavailable'}};return{ok:true,data:copy(rows.filter(e=>e.accountId===accountId&&e.patternId===patternId&&e.linked).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)))};},
 async update(accountId,patternId,entryId,patch,expectedVersion){if(!id(accountId))return{ok:false,error:'unauthenticated'};const e=rows.find(e=>e.accountId===accountId&&e.patternId===patternId&&e.entryId===entryId);if(!e)return{ok:false,error:'not_found'};if(e.version!==expectedVersion)return{ok:false,error:'conflict'};if(failure==='write'){failure=null;return{ok:false,error:'unavailable'}};
 if(!patch||Object.keys(patch).some(k=>!['feeling','explanation','linked'].includes(k))||Object.entries(patch).some(([k,v])=>k==='linked'?typeof v!=='boolean':typeof v!=='string'||v.length>1000))return{ok:false,error:'invalid'};
 Object.assign(e,patch,{version:e.version+1});return{ok:true,data:copy(e)};},
 inspect(){return copy(rows);}
};}
export class PathController{
 constructor(repository,onChange=()=>{}){this.repo=repository;this.notify=onChange;this.generation=0;this.state={status:'idle',entries:[],error:null};this.accountId=null;this.patternId=null;this.undo=null;}
 snapshot(){return copy(this.state)}
 set(s){this.state=s;this.notify(this.snapshot())}
 async open(accountId,patternId){const g=++this.generation;this.accountId=accountId;this.patternId=patternId;this.undo=null;if(!id(accountId)){this.set({status:'error',entries:[],error:'unauthenticated'});return}this.set({status:'loading',entries:[],error:null});let r;try{r=await this.repo.list(accountId,patternId)}catch{r={ok:false,error:'unavailable'}}if(g!==this.generation)return;if(!r?.ok||!Array.isArray(r.data)||r.data.some(e=>e.accountId!==accountId||e.patternId!==patternId||e.demoSource!=='synthetic')){this.set({status:'error',entries:[],error:r?.error||'unavailable'});return}this.set({status:'ready',entries:copy(r.data),error:null});}
 async save(entryId,patch,version){const g=this.generation,a=this.accountId,p=this.patternId;let r;try{r=await this.repo.update(a,p,entryId,patch,version)}catch{r={ok:false,error:'unavailable'}}if(g!==this.generation)return{ok:false,error:'stale'};if(!r?.ok){this.set({...this.state,error:r?.error||'unavailable'});return r}if(patch.linked===false)this.undo={entryId,version:r.data.version};const undo=this.undo;await this.open(a,p);this.undo=undo;return r;}
 async restore(){if(!this.undo)return{ok:false,error:'not_found'};const u=this.undo;const r=await this.save(u.entryId,{linked:true},u.version);if(r?.ok)this.undo=null;return r;}
 leave(){++this.generation;this.accountId=null;this.patternId=null;this.undo=null;this.set({status:'idle',entries:[],error:null})}
}
