import {createJourney,PATTERN_ID} from './journey.mjs';
import {DemoAuth} from './vendor/auth.mjs';
import {createOverview} from './vendor/overview.mjs';
import {PatternDetail} from './vendor/detail.mjs';
import {createRepository,createEditor,STORAGE_KEY,validPattern} from './vendor/editor.mjs';
export function createIntegrated(storage,{now=()=>Date.now(),random=()=>Math.random()}={}){
 const physical=storage;
 storage={
  getItem:key=>physical.getItem('emotionflow.ef377.integrated.v1.'+key),
  setItem(key,value){
   const target='emotionflow.ef377.integrated.v1.'+key;
   if(key===STORAGE_KEY){
    const next=JSON.parse(value),prior=physical.getItem(target);
    if(prior){
     const old=JSON.parse(prior);
     if(next.seededAccounts===undefined&&old.seededAccounts!==undefined)next.seededAccounts=old.seededAccounts;
     if(next.journey===undefined&&old.journey!==undefined)next.journey=old.journey;
     // Save understanding history in the same atomic write as the pattern update.
     // This covers both editor saves and a later explicit chat confirmation.
     for(const pattern of next.patterns){
      const previous=old.patterns.find(row=>row.accountId===pattern.accountId&&row.patternId===pattern.patternId);
      if(pattern.patternId!==PATTERN_ID||!previous||previous.currentUnderstanding===pattern.currentUnderstanding)continue;
      next.journey??={practices:[],records:[],entries:[]};
      if(!Array.isArray(next.journey.entries))throw Error('unavailable');
      let n=1;
      while(next.journey.entries.some(row=>row.accountId===pattern.accountId&&row.patternId===pattern.patternId&&row.entryId==='correction-'+n))n++;
      next.journey.entries.push({
       schemaVersion:1,demoSource:'synthetic',accountId:pattern.accountId,patternId:pattern.patternId,
       entryId:'correction-'+n,type:'correction',createdAt:pattern.updatedAt,version:1,linked:true,
       fact:'用户明确保存的理解修正。',source:'用户确认修改',userConfirmed:true,
       oldUnderstanding:previous.currentUnderstanding,currentUnderstanding:pattern.currentUnderstanding,
      });
     }
    }
    value=JSON.stringify(next);
   }
   physical.setItem(target,value);
  },
 };
 const auth=new DemoAuth(storage,{now,random});const session=()=>auth.current();const repo=createRepository({storage,session,clock:now});let cached={ok:true,data:[]},generation=0;const overview=createOverview({listPatterns:()=>cached});const detail=new PatternDetail({getPattern:repo.getPattern});const editor=createEditor({repository:repo,session});
 const journey=createJourney(storage,session,now);
 async function list(){let a;const g=++generation;try{a=session()}catch{overview.logout();return {accountId:null,screen:'list',items:[],selected:null,error:'unavailable'}}overview.setAccount(a);if(!a)return overview.openList();const result=await repo.listPatterns(a);let current;try{current=session()}catch{return {accountId:null,screen:'list',items:[],selected:null,error:'unavailable'}}if(g!==generation||current!==a)return null;cached=result;return overview.openList()}
 async function open(id){let a;try{a=session()}catch{detail.leave();return {ok:false,error:'unavailable'}}if(!a){detail.leave();return {ok:false,error:'unauthenticated'}}await detail.open(a,id);return detail.snapshot()}
 function logout(){auth.logout();generation++;journey.path.leave();editor.sessionChanged();detail.leave();overview.logout()}
 return {auth,repo,overview,detail,editor,session,journey,list,open,logout};
}
