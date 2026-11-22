import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { createQuizRequestId, isQuizAuthPhoneAllowed, protectedQuizAccountDev, publicQuizAccountReal, quizAccount } from '@/features/quiz-account/api';
import { clearQuizReportVeil, useReportVisibility } from '@/features/quiz-account/useReportVisibility';

type Option = 'A' | 'B';
type Question = { id: string; prompt: string; options: Record<Option, string> };
type SavePayload = { submissionId: string; choices: ReadonlyArray<{ id: string; option: Option }> };
type Report = NonNullable<Awaited<ReturnType<typeof quizAccount.read>>['report']>;
type State = {
  view: 'list' | 'report' | 'answering' | 'completed' | 'login';
  signedIn: boolean; savedReport: Report | null; answers: Record<string,Option> | null;
  attempt: { stage: 'sending' | 'uncertain' | 'rejected' | 'reauth-needed'; requestId: number } | null;
  sequence: number; loginId: number | null; notice: string | null;
};
type Event = { type: string; id?: string; option?: Option; requestId?: number; reply?: unknown; loginId?: number | null };
type Effect = { requestId: number; body: SavePayload };
const questions: ReadonlyArray<Question> = require('./approved-quiz93-prompts.json');
// This shared reducer has no Node dependencies. The browser receives prompts/options, not the server scoring key.
const { createOfflineQuizUi } = require('../../../server/qa/ef394-pnvs-offline/quiz-ui-offline.mjs') as {
  createOfflineQuizUi(config: { questionIds: string[]; makeSubmissionId: () => string }): {
    initialState(config?: { signedIn: boolean; savedReport: Report | null }): State;
    transition(state: State, event: Event): { state: State; effect: Effect | null };
  }
};
const ctl = createOfflineQuizUi({ questionIds: questions.map(q=>q.id), makeSubmissionId: createQuizRequestId });
const names: Record<string, readonly [string,string]> = {
  EI:['外向','内向'], SN:['实感','直觉'], TF:['思考','情感'], JP:['判断','感知'],
};
const consentLabel=publicQuizAccountReal
  ? '我同意使用此手机号接收验证码并登录查看报告'
  : protectedQuizAccountDev
  ? '我同意使用指定合成身份进行本次测试登录'
  : '我同意使用演示身份进行本机登录验证';
const normalizePhone = (input: string) => {
  const value = input.trim().replace(/[\s-]/g, '');
  return /^1[3-9]\d{9}$/.test(value) ? '+86'+value : /^\+861[3-9]\d{9}$/.test(value) ? value : null;
};

function Button({label,action,secondary=false,disabled=false,testID,selected}:{
  label:string;action:()=>void;secondary?:boolean;disabled?:boolean;testID?:string;selected?:boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled, selected}} aria-pressed={selected} testID={testID}
    onPress={action} disabled={disabled} style={[styles.button,secondary&&styles.secondary,selected&&styles.chosen,disabled&&styles.disabled]}>
    <Text style={[styles.buttonText,secondary&&styles.secondaryText]}>{label}</Text>
  </Pressable>;
}

