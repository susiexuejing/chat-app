import {timingSafeEqual} from 'node:crypto';
import {phoneDigest,createPreflight} from '../../qa/ef394-pnvs-offline/pnvs-preflight.mjs';
import {postgresReservation} from '../../qa/ef394-pnvs-offline/pnvs-ledger.mjs';
import {createOfflineQuizAccount} from '../../qa/ef394-pnvs-offline/quiz-account.mjs';
import {createDevAccountTransport} from '../../qa/ef394-pnvs-offline/quiz-http-offline.mjs';
import {approvedBankRevision,approvedScore} from '../../qa/ef394-pnvs-offline/approved-quiz93.mjs';
import {createAliyunPnvs,isPnvsScheme} from './pnvs.mjs';

const ORIGIN='https://dev.douhaoyu.cn';
const storage='devAccount';
const target=Object.freeze({host:'/run/ef-quiz-postgres-dev',port:55439,database:'ef_quiz_qa_dev',user:'ef_quiz_account_qa_runtime'});
const hidden=createDevAccountTransport({enabled:false});
const valid=(value,rx)=>typeof value==='string'&&rx.test(value);
const hex=/^[a-f0-9]{64}$/;
// AssumeRole returns a temporary AccessKey ID such as STS.<alphanumeric>.
// Preserve the existing total length limit and permit no other separator.
const providerKeyId=/^(?:STS\.[a-zA-Z0-9]{16,124}|[a-zA-Z0-9]{16,128})(?![\s\S])/;
const planFields=['runId','release','from','until','subjects'];
const identitySql=`SELECT current_database() = $1 AND current_user = $2 AND session_user = $2 AND inet_server_addr() IS NULL
  AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls
  AND NOT EXISTS (SELECT FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid)
  AND EXISTS (SELECT FROM pg_catalog.pg_namespace n WHERE n.nspname='ef_quiz_account_dev' AND n.nspowner<>r.oid)
  AND NOT pg_catalog.has_schema_privilege(current_user,'ef_quiz_account_dev','CREATE')
  AND NOT pg_catalog.has_table_privilege(current_user,'ef_quiz_account_dev.run_budget','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  AND pg_catalog.has_function_privilege(current_user,'ef_quiz_account_dev.reserve_run_budget(text,text,text,text,bigint,bigint,smallint)','EXECUTE')
  AND pg_catalog.has_function_privilege(current_user,'ef_quiz_account_dev.verified_run_active(text,text,text)','EXECUTE')
  AND pg_catalog.has_column_privilege(current_user,'ef_quiz_account_dev.report','bank_revision','INSERT')
  AND NOT pg_catalog.has_column_privilege(current_user,'ef_quiz_account_dev.report','bank_revision','UPDATE')
  AND NOT pg_catalog.has_column_privilege(current_user,'ef_quiz_account_dev.report','first_saved_at','INSERT,UPDATE')
  AS ready FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`;

// No PG* env overrides: pg can source missing fields from its environment.
// The connection uses fixed Unix peer identity and supplies no DB password.
async function openPostgres() {
  if(Object.keys(process.env).some(key=>key.startsWith('PG')))throw new Error('unexpected postgres overrides');
  const {default:{Pool}}=await import('pg');
  return new Pool({...target,ssl:false,max:3,connectionTimeoutMillis:2000,idleTimeoutMillis:10000,
    statement_timeout:1800,query_timeout:2200,application_name:'ef-quiz-account-dev'});
}

