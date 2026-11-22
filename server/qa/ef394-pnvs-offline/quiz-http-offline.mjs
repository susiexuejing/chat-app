import { randomBytes } from 'node:crypto';
import { fromQuestionChoices, summarize } from './approved-quiz93.mjs';

const origin = 'https://dev.douhaoyu.cn', prefix = '/ceshi/';
const routes = Object.freeze({
  offline: Object.freeze({base:prefix+'api/v1/quiz-account/',bindName:'__Secure-ef_ceshi_quiz_bind',sessionName:'__Secure-ef_ceshi_quiz_session',sendAssent:false,cookieTtl:3600}),
  devAccount: Object.freeze({base:prefix+'api/auth/v1/',bindName:'__Secure-ef_ceshi_real_bind',sessionName:'__Secure-ef_ceshi_real_session',sendAssent:true,cookieTtl:900}),
});
const abc = /^[0-9a-f]{64}$/;
const verbs = new Map([['POST challenge','send'],['POST verify','verify'],['POST result','save'],['GET result','read'],['POST logout','logout']]);
const cookie = (n,v,maxAge) => `${n}=${v}; Max-Age=${maxAge}; Path=${prefix}; Secure; HttpOnly; SameSite=Strict`;
const reply = (http,body,setCookies=[]) => ({http,headers:{
  'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',
  ...(setCookies.length ? {'Set-Cookie':setCookies} : {}),
},body});

function readCredentials(header, bindName, sessionName) {
  if (header === undefined) return {};
  if (typeof header !== 'string' || header.length > 8192) return null;
  const seen = new Map();
  for (const field of header.split(';')) {
    const s = field.trim();
    const equals = s.indexOf('=');
    const name = equals >= 0 ? s.slice(0,equals).trim() : s;
    if (name !== bindName && name !== sessionName) continue;
    const value = equals >= 0 ? s.slice(equals+1) : '';
    if (seen.has(name) || !abc.test(value)) return null;
    seen.set(name,value);
  }
  return {bind:seen.get(bindName),session:seen.get(sessionName)};
}

// Unmounted, offline transport seam. verifiedIngress is a trusted adapter
// decision, never a header or property parsed from the HTTP JSON payload.
export function createOfflineQuizTransport(options) {
  return createTransport(options, routes.offline);
}

export function createDevAccountTransport(options) {
  return createTransport(options, routes.devAccount);
}

function createTransport({ service, enabled = false }, {base,bindName,sessionName,sendAssent,cookieTtl}) {
  return async function dispatch(request, verifiedIngress = false) {
    const { method, path, headers = {}, rawBody = '' } = request;
    const operation = typeof path === 'string' && path.startsWith(base) ? verbs.get(`${method} ${path.slice(base.length)}`) : null;
    if (enabled !== true || verifiedIngress !== true || !operation || headers.host !== 'dev.douhaoyu.cn') {
      return reply(404,{status:'not-found'});
    }
    if ((headers.origin !== undefined && headers.origin !== origin) ||
        (headers['sec-fetch-site'] !== undefined && headers['sec-fetch-site'] !== 'same-origin') ||
        (method === 'POST' && headers.origin !== origin)) return reply(403,{status:'not-permitted'});
    const creds = readCredentials(headers.cookie,bindName,sessionName);
    if (!creds) return reply(400,{status:'invalid-request'});
    let body = {};
    if (method === 'POST') {
      if (typeof rawBody !== 'string' || Buffer.byteLength(rawBody) > 12288 ||
          !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(headers['content-type'] || '')) {
        return reply(400,{status:'invalid-request'});
      }
      try { body = JSON.parse(rawBody); } catch { return reply(400,{status:'invalid-request'}); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400,{status:'invalid-request'});
    }
    if (operation === 'send' && sendAssent && body.consent !== true) return reply(400,{status:'consent-required'});
    const fields = {send:sendAssent?['phone','requestId','consent']:['phone','requestId'],verify:['phone','code','challengeId','consent'],save:['submissionId','choices'],read:[],logout:[]}[operation];
    if (Object.keys(body).length !== fields.length || fields.some(k=>!Object.hasOwn(body,k))) return reply(400,{status:'invalid-request'});
    try {
      if (operation === 'send') {
        const bind = creds.bind ?? randomBytes(32).toString('hex');
        const r = await service.send({ origin,prefix,phone:body.phone,requestId:body.requestId,bind });
        return r.status === 'pending'
          ? reply(200,{status:r.status,challengeId:r.challengeId},[cookie(bindName,bind,cookieTtl)])
          : reply(422,{status:'not-verified'});
      }
      if (operation === 'verify') {
        if (body.consent !== true) return reply(400,{status:'consent-required'});
        const r = await service.verify({ origin,prefix,phone:body.phone,code:body.code,challengeId:body.challengeId,consent:body.consent,bind:creds.bind });
        if (r.status !== 'verified' || !abc.test(r.session ?? '') || !creds.bind) return reply(422,{status:'not-verified'});
        return reply(200,{status:'verified'},[cookie(bindName,creds.bind,cookieTtl),cookie(sessionName,r.session,cookieTtl)]);
      }
      let r;
      if (operation === 'save') {
        let answers;
        try { answers = fromQuestionChoices(body.choices); } catch { return reply(400,{status:'invalid-submission'}); }
        r = await service.save({...creds,submissionId:body.submissionId,answers});
      } else r = await service[operation](creds);
      if (r.status === 'login-required') return reply(401,r);
      if (r.status === 'try-again') return reply(503,r);
      if (r.status === 'submission-conflict') return reply(409,r);
      if (r.status === 'invalid-submission') return reply(400,r);
      if (operation === 'logout' && r.status === 'signed-out') return reply(200,r,[cookie(sessionName,'',0),cookie(bindName,'',0)]);
      if ((operation === 'save' && r.status === 'saved') || (operation === 'read' && r.status === 'signed-in')) {
        return reply(200,{status:r.status,report:r.report ? {id:r.report.id,...summarize(r.report.scores)} : null});
      }
      return reply(503,{status:'try-again'});
    } catch { return reply(503,{status:'try-again'}); }
  };
}
