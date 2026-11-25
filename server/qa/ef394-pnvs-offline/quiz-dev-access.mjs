import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {createServer, request as upstreamRequest} from 'node:http';
import {pathToFileURL} from 'node:url';

export const accessCookie = '__Secure-ef_ceshi_qa_access';
const ingressHeader = 'x-ef-ceshi-ingress';
const host = 'dev.douhaoyu.cn', origin = 'https://' + host, prefix = '/ceshi/';
const digest = /^[a-f0-9]{64}$/;
const fields = ['enabled','mode','ingressToken','passwordSha256','startsMs','expiresMs','port','backendPort'];
const maxAttempts = 8;
const maxPost = 12288;
const maxLogin = 768;
const safeOrigin = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Frame-Options':'DENY'};
const formCsp = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const form = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>EmotionFlow 测试预览</title><main><h1>EmotionFlow 测试预览</h1><p>仅限本次授权测试。请输入临时预览密码，不要输入个人账号密码。</p><form action="/ceshi/" method="post"><label>临时预览密码 <input name="password" type="password" required maxlength="128" autocomplete="off"></label><button type="submit">进入测试</button></form></main></html>';
const portOK = v => Number.isInteger(v) && v >= 1024 && v <= 65535;

export function validateAccessConfig(c, now = Date.now()) {
  if (!c || Object.keys(c).length !== fields.length || fields.some(k => !Object.hasOwn(c,k)) ||
      c.enabled !== true || c.mode !== 'protected-dev-synthetic' ||
      typeof c.passwordSha256 !== 'string' || !digest.test(c.passwordSha256) || new Set(c.passwordSha256).size < 8 ||
      typeof c.ingressToken !== 'string' || !digest.test(c.ingressToken) || new Set(c.ingressToken).size < 8 ||
      c.ingressToken === c.passwordSha256 ||
      !portOK(c.port) || !portOK(c.backendPort) || c.port === c.backendPort ||
      !Number.isSafeInteger(c.startsMs) || !Number.isSafeInteger(c.expiresMs) ||
      c.startsMs > now || c.expiresMs <= now || c.expiresMs-c.startsMs > 900000) {
    throw new Error('Invalid or expired protected DEV access configuration');
  }
  return Object.freeze({...c});
}

export async function readPrivateAccessConfig(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('Absolute private access config path required');
  const file = await open(path, constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode&0o077) !== 0 || stat.nlink !== 1 || stat.size > 4096 ||
        (stat.uid !== process.getuid() && stat.uid !== 0)) throw new Error('Private access config must be an owner-only regular file');
    const data = Buffer.alloc(4097);
    const {bytesRead} = await file.read(data,0,data.length,0);
    if (bytesRead > 4096) throw new Error('Private access configuration is too large');
    try {return validateAccessConfig(JSON.parse(data.subarray(0,bytesRead).toString('utf8')));}
    catch {throw new Error('Invalid or expired protected DEV access configuration');}
  } finally {await file.close();}
}

function routeAllowed(req) {
  if(req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== host ||
     !['GET','HEAD','POST'].includes(req.method) ||
     typeof req.url !== 'string' || !/^\/ceshi\/[0-9a-zA-Z_.+@\/-]{0,1024}$/.test(req.url) ||
     req.url.includes('//') || req.url.split('/').some(x=>x==='.'||x==='..')) return false;
  const caller=req.headers.origin;
  return (caller===undefined || caller===origin) && (req.method !== 'POST' || caller===origin);
}
function duplicateSensitiveHeader(req) {
  const checked=new Set(['host','origin','sec-fetch-site','cookie','content-type','transfer-encoding','content-length']);
  const seen = new Set();
  for(let i=0;i<req.rawHeaders.length;i+=2) {
    const k=req.rawHeaders[i].toLowerCase();
    if(checked.has(k)&&seen.has(k))return true;
    seen.add(k);
  }
  return false;
}
function cookies(header) {
  if (header===undefined) return {proof: null, inner:[]};
  if (typeof header!=='string' || header.length>8192) return null;
  const inner = [], seen = new Set();
  let proof = null;
  for(const field of header.split(';')) {
    const [name,...rest] = field.trim().split('=');
    const value = rest.join('=');
    if(![accessCookie,'__Secure-ef_ceshi_quiz_bind','__Secure-ef_ceshi_quiz_session'].includes(name))continue;
    if(seen.has(name)||!digest.test(value))return null;
    seen.add(name);
    if(name===accessCookie)proof=value; else inner.push(name+'='+value);
  }
  return {proof,inner};
}
function answer(res, status, body='', more={}) {
  if(res.headersSent) {res.destroy();return;}
  res.writeHead(status,{...safeOrigin,...more});res.end(body);
}
function formReply(req,res,status) {
  answer(res,status,req.method==='HEAD'?'':form,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':formCsp});
}
async function postBody(req, limit) {
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared)>limit)) return null;
  let size=0;const chunks=[];
  for await(const chunk of req.iterator({destroyOnReturn:false})) {
    size+=chunk.length;
    if(size>limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,size);
}
function proxy(req,res,c,inner,body) {
  const headers={host,[ingressHeader]:c.ingressToken};
  const h=req.headers;
  for(const key of ['origin','sec-fetch-site','content-type'])if(h[key]!==undefined)headers[key]=h[key];
  if(inner.length)headers.cookie=inner.join('; ');
  if(req.method==='POST')headers['content-length']=body.length;
  const p=upstreamRequest({hostname:'127.0.0.1',port:c.backendPort,path:req.url,method:req.method,headers,agent:false,timeout:5000},r=>{
    const out={...safeOrigin};
    for(const key of ['content-type','content-security-policy','cross-origin-resource-policy','cross-origin-opener-policy','content-length','permissions-policy','set-cookie','x-ef-quiz-release']) {
      if(r.headers[key]!==undefined)out[key]=r.headers[key];
    }
    if(r.statusCode>=300&&r.statusCode<400){r.resume();answer(res,502);return;}
    res.writeHead(r.statusCode??502,out);
    r.on('error',()=>res.destroy());
    r.pipe(res);
  });
  p.on('timeout',()=>p.destroy());
  p.on('error',()=>{if(!res.destroyed)answer(res,502);});
  res.on('close',()=>{if(!res.writableEnded)p.destroy();});
  p.end(req.method==='POST'?body:undefined);
}

