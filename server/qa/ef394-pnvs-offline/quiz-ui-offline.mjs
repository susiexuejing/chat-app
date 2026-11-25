// Pure, unmounted UI rehearsal. The caller owns effects, login verification,
// server readback, and generating a fresh cryptographic submission ID.
const resultPath='/ceshi/api/v1/quiz-account/result';
const idShape=/^[0-9a-f]{32}$/;
const reportShape=r=>r!==null&&typeof r==='object'&&typeof r.id==='string'&&r.id.length>0;

export function createOfflineQuizUi({questionIds,makeSubmissionId}) {
  if (!Array.isArray(questionIds) || questionIds.length!==93 ||
      Array.from(questionIds).some((id,i)=>id!=='q'+String(i+1).padStart(2,'0')) ||
      typeof makeSubmissionId!=='function') throw new TypeError('invalid quiz UI configuration');
  const ids=[...questionIds], known=new Set(ids);
  const updated=(state,patch={})=>({state:{...state,...patch},effect:null});
  const initialState=({signedIn=false,savedReport=null}={})=>({
    view:'list',signedIn:signedIn===true,
    savedReport:signedIn===true&&reportShape(savedReport)?savedReport:null,
    answers:null,attempt:null,sequence:0,loginId:null,notice:null,
  });
  const send=(s,payload,recovering=false)=>{
    const requestId=s.sequence+1;
    return {
      state:{...s,sequence:requestId,attempt:{payload,requestId,stage:'sending',recovering},notice:null},
      effect:{requestId,method:'POST',path:resultPath,body:payload},
    };
  };
  const done=s=>!s.attempt || s.attempt.stage==='rejected';
  return {initialState,transition(s,event){
    switch(event?.type){
      case 'start':
        return ['list','report'].includes(s.view)&&!s.attempt
          ? updated(s,{view:'answering',answers:{},notice:null}) : updated(s);
      case 'answer':
        return s.view==='answering'&&known.has(event.id)&&['A','B'].includes(event.option)
          ? updated(s,{answers:{...s.answers,[event.id]:event.option}}) : updated(s);
      case 'complete':
        return s.view==='answering'&&ids.every(id=>Object.hasOwn(s.answers,id))
          ? updated(s,{view:'completed',notice:null}) : updated(s);
      case 'edit':
        return s.view==='completed'&&done(s)
          ? updated(s,{view:'answering',attempt:null,notice:null}) : updated(s);
      case 'abandon':
        return ['answering','completed'].includes(s.view)&&done(s)
          ? updated(s,{view:s.savedReport?'report':'list',answers:null,attempt:null,notice:null}) : updated(s);
      case 'view-saved':
        return s.signedIn&&s.savedReport&&s.view==='list'
          ? updated(s,{view:'report',notice:null}) : updated(s);
      case 'view-result': {
        if(s.view!=='completed'||s.attempt)return updated(s);
        if(!s.signedIn){
          const loginId=s.sequence+1;
          return updated(s,{view:'login',loginId,sequence:loginId,notice:null});
        }
        const submissionId=makeSubmissionId();
        if(typeof submissionId!=='string'||!idShape.test(submissionId))throw new TypeError('invalid submission ID');
        const choices=Object.freeze(ids.map(id=>Object.freeze({id,option:s.answers[id]})));
        return send(s,Object.freeze({submissionId,choices}));
      }
      case 'cancel-login':
        return s.view==='login'?updated(s,{view:'completed',loginId:null,notice:null}):updated(s);
      case 'login-confirmed':
        // An account switch may not inherit the previously displayed report.
        return s.view==='login'&&s.loginId===event.loginId
          ? updated(s,{view:'completed',signedIn:true,savedReport:null,loginId:null,notice:null}) : updated(s);
      case 'retry-save':
        return s.view==='completed'&&s.signedIn&&s.attempt?.stage==='uncertain'
          ? send(s,s.attempt.payload,true) : updated(s);
      case 'save-response': {
        if(s.attempt?.stage!=='sending'||s.attempt.requestId!==event.requestId)return updated(s);
        const r=event.reply;
        if(r?.status==='saved'&&reportShape(r.report))
          return updated(s,{view:'report',savedReport:r.report,answers:null,attempt:null,notice:null});
        if(r?.status==='login-required'){
          // On expiry hide protected data. If recovering an ambiguous write,
          // preserve its payload (never start a different attempt implicitly).
          return updated(s,{signedIn:false,savedReport:null,
            attempt:s.attempt.recovering?{...s.attempt,stage:'reauth-needed'}:null,notice:'login-required'});
        }
        if(r?.status==='invalid-submission'||r?.status==='submission-conflict')
          return updated(s,{attempt:{...s.attempt,stage:s.attempt.recovering?'uncertain':'rejected'},notice:r.status});
        return updated(s,{attempt:{...s.attempt,stage:'uncertain'},notice:'save-unconfirmed'});
      }
      case 'signed-out':
        return updated(s,{...initialState(),sequence:s.sequence});
      default:
        return updated(s);
    }
  }};
}
