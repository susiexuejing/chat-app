import test from 'node:test';
import assert from 'node:assert/strict';
import {questions,fromQuestionChoices} from './approved-quiz93.mjs';
import {createOfflineQuizUi} from './quiz-ui-offline.mjs';

const questionIds=questions.map(q=>q.id);
const prior={id:'104',type:'ISTP'};
const replacement={id:'105',type:'ESTJ'};
function fixture(options){
  let sequence=0;
  const ctl=createOfflineQuizUi({questionIds,makeSubmissionId:()=> (++sequence).toString(16).padStart(32,'0')});
  let state=ctl.initialState(options);
  const next=(type,extra={})=>{
    const r=ctl.transition(state,{type,...extra});
    state=r.state;
    return r.effect;
  };
  const finish=(option='A')=>{
    assert.equal(next('start'),null);
    for(const id of questionIds) assert.equal(next('answer',{id,option}),null);
    assert.equal(next('complete'),null);
    assert.equal(state.view,'completed');
  };
  return {next,finish,get state(){return state;}};
}

test('signed-in retake is a draft until explicit view, then only confirmed response replaces the old report',()=>{
  const f=fixture({signedIn:true,savedReport:prior});
  f.next('view-saved');
  assert.equal(f.state.view,'report');
  f.finish();
  assert.equal(f.state.savedReport,prior);
  const submit=f.next('view-result');
  assert.equal(submit.path,'/ceshi/api/v1/quiz-account/result');
  assert.equal(submit.method,'POST');
  assert.deepEqual(fromQuestionChoices(submit.body.choices),Array(93).fill('A'));
  assert.equal(f.state.savedReport,prior);
  assert.equal(f.next('view-result'),null);
  assert.equal(f.next('retry-save'),null);
  f.next('save-response',{requestId:submit.requestId,reply:{status:'saved',report:replacement}});
  assert.equal(f.state.view,'report');
  assert.equal(f.state.savedReport,replacement);
  assert.equal(f.state.answers,null);
});

test('abandon draft or definitively rejected submission leaves the prior result untouched',()=>{
  const f=fixture({signedIn:true,savedReport:prior});
  f.finish('B');
  assert.equal(f.next('abandon'),null);
  assert.equal(f.state.view,'report');
  assert.equal(f.state.savedReport,prior);
  assert.equal(f.state.answers,null);
  f.finish('A');
  const submit=f.next('view-result');
  f.next('save-response',{requestId:submit.requestId,reply:{status:'invalid-submission'}});
  assert.equal(f.state.notice,'invalid-submission');
  assert.equal(f.state.savedReport,prior);
  assert.equal(f.next('abandon'),null);
  assert.equal(f.state.view,'report');
  assert.equal(f.state.savedReport,prior);
});

test('ambiguous failure keeps old display, locks choices, and retries exactly the same submission',()=>{
  const f=fixture({signedIn:true,savedReport:prior});
  f.finish();
  const first=f.next('view-result');
  f.next('save-response',{requestId:first.requestId,reply:{status:'try-again'}});
  assert.equal(f.state.notice,'save-unconfirmed');
  assert.equal(f.state.savedReport,prior);
  for(const action of ['edit','answer','abandon','view-result']){
    assert.equal(f.next(action,{id:'q01',option:'B'}),null);
    assert.equal(f.state.view,'completed');
    assert.equal(f.state.answers.q01,'A');
  }
  const retry=f.next('retry-save');
  assert.notEqual(retry.requestId,first.requestId);
  assert.equal(retry.body,first.body);
  f.next('save-response',{requestId:first.requestId,reply:{status:'saved',report:{id:'stale'}}});
  assert.equal(f.state.savedReport,prior);
  f.next('save-response',{requestId:retry.requestId,reply:{status:'saved',report:replacement}});
  assert.equal(f.state.savedReport,replacement);
});

test('guest never opens login before explicit view; cancel retains choices, and login alone sends no save',()=>{
  const f=fixture({signedIn:false,savedReport:prior});
  assert.equal(f.state.savedReport,null);
  f.next('start');
  assert.equal(f.next('complete'),null);
  assert.equal(f.state.view,'answering');
  for(const id of questionIds) assert.equal(f.next('answer',{id,option:'A'}),null);
  assert.equal(f.next('complete'),null);
  assert.equal(f.state.view,'completed');
  assert.equal(f.next('view-result'),null);
  assert.equal(f.state.view,'login');
  const stale=f.state.loginId;
  assert.equal(f.next('cancel-login'),null);
  assert.equal(f.state.view,'completed');
  assert.equal(Object.keys(f.state.answers).length,93);
  f.next('view-result');
  assert.equal(f.next('login-confirmed',{loginId:stale}),null);
  assert.equal(f.state.view,'login');
  assert.equal(f.next('login-confirmed',{loginId:f.state.loginId}),null);
  assert.equal(f.state.view,'completed');
  assert.ok(f.state.signedIn);
  assert.ok(f.next('view-result'));
});

test('expired session hides prior report, cannot retry uncertain save as a new account, and ignores replies after logout',()=>{
  const f=fixture({signedIn:true,savedReport:prior});
  f.finish();
  const submit=f.next('view-result');
  f.next('save-response',{requestId:submit.requestId});
  const retry=f.next('retry-save');
  f.next('save-response',{requestId:retry.requestId,reply:{status:'login-required'}});
  assert.equal(f.state.signedIn,false);
  assert.equal(f.state.savedReport,null);
  assert.equal(f.state.attempt.stage,'reauth-needed');
  assert.equal(f.state.attempt.payload,submit.body);
  assert.equal(f.next('view-result'),null);
  assert.equal(f.next('retry-save'),null);
  f.next('signed-out');
  f.next('save-response',{requestId:retry.requestId,reply:{status:'saved',report:replacement}});
  assert.equal(f.state.savedReport,null);
  assert.equal(f.state.answers,null);
});
