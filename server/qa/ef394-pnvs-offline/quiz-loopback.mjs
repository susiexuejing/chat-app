import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { approvedScore } from './approved-quiz93.mjs';
import { createOfflineQuizTransport } from './quiz-http-offline.mjs';
import { createOfflineQuizAccount } from './quiz-account.mjs';
import { createPreflight,phoneDigest } from './pnvs-preflight.mjs';
import { postgresReservation } from './pnvs-ledger.mjs';
import { validateDevConfig, devIngressAllowed } from './quiz-dev-ingress.mjs';

const require=createRequire(import.meta.url);
const {createServer:createStatic}=require('../../../scripts/qa/tests-demo/serve-build.cjs');
const origin='https://dev.douhaoyu.cn',prefix='/ceshi/';
const api=prefix+'api/v1/quiz-account/';
const phones=['+8613000000000','+8613900000000'];
const code='000000';

export async function makeLoopback(staticDir) {
  return makeSyntheticServer(staticDir);
}

// Explicit separate entry point; never enables DEV behavior in makeLoopback.
export async function makeProtectedDev(staticDir, config) {
  return makeSyntheticServer(staticDir, validateDevConfig(config));
}

async function makeSyntheticServer(staticDir, dev) {
  const renderStatic=createStatic(staticDir,'/ceshi').listeners('request')[0];
  const db=new PGlite();
  const phoneKey=randomBytes(32),browserKey=randomBytes(32),accountKey=randomBytes(32),sessionKey=randomBytes(32);
  const runId=dev?'dev-synthetic-test':'local-synthetic-test',releaseId=randomBytes(32).toString('hex');
  let server;
  try {
    for(const name of ['pnvs-ledger.sql','pnvs-challenge.sql','quiz-account.sql']) {
      await db.exec(await readFile(new URL(name,import.meta.url),'utf8'));
    }
    const from=dev?.startsMs ?? Date.now()-500,until=dev?.expiresMs ?? from+895000;
    const subjects=phones.map((p,i)=>({digest:phoneDigest(phoneKey,p),limit:i===0?2:1}));
    for(const {digest,limit} of subjects) for(const op of ['send','verify']) {
      await db.query('INSERT INTO ef_quiz_sms_qa.run_budget(run_id,release_id,subject_digest,operation,starts_ms,ends_ms,max_calls) VALUES ($1,$2,$3,$4,$5,$6,$7)',[runId,releaseId,digest,op,from,until,limit]);
    }
    const plan={enabled:true,environment:'development',origin,prefix,runId,release:releaseId,from,until,subjects};
    const providerCalls={send:0,verify:0};
    const provider={
      async send({outId}) {providerCalls.send++;return {outId,status:'accepted'};},
      async verify({outId,code:provided}) {providerCalls.verify++;return {outId,status:provided===code?'pass':'invalid'};},
    };
    const service=createOfflineQuizAccount({db,provider,runId,releaseId,phoneKey,browserKey,accountKey,sessionKey,score:approvedScore,
      preflight:createPreflight({plan,phoneKey,reserve:postgresReservation(db)})});
    const transport=createOfflineQuizTransport({service,enabled:true});
    server=createServer(async(req,res)=>{
      const local='localhost:'+server.address().port;
      if(dev) {
        // Applies before route selection: assets, unknown URLs and APIs all fail closed.
        res.setHeader('Cache-Control','no-store');
        res.setHeader('X-Content-Type-Options','nosniff');
        if(!devIngressAllowed(req,dev)) {res.writeHead(404);return res.end();}
        // Static helper must not replace the protected mode no-store policy.
        const setHeader=res.setHeader.bind(res);
        res.setHeader=(name,value)=>setHeader(name,name.toLowerCase()==='cache-control'?'no-store':value);
      } else if(req.headers.host!==local||req.socket.remoteAddress!=='127.0.0.1') {res.writeHead(404);return res.end();}
      if(!req.url?.startsWith(api))return renderStatic(req,res);
      const localhost=dev?origin:'http://'+local, caller=req.headers.origin;
      if ((caller!==undefined&&caller!==localhost) || (req.method==='POST'&&caller!==localhost) ||
          (req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')) {
        res.writeHead(403);return res.end();
      }
      try {
        let bytes=0;
        const chunks=[];
        for await(const chunk of req) {
          bytes+=chunk.length;
          if(bytes>12288) {res.writeHead(413);res.end();return;}
          chunks.push(chunk);
        }
        // Only the loopback adapter normalizes localhost to the transport origin.
        // Protected DEV already verified the exact HTTPS origin and private ingress token.
        if(dev&&!devIngressAllowed(req,dev)) {res.writeHead(404);res.end();return;}
        const h={...req.headers,host:'dev.douhaoyu.cn',origin:caller===undefined?undefined:origin};
        const r=await transport({path:req.url,method:req.method,headers:h,rawBody:Buffer.concat(chunks).toString('utf8')},true);
        res.writeHead(r.http,r.headers);
        res.end(JSON.stringify(r.body));
      } catch {if(!res.headersSent)res.writeHead(503,{'Cache-Control':'no-store'});res.end();}
    });
    if(dev) {server.requestTimeout=10000;server.headersTimeout=10000;server.timeout=10000;}
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(dev?.port ?? 0,'127.0.0.1',resolve);
    });
    return {
      url:dev?origin+prefix:'http://localhost:'+server.address().port+'/ceshi/',
      address:()=>server.address(),
      counts:()=>({...providerCalls}),
      close:async()=>{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await db.close();},
    };
  } catch(e) {if(server?.listening)server.close();await db.close();throw e;}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  if(!process.argv[2]||process.argv.length!==3) throw new Error('pass a locally generated Expo static export directory');
  const app=await makeLoopback(process.argv[2]);
  console.log('Synthetic localhost only: '+app.url);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{app.close().catch(()=>{process.exitCode=1;});});
}
