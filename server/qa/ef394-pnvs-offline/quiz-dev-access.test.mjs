import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createServer,request} from 'node:http';
import {mkdtemp,writeFile,chmod,symlink,link,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAccessServer,validateAccessConfig,readPrivateAccessConfig,accessCookie} from './quiz-dev-access.mjs';
const host='dev.douhaoyu.cn', origin='https://'+host, base='/ceshi/', api=base+'api/v1/quiz-account/';
const hash=s=>createHash('sha256').update(s).digest('hex');
const fixture=()=>{const now=Date.now(), oneTimeValue=randomBytes(32).toString('base64url');return {now,oneTimeValue,c:{enabled:true,mode:'protected-dev-synthetic',ingressToken:randomBytes(32).toString('hex'),passwordSha256:hash(oneTimeValue),startsMs:now-1000,expiresMs:now+600000,port:19440,backendPort:19441}};};
const listen=server=>new Promise((res,rej)=>{server.once('error',rej);server.listen(0,'127.0.0.1',()=>res(server.address().port));});
const shut=server=>new Promise((res,rej)=>{server.close(err=>err?rej(err):res());server.closeAllConnections();});
const talk=(port,path,opts={})=>new Promise((res,rej)=>{
 const {method='GET',headers={},body}=opts;
 const q=request({host:'127.0.0.1',port,path,method,headers:{host,...headers}},r=>{const arr=[];r.on('data',b=>arr.push(b));r.on('end',()=>res({status:r.statusCode,headers:r.headers,text:Buffer.concat(arr).toString()}));});
 q.on('error',rej);q.end(body);
});
function form(port, oneTimeValue, headers={}) {
 const values=new URLSearchParams((Array.isArray(oneTimeValue)?oneTimeValue:[oneTimeValue]).map(x=>['password',x]));
 return talk(port,base,{method:'POST',headers:{origin,'sec-fetch-site':'same-origin','content-type':'application/x-www-form-urlencoded',...headers},body:values.toString()});
}
test('configuration exact, owner-only, no symlink/hardlink, expiry at most 15 minutes', async t=>{
 const {now,c}=fixture();assert.deepEqual(validateAccessConfig(c,now),c);
 for(const change of [{enabled:false},{mode:'production'},{ingressToken:'0'.repeat(64)},{passwordSha256:'bad'},{backendPort:0},{backendPort:c.port},{extra:true},{startsMs:now+1},{expiresMs:now},{expiresMs:c.startsMs+900001}]){
  assert.throws(()=>validateAccessConfig({...c,...change},now));
 }
 const dir=await mkdtemp(join(tmpdir(),'ef-quiz-access-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const conf=join(dir,'fixture.json');
 await writeFile(conf,JSON.stringify(c),{mode:0o600});assert.deepEqual(await readPrivateAccessConfig(conf),c);
 await chmod(conf,0o644);await assert.rejects(readPrivateAccessConfig(conf));await chmod(conf,0o600);
 await symlink(conf,join(dir,'symlink'));await assert.rejects(readPrivateAccessConfig(join(dir,'symlink')));
 await link(conf,join(dir,'hardlink'));await assert.rejects(readPrivateAccessConfig(conf));
});
test('unauth isolation, password one-use, exact ingress and separate cookies, expiry',async t=>{
 const {now,oneTimeValue,c}=fixture();let current=now;
 const hits=[];
 const upstream=createServer((q,r)=>{const arr=[];q.on('data',x=>arr.push(x));q.on('end',()=>{hits.push({method:q.method,path:q.url,h:q.headers,body:Buffer.concat(arr).toString()});r.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'public; max-age=600','Set-Cookie':['__Secure-ef_ceshi_quiz_bind='+ 'a'.repeat(64)+'; Path=/ceshi/; Secure; HttpOnly; SameSite=Strict']});r.end('protected fixture');});});
 c.backendPort=await listen(upstream);t.after(()=>shut(upstream));
 const gate=createAccessServer(c,()=>current);const p=await listen(gate);t.after(()=>shut(gate));assert.equal(gate.address().address,'127.0.0.1');
 const intro=await talk(p,base,{headers:{'sec-fetch-site':'cross-site'}});
 assert.equal(intro.status,200);assert.match(intro.text,/type="password"/);assert.match(intro.headers['content-security-policy'],/default-src 'none'/);assert.doesNotMatch(intro.text,/protected fixture|<script|<link/);
 for(const path of [base+'asset.js',api+'result',api+'challenge'])assert.equal((await talk(p,path)).status,401,path);
 for(const path of ['/','/ceshi','/other','/ceshi/../x','/ceshi/%2e%2e/x','/ceshi//x','/ceshi/abc?secret=1'])assert.equal((await talk(p,path)).status,404,path);
 assert.equal((await talk(p,base,{headers:{host:'evil.example'}})).status,404);
 assert.equal((await form(p,oneTimeValue,{origin:'https://evil.example'})).status,404);
 assert.equal((await form(p,oneTimeValue,{'sec-fetch-site':'cross-site'})).status,403);
 assert.equal((await form(p,[oneTimeValue,oneTimeValue])).status,401);
 assert.equal((await form(p,'A'.repeat(43))).status,401);
 assert.deepEqual(hits,[]);
 const accepted=await form(p,oneTimeValue);
 assert.equal(accepted.status,303);assert.equal(accepted.headers.location,base);assert.equal(accepted.text.includes(oneTimeValue),false);
 const set=accepted.headers['set-cookie'][0];assert.match(set,/; Max-Age=\d+; Path=\/ceshi\/; Secure; HttpOnly; SameSite=Strict$/);assert.doesNotMatch(set,/Domain=/);
 const proof=set.split(';')[0];assert.equal(proof.split('=')[0],accessCookie);
 assert.equal((await form(p,oneTimeValue)).status,429);
 const inner='__Secure-ef_ceshi_quiz_session='+ 'b'.repeat(64);
 const acceptedHeaders={cookie:proof+'; '+inner+'; unrelated=do-not-forward','x-ef-ceshi-ingress':'forged','x-forwarded-host':'hijacked','sec-fetch-site':'same-origin',origin,'content-type':'application/json'};
 const good=await talk(p,api+'result',{method:'POST',headers:acceptedHeaders,body:'{}'});
 assert.equal(good.status,200);assert.equal(good.text,'protected fixture');assert.equal(good.headers['cache-control'],'no-store');assert.match(good.headers['set-cookie'][0],/__Secure-ef_ceshi_quiz_bind/);
 assert.equal(hits.length,1);assert.equal(hits[0].h['x-ef-ceshi-ingress'],c.ingressToken);assert.equal(hits[0].h.cookie,inner);assert.equal(hits[0].h['x-forwarded-host'],undefined);assert.equal(hits[0].h.origin,origin);assert.equal(hits[0].body,'{}');
 assert.equal((await talk(p,base+'assets/@scope+package/icon@2x.png',{headers:{cookie:proof}})).status,200);
 assert.equal((await talk(p,api+'result',{headers:{cookie:proof+'; '+proof}})).status,401);
 assert.equal((await talk(p,api+'result',{headers:{cookie:proof,'sec-fetch-site':'same-site'}})).status,401);
 assert.equal((await talk(p,api+'result',{method:'POST',headers:{cookie:proof},body:'{}'})).status,404);
 const huge='x'.repeat(12289);
 assert.equal((await talk(p,api+'result',{method:'POST',headers:{...acceptedHeaders,'content-length':huge.length},body:huge})).status,413);
 current=c.expiresMs;assert.equal((await talk(p,base,{headers:{cookie:proof}})).status,404);
 assert.equal(hits.length,2);
});
test('wrong password capped and cannot reach upstream, even with forged inner proof',async t=>{
 const {now,oneTimeValue,c}=fixture();
 const gate=createAccessServer(c,()=>now);const p=await listen(gate);t.after(()=>shut(gate));
 for(let i=0;i<8;i++)assert.equal((await form(p,'X'.repeat(43))).status,401);
 assert.equal((await form(p,oneTimeValue)).status,429);
 assert.equal((await talk(p,api+'result',{headers:{[accessCookie]:'a'.repeat(64),'x-ef-ceshi-ingress':c.ingressToken}})).status,401);
});
