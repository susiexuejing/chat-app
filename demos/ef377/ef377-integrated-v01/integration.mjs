import {createJourney} from './journey.mjs';
import {DemoAuth} from './vendor/auth.mjs';
import {createOverview} from './vendor/overview.mjs';
import {PatternDetail} from './vendor/detail.mjs';
import {createRepository,createEditor,STORAGE_KEY,validPattern} from './vendor/editor.mjs';
export function createIntegrated(storage,{now=()=>Date.now(),random=()=>Math.random()}={}){
 const physical=storage;storage={getItem:key=>physical.getItem('emotionflow.ef377.integrated.v1.'+key),setItem:(key,value)=>{const target='emotionflow.ef377.integrated.v1.'+key;if(key===STORAGE_KEY){let next=JSON.parse(value),prior=physical.getItem(target);if(prior&&next.seededAccounts===undefined){let old=JSON.parse(prior);if(old.seededAccounts!==undefined)next.seededAccounts=old.seededAccounts;if(next.journey===undefined&&old.journey!==undefined)next.journey=old.journey;}value=JSON.stringify(next)}physical.setItem(target,value)}};const auth=new DemoAuth(storage,{now,random});const session=()=>auth.current();const repo=createRepository({storage,session,clock:now});let cached={ok:true,data:[]},generation=0;const overview=createOverview({listPatterns:()=>cached});const detail=new PatternDetail({getPattern:repo.getPattern});const editor=createEditor({repository:repo,session});
 const journey=createJourney(storage,session,now);
 async function list(){let a;const g=++generation;try{a=session()}catch{overview.logout();return {accountId:null,screen:'list',items:[],selected:null,error:'unavailable'}}overview.setAccount(a);if(!a)return overview.openList();const result=await repo.listPatterns(a);let current;try{current=session()}catch{return {accountId:null,screen:'list',items:[],selected:null,error:'unavailable'}}if(g!==generation||current!==a)return null;cached=result;return overview.openList()}
 async function open(id){let a;try{a=session()}catch{detail.leave();return {ok:false,error:'unavailable'}}if(!a){detail.leave();return {ok:false,error:'unauthenticated'}}await detail.open(a,id);return detail.snapshot()}
 function logout(){auth.logout();generation++;journey.path.leave();editor.sessionChanged();detail.leave();overview.logout()}
 return {auth,repo,overview,detail,editor,session,journey,list,open,logout};
}
