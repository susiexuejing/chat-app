// Draft standalone adapter. Copy adjacent to reviewed runtime.mjs only after review.
import {createServer, request} from 'node:http';
import {fstatSync,lstatSync,realpathSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {TextDecoder} from 'node:util';

export const SOCKET='/run/ef-quiz-account-dev/http.sock', FD_NAME='ef-quiz-account-http';
const BASE='/ceshi/api/auth/v1/', HOST='dev.douhaoyu.cn', ORIGIN='https://'+HOST;
const route=new Set(['POST challenge','POST verify','GET result','POST result','POST logout']);
const bounded=12288, utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const fixed={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const inspectHeaders=new Set(['host','origin','sec-fetch-site','cookie','content-type','content-length','transfer-encoding','expect']);
const forwarded=['host','origin','sec-fetch-site','cookie','content-type'];
const outputStatuses=new Set([200,400,401,403,404,409,422,503]);
const cookieRx=/^__Secure-ef_ceshi_real_(?:bind|session)=(?:[0-9a-f]{64}; Max-Age=900|; Max-Age=0); Path=\/ceshi\/; Secure; HttpOnly; SameSite=Strict$/;
const reply=(res,http,status)=>{res.writeHead(http,fixed);res.end(JSON.stringify({status}));};
const isUnix=socket=>socket.remoteAddress===undefined&&socket.localAddress===undefined;

function duplicates(req) {
  const seen=new Set();
  for(let i=0;i<req.rawHeaders.length;i+=2) {
    const key=req.rawHeaders[i].toLowerCase();
    if(inspectHeaders.has(key)&&seen.has(key))return true;
    seen.add(key);
  }
  return false;
}

async function body(req,size) {
  const chunks=[];let length=0;
  const timer=setTimeout(()=>req.destroy(),4000);
  try {
    for await(const chunk of req) {
      length+=chunk.length;if(length>size||length>bounded)throw new Error();
      chunks.push(chunk);
    }
    if(length!==size)throw new Error();
    return utf8.decode(Buffer.concat(chunks,length));
  } finally {clearTimeout(timer);}
}

export function createRequestHandler({dispatch, allowed=()=>false, startupProbe=()=>false}) {
  if(typeof dispatch!=='function')throw new TypeError('dispatch required');
  return (req,res)=>{
    void (async()=>{
      if(!isUnix(req.socket))return reply(res,404,'not-found');
      if(!allowed()) {
        if(!startupProbe(req,res))reply(res,404,'not-found');
        return;
      }
      const {method,url,headers}=req;
      if(typeof url!=='string'||!url.startsWith(BASE)||!route.has(method+' '+url.slice(BASE.length)))return reply(res,404,'not-found');
      if(duplicates(req)||headers['transfer-encoding']!==undefined||headers.expect!==undefined)return reply(res,400,'invalid-request');
      if(headers.host!==HOST)return reply(res,404,'not-found');
      if ((headers.origin!==undefined&&headers.origin!==ORIGIN)||
        (headers['sec-fetch-site']!==undefined&&headers['sec-fetch-site']!=='same-origin')||
        (method==='POST'&&headers.origin!==ORIGIN))return reply(res,403,'not-permitted');
      if(headers.cookie!==undefined&&(typeof headers.cookie!=='string'||headers.cookie.length>8192))return reply(res,400,'invalid-request');
      const cl=headers['content-length'];
      let rawBody='';
      if(method==='POST') {
        if(typeof cl!=='string'||!/^\d{1,5}$/.test(cl)||Number(cl)<1||
          !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(headers['content-type']??''))return reply(res,400,'invalid-request');
        if(Number(cl)>bounded)return reply(res,413,'invalid-request');
        try {rawBody=await body(req,Number(cl));} catch {if(!res.destroyed)reply(res,400,'invalid-request');return;}
      } else if(cl!==undefined&&cl!=='0')return reply(res,400,'invalid-request');
      if(res.destroyed||req.socket.destroyed)return;
      if(!allowed())return reply(res,404,'not-found');
      const input={};
      for(const key of forwarded)if(headers[key]!==undefined)input[key]=headers[key];
      const r=await dispatch({method,path:url,headers:input,rawBody},true);
      if(res.destroyed||req.socket.destroyed)return;
      if(!allowed())return reply(res,404,'not-found');
      if(!r||!outputStatuses.has(r.http)||!r.body||typeof r.body.status!=='string')return reply(res,503,'try-again');
      const out={...fixed};
      const cookies=r.headers?.['Set-Cookie'];
      if(cookies!==undefined) {
        if(!Array.isArray(cookies)||cookies.length>2||cookies.some(x=>typeof x!=='string'||!cookieRx.test(x)))return reply(res,503,'try-again');
        out['Set-Cookie']=cookies;
      }
      const data=JSON.stringify(r.body);
      if(Buffer.byteLength(data)>8192)return reply(res,503,'try-again');
      res.writeHead(r.http,out);res.end(data);
    })().catch(()=>{if(!res.headersSent&&!res.destroyed) {
      if(allowed())reply(res,503,'try-again');else reply(res,404,'not-found');
    } else if(!res.destroyed)res.destroy();});
  };
}

export function verifyFd(env=process.env, pid=process.pid, path=SOCKET, {stat=lstatSync, descriptor=fstatSync, realpath=realpathSync}={}) {
  if(env.LISTEN_PID!==String(pid)||env.LISTEN_FDS!=='1'||env.LISTEN_FDNAMES!==FD_NAME)throw new Error('Expected named Unix activation');
  const dir=dirname(path), d=stat(dir), p=stat(path);
  if(realpath(path)!==path||!d.isDirectory()||d.uid!==0||(d.mode&0o022)!==0||
    !p.isSocket()||p.uid!==0||(p.mode&0o777)!==0o660||!descriptor(3).isSocket())throw new Error('Untrusted Unix activation');
  return 3;
}

export function dispatchWindow(raw,now=Date.now) {
  try {
    if(typeof raw!=='string'||raw.length>1024)return ()=>false;
    const {from,until}=JSON.parse(raw);
    if(!Number.isSafeInteger(from)||!Number.isSafeInteger(until)||until<=from||until-from>900000)return ()=>false;
    return ()=>{const t=now();return Number.isSafeInteger(t)&&from<=t&&t<until;};
  } catch {return ()=>false;}
}

export async function listenActivated(createRuntime, isActive=()=>false) {
  const fd=verifyFd();
  let runtime,ready=false, observed=false;
  const nonce=randomBytes(32).toString('hex'), proof=randomBytes(32).toString('hex');
  const reqHandler=createRequestHandler({dispatch:(...args)=>runtime.dispatch(...args),allowed:()=>ready&&isActive(),
    startupProbe:(req,res)=>{
      if(observed||req.method!=='HEAD'||req.url!==BASE||req.headers.host!==HOST||
        req.headers['x-ef-unix-proof-challenge']!==nonce)return false;
      observed=true;res.writeHead(204,{'X-EF-Unix-Proof':proof,'Cache-Control':'no-store'});res.end();return true;
    }});
  const server=createServer({maxHeaderSize:12288,requestTimeout:6500,headersTimeout:3000,connectionsCheckingInterval:1000,keepAliveTimeout:1000},reqHandler);
  server.maxRequestsPerSocket=8;
  server.on('checkContinue',(_req,res)=>reply(res,417,'invalid-request'));
  server.on('checkExpectation',(_req,res)=>reply(res,417,'invalid-request'));
  server.on('connect',(_req,socket)=>socket.destroy());
  server.on('upgrade',(_req,socket)=>socket.destroy());
  try {
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen({fd},()=>{
        const address=server.address();
        if(address!==null&&address!==SOCKET)reject(new Error('Wrong inherited listener'));
        else resolve();
      });
    });
    await new Promise((resolve,reject)=>{
      const req=request({socketPath:SOCKET,path:BASE,method:'HEAD',agent:false,
        headers:{Host:HOST,'X-EF-Unix-Proof-Challenge':nonce}},res=>{
        res.resume();res.on('error',reject);
        res.on('end',()=>observed&&res.statusCode===204&&res.headers['x-ef-unix-proof']===proof?
          resolve():reject(new Error('Wrong Unix listener')));
      });
      const timeout=setTimeout(()=>req.destroy(new Error('Unix listener check timed out')),1500);
      req.on('error',reject);req.on('close',()=>clearTimeout(timeout));req.end();
    });
    if(!isActive())throw new Error('Quiz runtime disabled');
    runtime=await createRuntime();
    ready=runtime?.enabled===true&&typeof runtime.dispatch==='function';
    if(!ready||!isActive())throw new Error('Quiz runtime disabled');
    return {close:async()=>{
      ready=false;
      await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
      await runtime.close();
    }};
  } catch(e) {
    ready=false;
    if(server.listening){server.close();server.closeAllConnections();}
    await runtime?.close?.();
    throw e;
  }
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  if(process.argv.length!==2)throw new Error('No adapter arguments permitted');
  try {
    const isActive=dispatchWindow(process.env.EF_QUIZ_DEV_QA_PLAN);
    const app=await listenActivated(async()=>{
      const {createPublicQuizRuntime}=await import('./runtime.mjs');
      return createPublicQuizRuntime();
    },isActive);
    let stopping;
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopping??=app.close().catch(()=>{process.exitCode=1;});});
  } catch {console.error('Quiz Unix adapter did not start.');process.exitCode=1;}
}