export default function QuizAccountOfflineScreen() {
  const [state,setState]=useState(()=>ctl.initialState());
  const stateRef=useRef(state);
  const [questionIndex,setQuestionIndex]=useState(0);
  const [intro,setIntro]=useState(false);
  const [masked,setMasked]=useState(true);
  const maskedRef=useRef(true);
  const hiddenEpoch=useRef(0);
  const [busy,setBusy]=useState(false);
  const busyRef=useRef(false);
  const [notice,setNotice]=useState('');
  const [returning,setReturning]=useState(false);
  const [logoutUnconfirmed,setLogoutUnconfirmed]=useState(false);
  const [phoneInput,setPhoneInput]=useState('');
  const [code,setCode]=useState('');
  const [challenge,setChallenge]=useState<{id:string;phone:string}|null>(null);
  const [sendTried,setSendTried]=useState(false);
  const [verifyTried,setVerifyTried]=useState(false);
  const [consent,setConsent]=useState(false);
  const setModel=(m:State)=>{stateRef.current=m;setState(m);};
  const apply=(event:Event)=>{
    const r=ctl.transition(stateRef.current,event);
    setModel(r.state);
    return r.effect;
  };
  const begin=()=>{
    if(busyRef.current)return false;
    busyRef.current=true;setBusy(true);return true;
  };
  const end=()=>{busyRef.current=false;setBusy(false);};
  const mask=()=>{
    hiddenEpoch.current++;
    maskedRef.current=true;setMasked(true);
    if(typeof document!=='undefined') document.documentElement.dataset.efQuizReportMasked='1';
  };
  const reveal=(epoch:number)=>{
    if(epoch!==hiddenEpoch.current||typeof document!=='undefined'&&document.visibilityState==='hidden')return;
    clearQuizReportVeil();maskedRef.current=false;setMasked(false);
  };
  const resetLogin=()=>{
    setPhoneInput('');setCode('');setChallenge(null);setSendTried(false);setVerifyTried(false);setConsent(false);
  };
  const adoptRead=(report:Report|null,epoch:number)=>{
    const previous=stateRef.current;
    const m={...ctl.initialState({signedIn:true,savedReport:report}),sequence:previous.sequence};
    setModel(report?ctl.transition(m,{type:'view-saved'}).state:m);
    if(report)reveal(epoch);
    else setNotice('这个账号还没有已保存的报告。');
  };
  const requestRead=async(automatic=false)=>{
    const current=stateRef.current;
    if(logoutUnconfirmed||current.attempt||current.answers||!begin())return;
    const epoch=hiddenEpoch.current;
    setNotice('');
    try{
      const r=await quizAccount.read();
      if(epoch!==hiddenEpoch.current)return;
      if(r.status==='signed-in')adoptRead(r.report??null,epoch);
      else if(r.status==='login-required'){
        mask();
        setModel({...ctl.initialState(),sequence:stateRef.current.sequence});
        if(automatic)setNotice('登录已失效，请主动登录回看。');
        else {resetLogin();setReturning(true);}
      }else setNotice('暂时无法读取已保存报告，请稍后重试。');
    }catch{setNotice('暂时无法读取已保存报告，请稍后重试。');}
    finally{end();}
  };
  useReportVisibility({
    hasProtectedReport:!!state.savedReport,
    onHide:mask,
    onResume:()=>{if(maskedRef.current&&stateRef.current.view==='report')void requestRead(true);},
  });

  const performSave=async(effect:Effect)=>{
    if(!begin())return;
    const epoch=hiddenEpoch.current;
    setNotice('');
    try{
      const reply=await quizAccount.save(effect.body);
      if(stateRef.current.attempt?.requestId!==effect.requestId)return;
      apply({type:'save-response',requestId:effect.requestId,reply});
      if(reply.status==='saved'&&stateRef.current.view==='report')reveal(epoch);
      if(reply.status==='login-required')mask();
    }catch{apply({type:'save-response',requestId:effect.requestId});}
    finally{end();}
  };
  const viewResult=()=>{
    if(busyRef.current||logoutUnconfirmed)return;
    setNotice('');
    try{
      const effect=apply({type:'view-result'});
      if(effect)void performSave(effect);
      else if(stateRef.current.view==='login')resetLogin();
    }catch{setNotice('无法准备提交，请重试。');}
  };
  const start=()=>{
    if(busyRef.current||logoutUnconfirmed)return;
    setIntro(false);setQuestionIndex(0);setNotice('');apply({type:'start'});
  };
  const submitPhone=async()=>{
    const phone=normalizePhone(phoneInput);
    if(!phone||!isQuizAuthPhoneAllowed(phone)||(publicQuizAccountReal&&!consent)||sendTried||logoutUnconfirmed||!begin())return;
    setSendTried(true);setNotice('');
    try{
      const r=await quizAccount.sendChallenge(phone,createQuizRequestId(),consent);
      if(r.status==='pending'&&r.challengeId)setChallenge({id:r.challengeId,phone});
      else setNotice('未能确认验证码发送。本页不会自动重发。');
    }catch{setNotice('未能确认验证码发送。本页不会自动重发。');}
    finally{end();}
  };
  const verify=async()=>{
    if(!challenge||!/^\d{6}$/.test(code)||!consent||verifyTried||!begin())return;
    let nextSave:Effect|null=null;
    setVerifyTried(true);setNotice('');
    try{
      const r=await quizAccount.verify(challenge.phone,code,challenge.id,consent);
      setCode('');
      if(r.status!=='verified'){
        setNotice('验证码无效、过期或核验未确认。本次验证码不能再次提交。');return;
      }
      resetLogin();
      if(returning){
        setReturning(false);
        const epoch=hiddenEpoch.current;
        const read=await quizAccount.read();
        if(epoch!==hiddenEpoch.current)return;
        if(read.status==='signed-in')adoptRead(read.report??null,epoch);
        else setNotice('暂时无法读取报告，请点击「登录回看」重试。');
      }else{
        apply({type:'login-confirmed',loginId:stateRef.current.loginId});
        // The guest already chose 查看结果, then explicitly confirmed that intent
        // with 验证并查看结果. Login by itself never starts a save.
        nextSave=apply({type:'view-result'});
      }
    }catch{setCode('');setNotice('核验或读取尚未确认，请返回再试。');}
    finally{end();}
    if(nextSave)void performSave(nextSave);
  };
  const cancelLogin=()=>{
    if(busyRef.current)return;
    resetLogin();setNotice('');setReturning(false);
    apply({type:'cancel-login'});
  };
  const logout=async()=>{
    if(!begin())return;
    mask();apply({type:'signed-out'});resetLogin();setReturning(false);setIntro(false);setNotice('');
    try{
      const r=await quizAccount.logout();
      setLogoutUnconfirmed(r.status!=='signed-out');
      if(r.status!=='signed-out')setNotice('已隐藏报告，但服务器尚未确认退出，请重试退出。');
    }catch{
      setLogoutUnconfirmed(true);setNotice('已隐藏报告，但服务器尚未确认退出，请重试退出。');
    }finally{end();}
  };

  const viewingLogin=returning||state.view==='login';
  const report=!masked&&state.view==='report'?state.savedReport:null;
  const locked=!!state.attempt&&state.attempt.stage!=='rejected';
  const q=questions[questionIndex];
  const normalizedInput=normalizePhone(phoneInput);
  const consentControl=(
        <Pressable accessibilityRole="checkbox" accessibilityLabel={consentLabel}
          accessibilityState={{checked:consent,disabled:busy||verifyTried}} aria-checked={consent} testID="quiz-account-consent"
          disabled={busy||verifyTried} onPress={()=>setConsent(previous=>!previous)} style={styles.consentRow}>
          <View style={[styles.consentBox,consent&&styles.consentSelected]}>{consent&&<Text style={styles.consentMark}>✓</Text>}</View>
          <Text style={styles.consentLabel}>{consentLabel}</Text>
        </Pressable>
  );
  const displayNotice=notice||({
    'save-unconfirmed':'保存尚未确认。可以重试原提交，旧报告不会在界面上被替换。',
    'invalid-submission':'这次提交未被接受，旧报告仍保留。',
    'submission-conflict':'提交状态有冲突，旧报告暂不替换。',
    'login-required':'登录已失效。请重新登录后查询已保存的报告。',
  } as Record<string,string>)[state.notice??''];
  return <Screen backgroundColor="#faf9f3"><View style={styles.page}>
    <Text style={styles.kicker}>{publicQuizAccountReal?'EmotionFlow · 性格偏好自测':protectedQuizAccountDev?'EmotionFlow · 受保护 DEV 合成验收':'EmotionFlow · 本机离线验收'}</Text>
    {viewingLogin ? <>
      <Text accessibilityRole="header" style={styles.heading}>手机号验证</Text>
      <Text style={styles.copy}>{returning?'验证后回看这个账号已保存的报告。':'验证后查看并保存本次答卷。取消不会丢失答案。'}</Text>
      <Text style={styles.copy}>{publicQuizAccountReal?'答题不需要手机号。只有你主动获取验证码时，才会提交手机号用于登录验证。':protectedQuizAccountDev?'仅供获准测试人员使用指定合成身份，请勿输入真实手机号。本验收不发真实短信。':'仅使用本机演示身份。此候选不连真实短信服务。'}</Text>
      <Text style={styles.copy}>{publicQuizAccountReal?'验证码请勿转发。新手机号首次验证成功后会创建账号，报告保存到该账号。':protectedQuizAccountDev?'指定测试号码仅用于模拟验证。首次验证成功会在临时测试环境创建演示账号。':'手机号只用于本机验证。首次验证成功会创建本机演示账号。'}</Text>
      <TextInput accessibilityLabel="中国大陆手机号" testID="quiz-account-phone"
        placeholder="中国大陆手机号" inputMode="tel" autoComplete="off" value={phoneInput}
        onChangeText={setPhoneInput} editable={!sendTried&&!busy} maxLength={18} style={styles.input}/>
      {publicQuizAccountReal&&consentControl}
      {!challenge&&<Button label="获取验证码" testID="quiz-account-send" action={()=>void submitPhone()}
        disabled={busy||sendTried||(publicQuizAccountReal&&!consent)||!normalizedInput||!isQuizAuthPhoneAllowed(normalizedInput)}/>}
      {challenge&&<>
        <TextInput accessibilityLabel="六位验证码" testID="quiz-account-code" placeholder="六位验证码"
          inputMode="numeric" autoComplete="sms-otp" value={code} onChangeText={setCode}
          editable={!verifyTried&&!busy} maxLength={6} style={styles.input}/>
        {!publicQuizAccountReal&&consentControl}
        {!publicQuizAccountReal&&<Text style={styles.copy}>{protectedQuizAccountDev?'仅用于受保护测试环境合成验收，不代表正式用户协议或隐私政策。请勿使用真实手机号。':'仅用于本机流程验收，不代表正式用户协议或隐私政策。请勿使用真实手机号。'}</Text>}
        <Button label={returning?'验证并登录':'验证并查看结果'} testID="quiz-account-verify" action={()=>void verify()}
          disabled={busy||verifyTried||!consent||!/^\d{6}$/.test(code)}/>
      </>}
      <Button label="取消，返回当前流程" testID="quiz-account-cancel-login" action={cancelLogin} secondary disabled={busy}/>
    </> : state.view==='list' ? <>
      <Text accessibilityRole="header" style={styles.heading}>{intro?'测试说明':'性格偏好自测'}</Text>
      <Text style={styles.copy}>93 道二选一题。没有标准答案，请选择更接近你的选项。</Text>
      <Text style={styles.copy}>先答题，完成后再选择是否登录并保存报告。结果仅供自我探索，不构成诊断。</Text>
      {intro&&<Text testID="quiz-account-plus86-note" style={styles.copy}>查看和保存报告时才需要验证，当前流程仅支持中国大陆 +86 手机号格式。</Text>}
      <Button label={intro?'开始测试':'查看测试说明'} testID={intro?'quiz-account-start':'quiz-account-intro'}
        action={intro?start:()=>setIntro(true)} disabled={busy||logoutUnconfirmed}/>
      <Button label="登录回看" testID="quiz-account-read" action={()=>void requestRead()} secondary disabled={busy||logoutUnconfirmed}/>
    </> : state.view==='answering' ? <>
      <Text accessibilityRole="header" style={styles.heading}>性格偏好自测</Text>
      <Text testID="quiz-account-progress" style={styles.kicker}>{questionIndex+1} / {questions.length}</Text>
      <Text style={styles.question}>{q.prompt}</Text>
      {(['A','B'] as const).map(option=><Button key={option} label={q.options[option]} testID={`quiz-account-answer-${option}`}
        action={()=>apply({type:'answer',id:q.id,option})} secondary selected={state.answers?.[q.id]===option}/>)}
      <Button label={questionIndex===92?'完成测试':'下一题'} testID="quiz-account-next"
        disabled={!state.answers?.[q.id]} action={()=>questionIndex===92?apply({type:'complete'}):setQuestionIndex(questionIndex+1)}/>
      <Button label="上一题" action={()=>setQuestionIndex(Math.max(0,questionIndex-1))} disabled={questionIndex===0} secondary/>
      <Button label="放弃本次答题" action={()=>apply({type:'abandon'})} secondary/>
    </> : state.view==='completed' ? <>
      <Text accessibilityRole="header" style={styles.heading}>测试已完成</Text>
      <Text style={styles.copy}>已答完 93 题。尚未确认保存本次报告。</Text>
      {state.attempt?.stage==='uncertain' ? <Button label="重试本次保存" testID="quiz-account-retry-save" disabled={busy} action={()=>{
        if(busyRef.current)return;
        const effect=apply({type:'retry-save'});if(effect)void performSave(effect);
      }}/> : state.attempt?.stage==='reauth-needed' ? <>
        <Text style={styles.copy}>无法确认本次保存，不能使用其他账号重试。退出后请用原账号回看。</Text>
        <Button label="退出并结束本次重试" action={()=>void logout()} disabled={busy}/>
      </> : <Button label="查看结果" testID="quiz-account-view-result" action={viewResult} disabled={busy||!!state.attempt}/>}
      {!locked&&<><Button label="返回修改答案" testID="quiz-account-edit" secondary action={()=>{
        setQuestionIndex(92);apply({type:'edit'});
      }}/><Button label="放弃本次答题" testID="quiz-account-abandon" secondary action={()=>apply({type:'abandon'})}/></>}
    </> : <>
      <Text accessibilityRole="header" style={styles.heading}>我的性格偏好报告</Text>
      {report ? <View nativeID="ef-quiz-protected-report" testID="quiz-account-report" style={styles.card}>
        <Text style={styles.question}>{report.type??'本次包含无明显偏好的维度'}</Text>
        {report.sides.map(side=>{
          const labels=names[side.dimension]??['第一侧','第二侧'];
          return <Text key={side.dimension} style={styles.copy}>
            {labels[0]} {side.scores[0]} · {labels[1]} {side.scores[1]}{side.preferred===null?' · 无明显偏好':''}
          </Text>;
        })}
        <Text style={styles.copy}>已保存 · 仅供自我探索，不构成诊断。</Text>
      </View> : <Button label="重新确认登录并回看" action={()=>void requestRead()} disabled={busy} testID="quiz-account-report-refresh"/>}
      <Button label="重新测试" action={start} secondary disabled={busy||!report} testID="quiz-account-retake"/>
    </>}
    {!!displayNotice&&<Text accessibilityRole="alert" style={styles.notice}>{displayNotice}</Text>}
    {!viewingLogin&&(state.signedIn||logoutUnconfirmed)&&<Button label={logoutUnconfirmed?'重试退出':'退出登录'} testID="quiz-account-logout"
      action={()=>void logout()} secondary disabled={busy}/>}
  </View></Screen>;
}

