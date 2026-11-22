import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Readable} from 'node:stream';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http2 from 'node:http2';
import dgram from 'node:dgram';
import {createAliyunPnvs} from './pnvs.mjs';

test('installed PNVS SDK signs and serializes once; transport intercepted without network',async t=>{
  const rejectNetwork=()=>{assert.fail('network forbidden in SDK verification');};
  t.mock.method(net.Socket.prototype,'connect',rejectNetwork);
  t.mock.method(tls,'connect',rejectNetwork);
  t.mock.method(http2,'connect',rejectNetwork);
  t.mock.method(dns,'lookup',rejectNetwork);
  t.mock.method(dgram,'createSocket',rejectNetwork);
  t.mock.method(globalThis,'fetch',rejectNetwork);
  const require=createRequire(new URL('./pnvs-deps/package.json',import.meta.url));
  const sdk='@alicloud/dypnsapi20170525';
  const sdkRequire=createRequire(require.resolve(sdk));
  const dara=sdkRequire('@darabonba/typescript');
  const prior=Object.getOwnPropertyDescriptor(dara,'doAction');
  t.after(()=>Object.defineProperty(dara,'doAction',prior));
  assert.equal(require(sdk+'/package.json').version,'2.0.0');

  const target='dypnsapi.aliyuncs.com';
  const id='1'.repeat(32);
  const phone='+8613000000000';
  const code='123456';
  const calls=[];
  const token='qa-only';
  let outcome='ok';
  const action=(req,runtime)=>{
    assert.equal(req.protocol,'HTTPS');
    assert.equal(req.headers.host,target);
    assert.equal(req.headers['x-acs-security-token'],token);
    assert.match(req.headers.Authorization,/^ACS3-HMAC-SHA256 /);
    assert.equal(req.query.PhoneNumber,phone.slice(3));
    assert.equal(req.query.OutId,id);
    assert.equal(req.query.CountryCode,'86');
    assert.equal(req.query.SchemeName,'fixture-scheme');
    assert.equal(runtime.retryOptions.retryable,false);
    assert.equal(runtime.connectTimeout,2500);
    assert.equal(runtime.readTimeout,4500);
    const name=req.headers['x-acs-action'];
    calls.push(name);
    if(name==='SendSmsVerifyCode'){
      assert.equal(req.method,'POST');
      assert.equal(req.query.ReturnVerifyCode,'false');
      assert.equal(req.query.AutoRetry,'0');
      assert.equal(req.query.DuplicatePolicy,'2');
      assert.equal(req.query.ValidTime,'300');
      assert.equal(req.query.Interval,'60');
      assert.equal(req.query.CodeLength,'6');
      assert.equal(req.query.CodeType,'1');
      assert.deepEqual(JSON.parse(req.query.TemplateParam),{code:'##code##',min:'5'});
    }else{
      assert.equal(name,'CheckSmsVerifyCode');
      assert.equal(req.query.VerifyCode,code);
    }
    if(outcome==='network-error'){
      const erro=new Error('injected timeout');
      erro.code='ETIMEDOUT';
      throw erro;
    }
    const statusCode=outcome==='503'?503:200;
    const body=statusCode===503?{Code:'ServiceUnavailable'}:{
      Code:'OK',Success:true,Model:{OutId:outcome==='mismatch'?'2'.repeat(32):id,
        ...(name==='CheckSmsVerifyCode'?{VerifyResult:outcome==='unknown'?'UNKNOWN':'PASS'}:{})},
    };
    return {statusCode,headers:{'content-type':'application/json'},body:Readable.from([Buffer.from(JSON.stringify(body))])};
  };
  Object.defineProperty(dara,'doAction',{configurable:true,enumerable:true,value:action});
  let active=true;
  const provider=createAliyunPnvs({keyId:'only-a-placeholder-id',keySecret:'only-a-placeholder-key',
    token,scheme:'fixture-scheme',sign:'fixture-sign',template:'fixture-template',active:()=>active});
  const send=()=>provider.send({phone,outId:id,ttlSeconds:300});
  const verify=()=>provider.verify({phone,outId:id,code});
  assert.deepEqual(await send(),{status:'accepted',outId:id});
  assert.deepEqual(await verify(),{status:'pass',outId:id});
  outcome='mismatch';
  assert.equal(await verify(),null);
  outcome='unknown';
  assert.equal(await verify(),null);
  outcome='503';
  let before=calls.length;
  await assert.rejects(send);
  assert.equal(calls.length-before,1);
  outcome='network-error';
  before=calls.length;
  await assert.rejects(verify);
  assert.equal(calls.length-before,1);
  active=false;
  before=calls.length;
  assert.equal(await send(),null);
  assert.equal(await verify(),null);
  assert.equal(calls.length,before);
});
