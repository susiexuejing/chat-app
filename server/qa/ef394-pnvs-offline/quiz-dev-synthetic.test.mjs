import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {request,createServer} from 'node:http';
import {mkdtemp,writeFile,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateDevConfig,devIngressAllowed,ingressHeader} from './quiz-dev-ingress.mjs';
import {readPrivateDevConfig} from './quiz-dev-synthetic.mjs';
import {makeProtectedDev} from './quiz-loopback.mjs';
import {questions} from './approved-quiz93.mjs';
const fixture=()=>({enabled:true,mode:'protected-dev-synthetic',ingressToken:randomBytes(32).toString('hex'),startsMs:Date.now()-1000,expiresMs:Date.now()+600000,port:19495});
const reqFor=(config,url='/ceshi/')=>({url,method:'GET',headers:{host:'dev.douhaoyu.cn',[ingressHeader]:config.ingressToken},rawHeaders:[],socket:{remoteAddress:'127.0.0.1'}});
test('explicit mode, strong-format secret and bounded non-renewing window fail closed',()=>{
 const c=fixture();assert.deepEqual(validateDevConfig(c),c);
 for(const change of [{enabled:false},{mode:'production'},{ingressToken:'0'.repeat(64)},{ingressToken:'x'},{port:0},{port:65536},{expiresMs:c.startsMs+900001},{expiresMs:Date.now()-1},{startsMs:Date.now()+10000},{extra:true}])assert.throws(()=>validateDevConfig({...c,...change}));
 const r=reqFor(c);assert.equal(devIngressAllowed(r,c),true);
 for(const url of ['/','/ceshi','/other','/ceshi/../secret','/ceshi/%2e%2e/secret','/ceshi/a%2fb','/ceshi//x','/ceshi/\\x','https://dev.douhaoyu.cn/ceshi/','/ceshi/api/unknown'])assert.equal(devIngressAllowed({...r,url},c),false,url);
 for(const headers of [{host:'dev.douhaoyu.cn:443'},{host:'localhost'},{origin:'http://dev.douhaoyu.cn'},{origin:'https://evil.test'},{[ingressHeader]:undefined},{[ingressHeader]:randomBytes(32).toString('hex')},{'sec-fetch-site':'cross-site'}])assert.equal(devIngressAllowed({...r,headers:{...r.headers,...headers}},c),false);
 assert.equal(devIngressAllowed({...r,socket:{remoteAddress:'::1'}},c),false);
 assert.equal(devIngressAllowed({...r,method:'POST'},c),false);
 assert.equal(devIngressAllowed({...r,method:'POST',headers:{...r.headers,origin:'https://dev.douhaoyu.cn'}},c),true);
 assert.equal(devIngressAllowed({...r,rawHeaders:['Host','dev.douhaoyu.cn','host','evil.test']},c),false);
 assert.equal(devIngressAllowed(r,c,c.expiresMs),false);
 assert.equal(devIngressAllowed(r,c,c.startsMs-1),false);
});
test('private config refuses broad permissions and symlinks',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ef-private-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'config.json');await writeFile(path,JSON.stringify(fixture()),{mode:0o600});
 assert.equal((await readPrivateDevConfig(path)).enabled,true);
 await chmod(path,0o644);await assert.rejects(readPrivateDevConfig(path));
 await chmod(path,0o600);await symlink(path,join(dir,'link'));await assert.rejects(readPrivateDevConfig(join(dir,'link')));
});
const freePort=async()=>{const s=createServer();await new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',r);});const p=s.address().port;await new Promise(r=>s.close(r));return p;};
test('HTTP full surface ingress, synthetic two-fixture auth and app API unchanged',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ef-protected-'));let app;
 t.after(async()=>{try{if(app)await app.close();}finally{await rm(dir,{recursive:true,force:true});}});
 await writeFile(join(dir,'index.html'),'synthetic fixture');await writeFile(join(dir,'asset.js'),'/* fixture */');
 const c={...fixture(),port:await freePort()};app=await makeProtectedDev(dir,c);assert.equal(app.address().address,'127.0.0.1');
 const send=(path,method='GET',body,headers={})=>new Promise((resolve,reject)=>{
  const q=request({host:'127.0.0.1',port:c.port,path,method,headers:{host:'dev.douhaoyu.cn',[ingressHeader]:c.ingressToken,...(method==='POST'?{origin:'https://dev.douhaoyu.cn','content-type':'application/json'}:{}),...headers}},r=>{const chunks=[];r.on('data',b=>chunks.push(b));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,text:Buffer.concat(chunks).toString()}));});q.on('error',reject);q.end(body===undefined?undefined:JSON.stringify(body));
 });
 const api='/ceshi/api/v1/quiz-account/';
 for(const path of ['/ceshi/','/ceshi/asset.js',api+'result','/ceshi/unknown','/api/auth/login','/ceshi/api/unknown']) {
  assert.equal((await send(path,'GET',undefined,{[ingressHeader]:''})).status,404);
  assert.equal((await send(path,'GET',undefined,{host:'evil.test'})).status,404);
  assert.equal((await send(path,'GET',undefined,{origin:'https://evil.test'})).status,404);
 }
 assert.equal((await send('/ceshi/')).text,'synthetic fixture');assert.equal((await send('/ceshi/asset.js')).headers['cache-control'],'no-store');
 assert.equal((await send('/api/auth/login')).status,404);assert.equal((await send('/ceshi/unknown')).status,404);
 assert.equal((await send(api+'unknown')).status,404);assert.equal((await send(api+'result?x=1')).status,404);
 assert.equal((await send(api+'result')).status,401);
 assert.equal((await send(api+'challenge','POST',{phone:'+8613800000000',requestId:'f'.repeat(32)})).status,422);
 assert.deepEqual(app.counts(),{send:0,verify:0});
 const cookie=r=>(r.headers['set-cookie']??[]).map(v=>v.split(';')[0]).join('; ');
 let firstCookies;
 for(const [i,phone] of ['+8613000000000','+8613900000000'].entries()) {
  const sent=await send(api+'challenge','POST',{phone,requestId:String(i+1).repeat(32)});assert.equal(sent.status,200);
  const verified=await send(api+'verify','POST',{phone,code:'000000',challengeId:JSON.parse(sent.text).challengeId,consent:true},{cookie:cookie(sent)});assert.equal(verified.status,200);
  assert.match(verified.headers['set-cookie'].join(';'),/Secure; HttpOnly; SameSite=Strict/);
  const cookies=cookie(verified);
  assert.equal(JSON.parse((await send(api+'result','GET',undefined,{cookie:cookies})).text).report,null);
  const saved=await send(api+'result','POST',{submissionId:String(i+3).repeat(32),choices:questions.map(({id})=>({id,option:i?'B':'A'}))},{cookie:cookies});assert.equal(saved.status,200);
  if(i===0)firstCookies=cookies;
 }
 assert.deepEqual(app.counts(),{send:2,verify:2});
 assert.equal((await send(api+'logout','POST',{}, {cookie:firstCookies})).status,200);
 assert.equal((await send(api+'result','GET',undefined,{cookie:firstCookies})).status,401);
});
