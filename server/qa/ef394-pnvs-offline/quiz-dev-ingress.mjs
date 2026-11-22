import {timingSafeEqual} from 'node:crypto';

export const ingressHeader='x-ef-ceshi-ingress';
const origin='https://dev.douhaoyu.cn';
const fields=['enabled','mode','ingressToken','startsMs','expiresMs','port'];
export function validateDevConfig(config, now=Date.now()) {
  if(!config || Object.keys(config).length!==fields.length || fields.some(k=>!Object.hasOwn(config,k)) ||
    config.enabled!==true || config.mode!=='protected-dev-synthetic' ||
    typeof config.ingressToken!=='string' || !/^[a-f0-9]{64}$/.test(config.ingressToken) ||
    new Set(config.ingressToken).size<8 ||
    !Number.isSafeInteger(config.startsMs) || !Number.isSafeInteger(config.expiresMs) ||
    config.startsMs>now || config.expiresMs<=now || config.expiresMs<=config.startsMs ||
    config.expiresMs-config.startsMs>900000 ||
    !Number.isInteger(config.port) || config.port<1024 || config.port>65535) {
    throw new Error('Invalid or expired protected DEV synthetic configuration');
  }
  return Object.freeze({...config});
}
export function devIngressAllowed(req,config,now=Date.now()) {
  const h=req.headers;
  const presentedProof=h[ingressHeader];
  // Reject duplicates even where Node would otherwise select the first Host value.
  const protectedHeaders=new Set(['host','origin','sec-fetch-site',ingressHeader]);
  const seen=new Set();
  for(let i=0;i<(req.rawHeaders?.length??0);i+=2) {
    const key=req.rawHeaders[i].toLowerCase();
    if(protectedHeaders.has(key)&&seen.has(key))return false;
    seen.add(key);
  }
  if(req.socket.remoteAddress!=='127.0.0.1' || now<config.startsMs || now>=config.expiresMs ||
    h.host!=='dev.douhaoyu.cn' || typeof presentedProof!=='string' || !/^[a-f0-9]{64}$/.test(presentedProof) ||
    !timingSafeEqual(Buffer.from(presentedProof,'hex'),Buffer.from(config.ingressToken,'hex')) ||
    (h.origin!==undefined&&h.origin!==origin) ||
    (!['GET','HEAD'].includes(req.method)&&h.origin!==origin) ||
    (h['sec-fetch-site']!==undefined&&h['sec-fetch-site']!=='same-origin'&&
      !(h['sec-fetch-site']==='none'&&['GET','HEAD'].includes(req.method)&&h.origin===undefined)))return false;
  // Strict origin-form path; no encoded routing or normalization ambiguity at proxy boundary.
  const raw=req.url;
  if(typeof raw!=='string'||!raw.startsWith('/ceshi/')||/[\\\u0000-\u0020]/.test(raw))return false;
  const path=raw.split('?')[0];
  if(path.includes('%')||path.includes('//')||path.split('/').some(p=>p==='.'||p==='..'))return false;
  // API paths never fall back to static assets, including unknown API endpoints.
  if(path.startsWith('/ceshi/api/')&&!raw.startsWith('/ceshi/api/v1/quiz-account/'))return false;
  return true;
}
