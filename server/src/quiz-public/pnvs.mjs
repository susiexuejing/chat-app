import {createRequire} from 'node:module';

const PACKAGE='@alicloud/dypnsapi20170525';
const PIN='2.0.0';
const HOST='dypnsapi.aliyuncs.com';
const phone=/^\+861[3-9]\d{9}$/;
const out=/^[a-f0-9]{32}$/;

function actualSdk() {
  const require=createRequire(import.meta.url);
  if (require(PACKAGE+'/package.json').version!==PIN) throw new Error('unavailable PNVS SDK');
  const sdk=require(PACKAGE);
  const dependencies=createRequire(require.resolve(PACKAGE));
  return {...sdk,Config:dependencies('@alicloud/openapi-client').Config,
    RuntimeOptions:dependencies('@alicloud/tea-util').RuntimeOptions};
}

// The injected loader is an offline test seam. Nothing is loaded until
// configuration and native database identity checks have succeeded.
export function createAliyunPnvs(config, load=actualSdk) {
  const sdk=load();
  const client=new sdk.default(new sdk.Config({
    type:'sts',accessKeyId:config.keyId,accessKeySecret:config.keySecret,
    securityToken:config.token,endpoint:HOST,protocol:'HTTPS',
  }));
  const runtime=()=>new sdk.RuntimeOptions({autoretry:false,maxAttempts:1,connectTimeout:2500,readTimeout:4500});
  const common=({phone:number,outId})=>({phoneNumber:number.slice(3),countryCode:'86',outId,schemeName:config.scheme});
  const okay=(response,id)=>response?.statusCode===200&&response.body?.success===true&&
    response.body.code==='OK'&&response.body.model?.outId===id;
  return {
    async send({phone:number,outId,ttlSeconds}) {
      if(!phone.test(number)||!out.test(outId)||ttlSeconds!==300||!config.active())return null;
      const req=new sdk.SendSmsVerifyCodeRequest({
        ...common({phone:number,outId}),signName:config.sign,templateCode:config.template,
        templateParam:JSON.stringify({code:'##code##',min:'5'}),validTime:300,interval:60,
        codeLength:6,codeType:1,duplicatePolicy:2,returnVerifyCode:false,autoRetry:0,
      });
      const reply=await client.sendSmsVerifyCodeWithOptions(req,runtime());
      if(!config.active()||!okay(reply,outId)||reply.body.model.verifyCode!=null)return null;
      return {status:'accepted',outId};
    },
    async verify({phone:number,code,outId}) {
      if(!phone.test(number)||!out.test(outId)||!/^\d{6}$/.test(code)||!config.active())return null;
      const req=new sdk.CheckSmsVerifyCodeRequest({...common({phone:number,outId}),verifyCode:code});
      const reply=await client.checkSmsVerifyCodeWithOptions(req,runtime());
      if(!config.active()||!okay(reply,outId)||reply.body.model.verifyResult!=='PASS')return null;
      return {status:'pass',outId};
    },
  };
}
