export type QuizChoice = {id:string;option:'A'|'B'};
export type QuizReport = {id:string;type:string|null;sides:{dimension:string;preferred:string|null;scores:[number,number]}[]};
export type QuizReply = {status:string;challengeId?:string;report?:QuizReport|null};

const OFFLINE_ENDPOINT='/ceshi/api/v1/quiz-account/';
const PUBLIC_ENDPOINT='/ceshi/api/auth/v1/';
const CANONICAL_QUIZ_URL='https://dev.douhaoyu.cn/ceshi/';
export const protectedQuizAccountDev=process.env.EXPO_PUBLIC_TESTS_ACCOUNT_PROTECTED_DEV==='1';
const offlineQuizAccount=process.env.EXPO_PUBLIC_TESTS_ACCOUNT_OFFLINE==='1';
export const publicQuizAccountReal=process.env.EXPO_PUBLIC_TESTS_ACCOUNT_PUBLIC_REAL==='1';
const publicBuildReady=process.env.EXPO_PUBLIC_TESTS_DEMO==='1' && process.env.EXPO_PUBLIC_TESTS_DEMO_BASE_PATH==='/ceshi';
const fixtureModeConflict=publicQuizAccountReal&&(protectedQuizAccountDev||offlineQuizAccount);
const protectedFixturePhones=new Set(['+8613000000000','+8613900000000']);
export function isQuizAuthPhoneAllowed(phone:string):boolean {
  if (publicQuizAccountReal) return publicBuildReady&&!fixtureModeConflict&&/^\+861[3-9]\d{9}$/.test(phone);
  return !protectedQuizAccountDev||protectedFixturePhones.has(phone);
}
const routeStatus:Record<string,ReadonlySet<string>>={
  challenge:new Set(['pending','not-verified','consent-required','try-again']),
  verify:new Set(['verified','not-verified','consent-required','try-again']),
  result:new Set(['signed-in','saved','login-required','invalid-submission','submission-conflict','try-again']),
  logout:new Set(['signed-out','try-again']),
};

function isReport(r: QuizReport | null | undefined): r is QuizReport {
  return !!r && typeof r.id==='string' && /^[1-9]\d*$/.test(r.id) &&
    (r.type===null || (typeof r.type==='string'&&/^[EI][SN][TF][JP]$/.test(r.type))) &&
    Array.isArray(r.sides) && r.sides.length===4 && r.sides.every((s,i)=>{
      const dim=['EI','SN','TF','JP'][i], total=i===0?24:23;
      if (!s || s.dimension!==dim || !Array.isArray(s.scores) || s.scores.length!==2) return false;
      const [a,b]=s.scores;
      return Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b>=0&&a+b===total &&
        s.preferred===(a===b?null:a>b?dim[0]:dim[1]);
    }) && r.type===(r.sides.some(x=>x.preferred===null)?null:r.sides.map(x=>x.preferred).join(''));
}

async function request(route:string, body?:object):Promise<QuizReply> {
  if (typeof window==='undefined') return {status:'try-again'};
  const {href,origin,pathname}=window.location;
  // Separate build modes. This is only a destination guard, not access
  // control: protected DEV still requires externally authenticated ingress
  // for the document, every asset, and every API request.
  if(fixtureModeConflict)return {status:'try-again'};
  const targetAllowed=publicQuizAccountReal
    ? publicBuildReady&&href===CANONICAL_QUIZ_URL
    : protectedQuizAccountDev
    ? offlineQuizAccount&&href===CANONICAL_QUIZ_URL
    : /^http:\/\/localhost:\d+$/.test(origin)&&pathname==='/ceshi/';
  if(!targetAllowed)return {status:'try-again'};
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);
  try {
    const response=await fetch((publicQuizAccountReal?PUBLIC_ENDPOINT:OFFLINE_ENDPOINT)+route, {
      mode:'same-origin', credentials:'same-origin', cache:'no-store', redirect:'error', signal:controller.signal,
      method:body===undefined?'GET':'POST',
      ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),
    });
    const r=await response.json() as QuizReply;
    if (!r || !routeStatus[route]?.has(r.status)) return {status:'try-again'};
    if (r.status==='login-required' && (route!=='result' || response.status!==401)) return {status:'try-again'};
    if (r.status==='pending' && (!response.ok||typeof r.challengeId!=='string'||!(/^[a-f0-9]{32}$/.test(r.challengeId)))) return {status:'try-again'};
    if (r.status==='saved' && (!response.ok||!isReport(r.report))) return {status:'try-again'};
    if (r.status==='signed-in' && (!response.ok || !(r.report===null||isReport(r.report)))) return {status:'try-again'};
    if (['verified','signed-out'].includes(r.status) && !response.ok) return {status:'try-again'};
    return {status:r.status,...(r.challengeId?{challengeId:r.challengeId}:{}),...('report' in r?{report:r.report}:{})};
  } catch { return {status:'try-again'}; }
  finally { clearTimeout(timeout); }
}

export function createQuizRequestId() {
  if (typeof globalThis.crypto?.getRandomValues!=='function') throw new Error('secure randomness unavailable');
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
}
export const quizAccount={
  sendChallenge:(phone:string,requestId:string,consent=false):Promise<QuizReply>=>isQuizAuthPhoneAllowed(phone)&&(!publicQuizAccountReal||consent===true)
    ? request('challenge',publicQuizAccountReal?{phone,requestId,consent:true}:{phone,requestId}) : Promise.resolve({status:'not-verified'}),
  verify:(phone:string,code:string,challengeId:string,consent:boolean):Promise<QuizReply>=>isQuizAuthPhoneAllowed(phone)&&(!publicQuizAccountReal||consent===true)
    ? request('verify',{phone,code,challengeId,consent}) : Promise.resolve({status:'not-verified'}),
  save:(payload:{submissionId:string;choices:ReadonlyArray<QuizChoice>})=>request('result',payload),
  read:()=>request('result'),
  logout:()=>request('logout',{}),
};