function config(env,now) {
  const planRaw=env.EF_QUIZ_DEV_QA_PLAN;
  if(typeof planRaw!=='string'||planRaw.length>1024)throw new Error('invalid plan');
  const raw=JSON.parse(planRaw);
  if(!raw||Object.keys(raw).length!==planFields.length||planFields.some(k=>!Object.hasOwn(raw,k))||
     !Array.isArray(raw.subjects)||raw.subjects.some(s=>!s||Object.keys(s).length!==2||!Object.hasOwn(s,'digest')||!Object.hasOwn(s,'limit')))
    throw new Error('invalid plan');
  const plan={...raw, enabled:true,environment:'development',origin:ORIGIN,prefix:'/ceshi/'};
  const active=()=>Number.isSafeInteger(now())&&now()>=plan.from&&now()<plan.until;
  if(!active()||!valid(env.EF_QUIZ_CONSENT_VERSION,/^dev-qa-[a-z0-9-]{3,50}$/))throw new Error('inactive plan or policy');
  const keyNames=['PHONE','BROWSER','ACCOUNT','SESSION'];
  const values=keyNames.map(k=>env['EF_QUIZ_'+k+'_HMAC']);
  if(values.some(v=>!valid(v,hex)||/^([a-f0-9]{2})\1{31}$/.test(v))||new Set(values).size!==4)throw new Error('invalid HMAC keys');
  const [phoneKey,browserKey,accountKey,sessionKey]=values.map(v=>Buffer.from(v,'hex'));
  // STS only, no default credential discovery, developer profile, or metadata.
  const {
    EF_QUIZ_PNVS_STS_ID: keyId,
    EF_QUIZ_PNVS_STS_SECRET: keySecret,
    EF_QUIZ_PNVS_STS_TOKEN: token,
  } = env;
  const scheme=env.EF_QUIZ_PNVS_SCHEME,sign=env.EF_QUIZ_PNVS_SIGN,template=env.EF_QUIZ_PNVS_TEMPLATE;
  if(!valid(keyId,providerKeyId)||!valid(keySecret,/^[a-zA-Z0-9/+_=.-]{16,256}$/)||
     !valid(token,/^[a-zA-Z0-9/+_=.-]{32,4096}$/)||
     !Object.hasOwn(env,'EF_QUIZ_PNVS_SCHEME')||!isPnvsScheme(scheme)||!valid(sign,/^[^\p{C}\s][^\p{C}]{0,63}$/u)||
     !valid(template,/^[A-Za-z0-9_]{4,64}$/))throw new Error('invalid provider configuration');
  return {plan,active,phoneKey,browserKey,accountKey,sessionKey,consentVersion:env.EF_QUIZ_CONSENT_VERSION,
    pnvs:{keyId,keySecret,token,scheme,sign,template,active}};
}

// Standalone composition only. No listener, auto migration, seed, or public signup.
// A dedicated reviewed Unix-only ingress must supply the second boolean from
// its own transport boundary, not from forwarded/client headers.
export async function createPublicQuizRuntime({
  env=process.env, now=Date.now, connect=openPostgres, providerFactory=createAliyunPnvs,
}={}) {
  const off={enabled:false,dispatch:hidden,close:async()=>{}};
  if(env.EF_QUIZ_ACCOUNT_MODE!=='qa-live-dev')return off;
  let db;
  try {
    const c=config(env,now);
    // Validate the complete plan, including bounds, before opening the DB.
    let reserve;
    const preflight=createPreflight({plan:c.plan,phoneKey:c.phoneKey,now,reserve:p=>reserve(p)});
    db=await connect(target);
    db.on?.('error',()=>{}); // no error or credentials serialized
    const check=await db.query(identitySql,[target.database,target.user]);
    if(check.rows?.length!==1||check.rows[0].ready!==true||!c.active())throw new Error('wrong database');
    reserve=postgresReservation(db,storage);
    const subjects=c.plan.subjects.map(s=>Buffer.from(s.digest,'hex'));
    const allowed=number=>{
      try {
        const digest=Buffer.from(phoneDigest(c.phoneKey,number),'hex');
        return subjects.some(s=>timingSafeEqual(s,digest));
      } catch {return false;}
    };
    const provider=c.active()?providerFactory(c.pnvs):null;
    if(!provider)throw new Error('inactive provider');
    const service=createOfflineQuizAccount({storage,db,preflight,provider,score:approvedScore,bankRevision:approvedBankRevision,
      runId:c.plan.runId,releaseId:c.plan.release,consentVersion:c.consentVersion,
      phoneKey:c.phoneKey,browserKey:c.browserKey,accountKey:c.accountKey,sessionKey:c.sessionKey,
      sessionTtlSeconds:900});
    const denied={status:'not-verified'};
    const dispatch=createDevAccountTransport({enabled:true,service:{
      ...service,
      // A denied number must never turn into a database write or provider call.
      send:req=>c.active()&&allowed(req.phone) ? service.send(req) : denied,
      verify:req=>c.active()&&allowed(req.phone) ? service.verify(req) : denied,
    }});
    let closed=false;
    return {enabled:true,dispatch:(req,trusted)=>closed||!c.active()?hidden(req):dispatch(req,trusted),
      close:async()=>{if(closed)return;closed=true;await db.end();}};
  } catch {
    try {await db?.end();} catch { /* do not log config/environment */ }
    return off;
  }
}
