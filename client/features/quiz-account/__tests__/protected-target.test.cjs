/* global require:readonly, __dirname:readonly */
const assert=require('node:assert/strict');
const { test }=require('node:test');
const { readFileSync }=require('node:fs');
const { resolve }=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');

const compile=file=>ts.transpileModule(readFileSync(resolve(__dirname,file),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const apiSource=compile('../api.ts');
const configSource=compile('../../../app.config.ts');
const flags={EXPO_PUBLIC_TESTS_ACCOUNT_OFFLINE:'1',EXPO_PUBLIC_TESTS_ACCOUNT_PROTECTED_DEV:'1'};
const dev='https://dev.douhaoyu.cn/ceshi/';
const local='http://localhost:17412/ceshi/';
const publicFlags={EXPO_PUBLIC_TESTS_ACCOUNT_PUBLIC_REAL:'1',EXPO_PUBLIC_TESTS_DEMO:'1',EXPO_PUBLIC_TESTS_DEMO_BASE_PATH:'/ceshi'};
function api(env,url){
  const calls=[],exports={};
  vm.runInNewContext(apiSource,{exports,process:{env},
    window:url?{location:new URL(url)}:undefined,AbortController,setTimeout,clearTimeout,
    fetch:async(path,options)=>{
      calls.push({path,options});
      return {status:401,ok:false,json:async()=>({status:'login-required'})};
    },
  });
  return {api:exports.quizAccount,calls};
}
test('default build only uses its original loopback destination',async()=>{
  const a=api({},local);
  assert.equal((await a.api.read()).status,'login-required');
  assert.equal(a.calls.length,1);
  for(const url of [dev,'http://127.0.0.1:17412/ceshi/',undefined]){
    const x=api({},url);
    assert.equal((await x.api.read()).status,'try-again');
    assert.equal(x.calls.length,0);
  }
});
test('protected build uses exact canonical HTTPS DEV path and only existing relative API',async()=>{
  const a=api(flags,dev);
  assert.equal((await a.api.read()).status,'login-required');
  assert.equal(a.calls[0].path,'/ceshi/api/v1/quiz-account/result');
  assert.equal(a.calls[0].options.mode,'same-origin');
  assert.equal(a.calls[0].options.credentials,'same-origin');
  assert.equal(a.calls[0].options.redirect,'error');
  for(const url of [local,'http://dev.douhaoyu.cn/ceshi/','https://dev.douhaoyu.cn/',
    'https://dev.douhaoyu.cn/ceshi','https://dev.douhaoyu.cn/ceshi/other','https://dev.douhaoyu.cn:8443/ceshi/',
    'https://dev.douhaoyu.cn.example.invalid/ceshi/',dev+'?x=1',dev+'#other']){
    const x=api(flags,url);
    assert.equal((await x.api.read()).status,'try-again',url);
    assert.equal(x.calls.length,0,url);
  }
  const omitted=api({EXPO_PUBLIC_TESTS_ACCOUNT_PROTECTED_DEV:'1'},dev);
  assert.equal((await omitted.api.read()).status,'try-again');
  assert.equal(omitted.calls.length,0);
});
test('send and verify only forward the approved synthetic fixture IDs in protected mode',async()=>{
  const a=api(flags,dev);
  const notFixture='+8613100000000';
  assert.equal((await a.api.sendChallenge(notFixture,'synthetic')).status,'not-verified');
  assert.equal((await a.api.verify(notFixture,'000000','synthetic',true)).status,'not-verified');
  assert.equal(a.calls.length,0);
  for(const fixture of ['+8613000000000','+8613900000000']){
    await a.api.sendChallenge(fixture,'synthetic');
    await a.api.verify(fixture,'000000','synthetic',true);
  }
  assert.deepEqual(a.calls.map(x=>x.path),[
    '/ceshi/api/v1/quiz-account/challenge','/ceshi/api/v1/quiz-account/verify',
    '/ceshi/api/v1/quiz-account/challenge','/ceshi/api/v1/quiz-account/verify',
  ]);
  const old=api({},local);
  await old.api.sendChallenge(notFixture,'synthetic');
  assert.equal(old.calls.length,1);
});
test('Expo requires all protected mode opt-ins while ordinary and localhost routes remain unchanged',()=>{
  const configuration=env=>{
    const exports={};
    vm.runInNewContext(configSource,{exports,process:{env}});
    return exports.default({config:{}});
  };
  const root=config=>config.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-router')?.[1].root;
  const demo={EXPO_PUBLIC_TESTS_DEMO:'1',EXPO_PUBLIC_TESTS_DEMO_BASE_PATH:'/ceshi'};
  const ordinary=configuration({});
  assert.equal(root(ordinary),undefined);
  assert.equal(root(configuration(demo)),'./tests-app');
  assert.equal(root(configuration({...demo,EXPO_PUBLIC_TESTS_ACCOUNT_OFFLINE:'1'})),'./tests-account-app');
  const protectedBuild=configuration({...demo,...flags});
  assert.equal(root(protectedBuild),'./tests-account-app');
  assert.equal(protectedBuild.experiments.baseUrl,'/ceshi');
  assert.equal(root(configuration(publicFlags)),'./tests-account-app');
  assert.equal(configuration(publicFlags).experiments.baseUrl,'/ceshi');
  for(const variant of [{EXPO_PUBLIC_TESTS_ACCOUNT_PUBLIC_REAL:'1'},
    {...publicFlags,EXPO_PUBLIC_TESTS_DEMO_BASE_PATH:'/other'},
    {...publicFlags,EXPO_PUBLIC_TESTS_ACCOUNT_OFFLINE:'1'},
    {...publicFlags,EXPO_PUBLIC_TESTS_ACCOUNT_PROTECTED_DEV:'1'}])assert.throws(()=>configuration(variant));
  assert.throws(()=>configuration(flags));
  assert.throws(()=>configuration({...demo,EXPO_PUBLIC_TESTS_ACCOUNT_PROTECTED_DEV:'1'}));
  assert.throws(()=>configuration({...demo,...flags,EXPO_PUBLIC_TESTS_DEMO_BASE_PATH:'/other'}));
});

test('real build explicitly uses the distinct same-origin API for normalized input and consent',async()=>{
  const a=api(publicFlags,dev);
  assert.equal(a.calls.length,0);
  const phone='+8613100000000';
  assert.equal((await a.api.sendChallenge('13100000000','fake',true)).status,'not-verified');
  assert.equal((await a.api.verify(phone,'123456','fake',false)).status,'not-verified');
  assert.equal(a.calls.length,0);
  assert.equal((await a.api.sendChallenge(phone,'1'.repeat(32),false)).status,'not-verified');
  assert.equal(a.calls.length,0);
  await a.api.sendChallenge(phone,'1'.repeat(32),true);
  await a.api.verify(phone,'123456','2'.repeat(32),true);
  await a.api.save({submissionId:'3'.repeat(32),choices:[]});
  await a.api.read();
  await a.api.logout();
  assert.deepEqual(a.calls.map(({path})=>path),['challenge','verify','result','result','logout'].map(x=>'/ceshi/api/auth/v1/'+x));
  assert.deepEqual(JSON.parse(a.calls[0].options.body),{phone,requestId:'1'.repeat(32),consent:true});
  assert.deepEqual(JSON.parse(a.calls[1].options.body),{phone,code:'123456',challengeId:'2'.repeat(32),consent:true});
  assert.deepEqual(a.calls.map(({options})=>options.method),['POST','POST','POST','GET','POST']);
  for(const {options} of a.calls)
    assert.deepEqual([options.mode,options.credentials,options.cache,options.redirect],['same-origin','same-origin','no-store','error']);
});
test('real mode fails closed for altered destinations/build flags including both fixture flags',async()=>{
  for(const url of [local,'http://dev.douhaoyu.cn/ceshi/','https://dev.douhaoyu.cn/ceshi','https://example.test/ceshi/', dev+'?next=1',dev+'#next',undefined]){
    const a=api(publicFlags,url);assert.equal((await a.api.read()).status,'try-again');
    assert.equal(a.calls.length,0);
  }
  for(const env of [{EXPO_PUBLIC_TESTS_ACCOUNT_PUBLIC_REAL:'1'},
    {...publicFlags,EXPO_PUBLIC_TESTS_ACCOUNT_OFFLINE:'1'},{...publicFlags,EXPO_PUBLIC_TESTS_ACCOUNT_PROTECTED_DEV:'1'}]){
    const a=api(env,dev);await a.api.sendChallenge('+8613100000000','1'.repeat(32),true);
    assert.equal((await a.api.read()).status,'try-again');assert.equal(a.calls.length,0);
  }
});
