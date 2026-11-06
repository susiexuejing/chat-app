export const VERSION='EF378-PRACTICE-v0.1';
const copy=v=>structuredClone(v), valid=s=>typeof s==='string'&&s.trim().length>0&&s.length<=200;
export const FIXTURES=[
 {accountId:'demo-account-a',patternId:'demo-pattern-a',name:'收到修改意见',ifCue:'收到一条修改意见',thenAction:'先问清楚一个具体修改点',confirmed:true,paused:false,version:1},
 {accountId:'demo-account-a',patternId:'demo-pattern-b',name:'事情挤在一起',ifCue:'几件任务挤在一起',thenAction:'给自己留两分钟空档',confirmed:true,paused:false,version:1},
 {accountId:'demo-account-b',patternId:'demo-pattern-c',name:'回复消息前',ifCue:'准备回复消息',thenAction:'先写一句想表达的意思',confirmed:true,paused:false,version:1}
];
export class PracticeDemo{
 #rows=copy(FIXTURES);#records=[];#failure=false;
 constructor({rows=FIXTURES,records=[],commit=()=>{}}={}){this.#rows=copy(rows);this.#records=copy(records);this.commit=commit;this.accountId=null;this.patternId=null;this.draft=null;this.checkin=null;this.error=null;this.message='';}
 failNext(){this.#failure=true;}
 #row(){if(!valid(this.accountId))return null;return this.#rows.find(p=>p.accountId===this.accountId&&p.patternId===this.patternId)||null;}
 #write(fn){if(!this.#row()){this.error='not_found';return false;}if(this.#failure){this.#failure=false;this.error='unavailable';this.message='未保存，原内容未改变；可重试或离开。';return false;}const previous={rows:copy(this.#rows),records:copy(this.#records),draft:copy(this.draft),checkin:copy(this.checkin)};
 try{fn();this.commit(copy(this.#rows),copy(this.#records));}
 catch{this.#rows=previous.rows;this.#records=previous.records;this.draft=previous.draft;this.checkin=previous.checkin;this.error='unavailable';this.message='未保存，原内容未改变；可重试或离开。';return false;}
 this.error=null;return true;}
 open(accountId,patternId){this.accountId=accountId;this.patternId=patternId;this.draft=null;this.checkin=null;this.error=!valid(accountId)?'unauthenticated':this.#row()?null:'not_found';this.message='';return this.snapshot();}
 snapshot(){return copy({practice:this.#row(),draft:this.draft,checkin:this.checkin,error:this.error,message:this.message,records:this.#records.filter(r=>r.accountId===this.accountId&&r.patternId===this.patternId)});}
 edit(){const p=this.#row();if(!p)return false;this.draft={ifCue:p.ifCue,thenAction:p.thenAction};this.message='';return true;}
 draftText(ifCue,thenAction){if(!this.draft)return false;this.draft={ifCue,thenAction};return true;}
 cancelEdit(){this.draft=null;this.error=null;this.message='已取消，原练习不变。';}
 savePractice(){if(!this.draft||![this.draft.ifCue,this.draft.thenAction].every(s=>typeof s==='string'&&s.trim()&&s.length<=200)){this.error='invalid';this.message='请填写具体触发和一个小回应（各不超过200字）。';return false;}return this.#write(()=>{Object.assign(this.#row(),{ifCue:this.draft.ifCue.trim(),thenAction:this.draft.thenAction.trim(),confirmed:true,version:this.#row().version+1});this.draft=null;this.message='练习已确认保存。';});}
 pause(){return this.#write(()=>{this.#row().paused=true;this.message='练习已暂停；不会自动提醒。';});}
 startRecord(){const p=this.#row();if(!p?.confirmed||p.paused)return false;this.checkin={occurred:null,action:null,feeling:null,note:''};this.message='';this.error=null;return true;}
 chooseOccurred(v){if(!this.checkin||typeof v!=='boolean')return false;Object.assign(this.checkin,{occurred:v,action:null,feeling:null});return true;}
 chooseAction(v){if(!this.checkin?.occurred||!['agreed','other','none'].includes(v))return false;Object.assign(this.checkin,{action:v,feeling:null});return true;}
 chooseFeeling(v){if(!['agreed','other'].includes(this.checkin?.action)||!['helped','unchanged','worse','not_recorded'].includes(v))return false;this.checkin.feeling=v;return true;}
 note(v){if(this.checkin&&typeof v==='string')this.checkin.note=v.slice(0,200);}
 skip(){this.checkin=null;this.error=null;this.message='已退出本次记录，没有创建记录；不记录不是失败。';}
 saveRecord(){const c=this.checkin;if(!c||typeof c.occurred!=='boolean'||(c.occurred&&(!c.action||(['agreed','other'].includes(c.action)&&!c.feeling)))){this.error='invalid';return false;}return this.#write(()=>{this.#records.push({schemaVersion:1,accountId:this.accountId,patternId:this.patternId,recordId:'record-'+(this.#records.length+1),practiceId:this.#row().practiceId,practiceVersion:this.#row().version,demoSource:'synthetic',occurred:c.occurred,action:c.action,feeling:c.feeling,...(c.note.trim()?{note:c.note.trim()}:{}),createdAt:new Date().toISOString()});const worse=c.feeling==='worse';this.checkin=null;this.message=worse?'已保存事实。如果更不舒服，可以暂停或修改练习；不用继续重复。':'记录已保存，可在路径回看。';});}
 leave(){this.accountId=null;this.patternId=null;this.draft=null;this.checkin=null;this.error=null;this.message='已离开。';}
}
