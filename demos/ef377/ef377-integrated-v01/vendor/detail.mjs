export const VERSION = 'EF382-DETAIL-v0.1';
export const KINDS = Object.freeze({situation:'情境',thought:'想法',feeling:'感受',behavior:'行为',exception:'例外'});
const validId = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f]/u.test(value);
const clone = value => structuredClone(value);
const decisions = new Set(['candidate','confirmed','uncertain','rejected']);
export function readPattern(value, accountId, patternId) {
  if (!value || value.schemaVersion !== 1 || value.accountId !== accountId || value.patternId !== patternId || value.demoSource !== 'synthetic' || !decisions.has(value.decision)) return null;
  if (value.name != null && typeof value.name !== 'string') return null;
  if (value.currentUnderstanding != null && typeof value.currentUnderstanding !== 'string') return null;
  if (value.clues != null && !Array.isArray(value.clues)) return null;
  const clues = (value.clues || []).filter(c => c && Object.hasOwn(KINDS,c.kind) && typeof c.text === 'string' && c.text.trim()).map(c => ({kind:c.kind,text:c.text,source:typeof c.source==='string'&&c.source.trim()?c.source:null,userConfirmed:typeof c.userConfirmed==='boolean'?c.userConfirmed:null}));
  return {schemaVersion:1,accountId,patternId,name:value.name??null,currentUnderstanding:value.currentUnderstanding??null,decision:value.decision,demoSource:'synthetic',clues,createdAt:typeof value.createdAt==='string'?value.createdAt:null,updatedAt:typeof value.updatedAt==='string'?value.updatedAt:null};
}
export class PatternDetail {
  #getPattern; #notify; #generation=0; #accountId=null; #patternId=null; #state={status:'idle',pattern:null,expanded:false,error:null};
  constructor({getPattern, onChange=()=>{}}) { if(typeof getPattern!=='function') throw new TypeError('getPattern required'); this.#getPattern=getPattern;this.#notify=onChange; }
  snapshot(){return clone(this.#state);}
  #set(state){this.#state=state;this.#notify(this.snapshot());}
  async open(accountId,patternId){
    const generation=++this.#generation;this.#accountId=accountId;this.#patternId=patternId;
    if(!validId(accountId)){this.#set({status:'error',pattern:null,expanded:false,error:'unauthenticated'});return;}
    if(!validId(patternId)){this.#set({status:'error',pattern:null,expanded:false,error:'not_found'});return;}
    this.#set({status:'loading',pattern:null,expanded:false,error:null});
    let result;
    try {result=await this.#getPattern(accountId,patternId);} catch {result={ok:false,error:'unavailable'};}
    if(generation!==this.#generation) return;
    if(result?.ok===true){
      let pattern;try{pattern=readPattern(result.data,accountId,patternId);}catch{pattern=null;}
      if(pattern){this.#set({status:'ready',pattern,expanded:false,error:null});return;}
      this.#set({status:'error',pattern:null,expanded:false,error:'unavailable'});return;
    }
    const error=['not_found','unauthenticated','unavailable','conflict'].includes(result?.error)?result.error:'unavailable';
    this.#set({status:'error',pattern:null,expanded:false,error});
  }
  retry(){return this.open(this.#accountId,this.#patternId);}
  toggle(){if(this.#state.status==='ready')this.#set({...this.#state,expanded:!this.#state.expanded});}
  leave(){++this.#generation;this.#accountId=null;this.#patternId=null;this.#set({status:'idle',pattern:null,expanded:false,error:null});}
}
