import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createServer,request} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequestHandler,verifyFd,dispatchWindow,SOCKET,FD_NAME} from './unix-http.mjs';

const URL='/ceshi/api/auth/v1/', host='dev.douhaoyu.cn', origin='https://'+host;
const inputs={host,origin,'content-type':'application/json','content-length':'2'};
const cookie='__Secure-ef_ceshi_real_bind='+'a'.repeat(64)+'; Max-Age=900; Path=/ceshi/; Secure; HttpOnly; SameSite=Strict';
function exercise({url=URL+'challenge',method='POST',headers=inputs,raw,bytes=Buffer.from('{}'),socket={},allowed=true,result,dispatchHook}={}) {
  const calls=[];
  const handler=createRequestHandler({allowed:typeof allowed==='function'?allowed:()=>allowed,dispatch:async(...args)=>{
    calls.push(args);
    dispatchHook?.();
    if(result instanceof Error)throw result;
    return result??{http:200,headers:{'Set-Cookie':[cookie],'X-Secret-Header':'never forwarded'},body:{status:'pending',challengeId:'1'.repeat(32)}};
  }});
  return new Promise(resolve=>{
    const req=Object.assign(Readable.from([bytes]),{url,method,socket,headers,rawHeaders:raw??Object.entries(headers).flat()});
    const reply={};const res={writeHead:(code,out)=>Object.assign(reply,{code,out}),end:value=>resolve({...reply,value:JSON.parse(value),calls})};
    handler(req,res);
  });
}