const styles=StyleSheet.create({
  page:{width:'100%',maxWidth:540,alignSelf:'center',padding:24,gap:12},
  kicker:{fontSize:14,color:'#51664c',fontWeight:'600'},
  heading:{fontSize:27,color:'#1e3020',fontWeight:'700'},
  copy:{fontSize:16,lineHeight:24,color:'#455342'},
  question:{fontSize:19,lineHeight:28,color:'#263a29',fontWeight:'600'},
  button:{minHeight:48,padding:12,borderRadius:10,backgroundColor:'#315844',justifyContent:'center'},
  buttonText:{color:'#fff',fontSize:16,textAlign:'center',fontWeight:'600'},
  secondary:{backgroundColor:'#fff',borderWidth:1,borderColor:'#b6c6b7'},
  secondaryText:{color:'#244432'},chosen:{backgroundColor:'#e2eddf',borderColor:'#315844'},
  disabled:{opacity:0.46},
  input:{color:'#1f3425',backgroundColor:'#fff',borderColor:'#9eae99',borderWidth:1,borderRadius:10,minHeight:48,padding:12,fontSize:16},
  consentRow:{minHeight:44,flexDirection:'row',alignItems:'center',gap:10},
  consentBox:{height:22,width:22,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'#51664c',borderRadius:4},
  consentSelected:{backgroundColor:'#315844',borderColor:'#315844'},
  consentMark:{color:'#fff',fontSize:16,fontWeight:'700'},
  consentLabel:{flex:1,color:'#263a29',fontSize:16},
  card:{padding:16,backgroundColor:'#fff',borderRadius:12,gap:8},
  notice:{color:'#85491e',fontSize:15,lineHeight:22},
});