export function createAccessServer(config, clock=Date.now) {
  const c=validateAccessConfig(config,clock());
  let attempts=0, used=false;
  const sessions=new Set();
  const windowActive=()=>clock()>=c.startsMs&&clock()<c.expiresMs;
  const server=createServer({maxHeaderSize:12288,requestTimeout:10000,headersTimeout:5000,keepAliveTimeout:2000}, (req,res)=>{
    void (async()=>{
      if(!windowActive()||duplicateSensitiveHeader(req)||!routeAllowed(req))return answer(res,404);
      const site=req.headers['sec-fetch-site'];
      const same=site===undefined||site==='same-origin'||(site==='none'&&req.method!=='POST');
      const cred=cookies(req.headers.cookie);
      const authorized=same && Boolean(cred?.proof && sessions.has(cred.proof));
      if(req.url===prefix && req.method==='POST') {
        if(!same||authorized||!cred||!/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))return answer(res,403);
        if(used||attempts>=maxAttempts)return answer(res,429);
        attempts++;
        const raw=await postBody(req,maxLogin);
        if(!raw)return answer(res,413,'',{'Connection':'close'});
        const values=[...new URLSearchParams(raw.toString('utf8'))];
        const pass=values.length===1&&values[0][0]==='password'?values[0][1]:'';
        if(used||!windowActive() || !/^[A-Za-z0-9_-]{32,128}$/.test(pass) ||
           !timingSafeEqual(createHash('sha256').update(pass).digest(),Buffer.from(c.passwordSha256,'hex')))return formReply(req,res,401);
        const ttl=Math.floor((c.expiresMs-clock())/1000);
        if(ttl<1)return answer(res,403);
        const sessionId=randomBytes(32).toString('hex');used=true;sessions.add(sessionId);
        return answer(res,303,'',{'Location':prefix,'Set-Cookie':accessCookie+'='+sessionId+'; Max-Age='+ttl+'; Path='+prefix+'; Secure; HttpOnly; SameSite=Strict'});
      }
      if(!authorized) {
        if(req.url===prefix&&['GET','HEAD'].includes(req.method))return formReply(req,res,200);
        return answer(res,401);
      }
      let body;
      if(req.method==='POST') {
        body=await postBody(req,maxPost);
        if(!body)return answer(res,413,'',{'Connection':'close'});
      }
      if(!windowActive())return answer(res,404);
      return proxy(req,res,c,cred.inner,body);
    })().catch(()=>{if(!res.destroyed)answer(res,503);});
  });
  server.on('connection',socket=>socket.setTimeout(10000,()=>socket.destroy()));
  return server;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  if(process.argv.length!==3)throw new Error('Usage: quiz-dev-access.mjs ABSOLUTE_PRIVATE_CONFIG_JSON');
  const config=await readPrivateAccessConfig(process.argv[2]);
  const server=createAccessServer(config);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'127.0.0.1',resolve);});
  console.log('Protected DEV access gate bound to 127.0.0.1:'+config.port+'; expires '+new Date(config.expiresMs).toISOString());
  const stop=()=>{server.close();server.closeAllConnections();};
  const timer=setTimeout(stop,config.expiresMs-Date.now());
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{clearTimeout(timer);stop();});
}