test('five exact route-method contract with fixed forwarded fields and verified Unix decision',async()=>{
  for(const [method,path] of [['POST','challenge'],['POST','verify'],['GET','result'],['POST','result'],['POST','logout']]) {
    const withBogus=method==='GET'?{host,'x-ef-ceshi-ingress':'fake'}:{...inputs,'x-ef-ceshi-ingress':'fake',authorization:'never','x-forwarded-for':'fake'};
    const r=await exercise({url:URL+path,method,headers:withBogus});
    assert.equal(r.code,200);
    const expected=method==='GET'?{host}:{host,origin,'content-type':'application/json'};
    assert.deepEqual(r.calls,[[{method,path:URL+path,headers:expected,rawBody:method==='GET'?'':'{}'},true]]);
    assert.deepEqual(r.out['Set-Cookie'],[cookie]); assert.equal(r.out['X-Secret-Header'],undefined);
    assert.equal(r.out['Cache-Control'],'no-store');
  }
});
test('TCP, unavailable listener, prefixes, absolute paths, queries and unsupported methods never dispatch',async()=>{
  for(const example of [{socket:{remoteAddress:'127.0.0.1',localAddress:'127.0.0.1'}},{allowed:false},
    {url:'/'+URL+'challenge'},{url:'https://'+host+URL+'challenge'},{url:URL+'challenge?x=1'},
    {url:URL+'%63hallenge'},{url:'/ceshi/api/v1/quiz-account/challenge'},{method:'HEAD'},
    {method:'OPTIONS'},{url:URL+'challenge/'},{headers:{...inputs,host:'elsewhere.example'}}]) {
    const r=await exercise(example);assert.equal(r.code,404);assert.deepEqual(r.calls,[]);
  }
});
test('scope, duplicate headers, charset and body framing are refused',async()=>{
  for(const [example,code] of [
    [{headers:{...inputs,origin:'https://wrong.example'}},403],
    [{headers:{...inputs,'sec-fetch-site':'cross-site'}},403],
    [{headers:{host,'content-type':'application/json','content-length':'2'}},403],
    [{raw:[...Object.entries(inputs).flat(),'Host','duplicate']},400],
    [{headers:{...inputs,'transfer-encoding':'chunked'}},400],
    [{headers:{...inputs,expect:'100-continue'}},400],
    [{headers:{...inputs,'content-type':'application/json; charset=latin1'}},400],
    [{headers:{...inputs,'content-length':'12289'}},413],
    [{headers:{...inputs,'content-length':'3'}},400],
    [{bytes:Buffer.from([0xff,0xfe])},400],
    [{headers:{...inputs,cookie:'x'.repeat(8193)}},400],
  ]) {
    const r=await exercise(example);assert.equal(r.code,code);assert.deepEqual(r.calls,[]);
  }
});
test('failure and non-contract response do not expose accidental response fields',async()=>{
  for(const result of [new Error('nonpublic data'),{http:302,body:{status:'redirect'}},
    {http:200,headers:{'Set-Cookie':['external=data']},body:{status:'verified'}},
    {http:200,body:{status:'pending',unexpected:'x'.repeat(8192)}}]) {
    const r=await exercise({result});assert.equal(r.code,503);assert.deepEqual(r.value,{status:'try-again'});
  }
});
test('activation claims exact process, descriptor, named filesystem Unix service',()=>{
  const env={LISTEN_PID:'77',LISTEN_FDS:'1',LISTEN_FDNAMES:FD_NAME};
  const dir={uid:0,mode:0o755,isDirectory:()=>true};
  const file={uid:0,mode:0o660,isSocket:()=>true};
  const deps={stat:path=>path===SOCKET?file:dir,descriptor:fd=>({isSocket:()=>fd===3}),realpath:path=>path};
  assert.equal(verifyFd(env,77,SOCKET,deps),3);
  for(const override of [{LISTEN_PID:'78'},{LISTEN_FDS:'2'},{LISTEN_FDNAMES:'wrong'}]) {
    assert.throws(()=>verifyFd({...env,...override},77,SOCKET,deps));
  }
  assert.throws(()=>verifyFd(env,77,SOCKET,{...deps,realpath:()=>'/somewhere-else'}));
  assert.throws(()=>verifyFd(env,77,SOCKET,{...deps,stat:()=>({...file,mode:0o666})}));
  assert.throws(()=>verifyFd(env,77,SOCKET,{...deps,descriptor:()=>({isSocket:()=>false})}));
});
test('real local filesystem Unix listener passes synthetic-only dispatch',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'quiz-dev-unix-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'http.sock');const calls=[];
  const server=createServer(createRequestHandler({allowed:()=>true,dispatch:async(...args)=>{
    calls.push(args);return {http:401,body:{status:'login-required'}};
  }}));
  try {await new Promise((r,j)=>{server.once('error',j);server.listen(path,r);});}
  catch(e){if(process.env.EF_QUIZ_REQUIRE_UNIX_SMOKE!=='1'&&['EPERM','EACCES','ENOSYS','EAFNOSUPPORT'].includes(e.code)){t.skip('filesystem Unix socket unavailable: '+e.code);return;}throw e;}
  t.after(()=>new Promise(r=>server.close(r)));
  const r=await new Promise((resolve,reject)=>{
    const q=request({socketPath:path,path:URL+'result',headers:{host}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    q.on('error',reject);q.end();
  });
  assert.equal(r,401);assert.equal(calls.length,1);assert.equal(calls[0][1],true);
});

test('window closure after body or dispatch returns 404, not report or Set-Cookie',async()=>{
  let n=0;
  const before=await exercise({allowed:()=>++n===1});
  assert.equal(before.code,404);assert.deepEqual(before.calls,[]);
  let active=true;
  const after=await exercise({allowed:()=>active,dispatchHook:()=>{active=false;}});
  assert.equal(after.code,404);assert.equal(after.out['Set-Cookie'],undefined);
  assert.deepEqual(after.value,{status:'not-found'});assert.equal(after.calls.length,1);
});
test('trusted runtime plan window defaults closed and honors exact cutoff',()=>{
  let at=100;
  const clock=()=>at;
  for(const raw of [undefined,'{','null','{}','{"from":1,"until":900002}','{"from":900,"until":100}'])assert.equal(dispatchWindow(raw,clock)(),false);
  const policy=dispatchWindow('{"from":100,"until":200}',clock);
  assert.equal(policy(),true);at=200;assert.equal(policy(),false);
});
