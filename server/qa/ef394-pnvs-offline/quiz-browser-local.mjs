import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {makeLoopback} from './quiz-loopback.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const app=await makeLoopback(process.argv[2]);
const {origin}=new URL(app.url);
let browser;
try {
  browser=await chromium.launch({
    headless:true,ignoreDefaultArgs:['--disable-back-forward-cache'],
    ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),
  });
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  let blocked=0;
  await ctx.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){blocked++;return route.abort();}return route.continue();});
  const p=await ctx.newPage(), away=await ctx.newPage(), flags={ordinaryBack:'Not Run',actualBfcache:'Not Run',tabSwitch:'Not Run',crossTabLogout:'Not Run'};
  const errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>{
    window.__efQa={persisted:false,hidden:0,visible:0};
    window.addEventListener('pageshow',event=>{window.__efQa.persisted=event.persisted;});
    document.addEventListener('visibilitychange',()=>{window.__efQa[document.visibilityState]++;});
  });
  const selector=(page,id)=>page.getByTestId('quiz-account-'+id);
  const click=(page,id)=>selector(page,id).click();
  const visible=async(page,id)=>selector(page,id).waitFor({state:'visible'});
  const hidden=async(page,id)=>selector(page,id).waitFor({state:'hidden'});
  const hold=async()=>{
    await away.bringToFront();
    return await p.evaluate(()=>document.visibilityState==='hidden');
  };
  const counts=(send,verify)=>assert.deepEqual(app.counts(),{send,verify});
  await away.goto(app.url+'qa-away.html');
  await p.goto(app.url);
  await click(p,'intro');
  await visible(p,'plus86-note');
  await hidden(p,'phone');
  await click(p,'start');
  for(let i=0;i<93;i++){
    await click(p,'answer-A');await click(p,'next');
  }
  await visible(p,'view-result');
  await hidden(p,'phone');
  counts(0,0);
  await click(p,'view-result');
  await visible(p,'phone');
  await click(p,'cancel-login');
  await visible(p,'view-result');
  await click(p,'edit');
  assert.equal(await selector(p,'answer-A').getAttribute('aria-selected'),'true');
  await click(p,'next');
  await click(p,'view-result');
  await selector(p,'phone').fill('13000000000');
  await click(p,'send');
  await visible(p,'code');
  counts(1,0);
  const sawHidden=await hold();
  await p.bringToFront();
  await visible(p,'code');
  counts(1,0);
  if(sawHidden)flags.tabSwitch='PASS';
  await selector(p,'code').fill('000000');
  assert.equal(await selector(p,'consent').getAttribute('aria-checked'),'false');
  assert.equal(await selector(p,'verify').isEnabled(),false);
  counts(1,0);
  await click(p,'consent');
  await click(p,'verify');
  await visible(p,'report');
  assert.match(await selector(p,'report').innerText(),/ESTJ/);
  counts(1,1);

  // Real cross-document navigation, then Back. Only label actual persisted reads BFCache.
  await p.goto(app.url+'qa-away.html');
  await p.goBack({waitUntil:'commit'});
  await p.getByText('EmotionFlow · 本机离线验收',{exact:true}).waitFor();
  const persisted=await p.evaluate(()=>window.__efQa.persisted);
  if(persisted){
    await visible(p,'report');
    flags.actualBfcache='PASS (valid session)';
  }else{
    await click(p,'read');
    await visible(p,'report');
    flags.ordinaryBack='PASS (no cached restore)';
  }
  counts(1,1);

  // Log out on a second tab in the same browser context, not a separate profile.
  await away.goto(app.url);
  await away.bringToFront();
  const reportTabHidden=await p.evaluate(()=>document.visibilityState==='hidden');
  await click(away,'read');
  await visible(away,'report');
  await click(away,'logout');
  await visible(away,'intro');
  await p.bringToFront();
  if(reportTabHidden){
    await hidden(p,'report');
    await p.getByText('登录已失效，请主动登录回看。',{exact:true}).waitFor();
    flags.crossTabLogout='PASS';
  }
  counts(1,1);
  await click(away,'read');
  await selector(away,'phone').fill('13000000000');
  await click(away,'send');
  await selector(away,'code').fill('000000');
  assert.equal(await selector(away,'consent').getAttribute('aria-checked'),'false');
  await click(away,'consent');
  await click(away,'verify');
  await visible(away,'report');
  assert.match(await selector(away,'report').innerText(),/ESTJ/);
  counts(2,2);
  await click(away,'logout');
  await click(away,'read');
  await selector(away,'phone').fill('13900000000');
  await click(away,'send');
  await selector(away,'code').fill('000000');
  assert.equal(await selector(away,'consent').getAttribute('aria-checked'),'false');
  await click(away,'consent');
  await click(away,'verify');
  await away.getByText('这个账号还没有已保存的报告。',{exact:true}).waitFor();
  await hidden(away,'report');
  counts(3,3);
  assert.deepEqual(errors,[]);
  assert.equal(blocked,0,'all candidate requests remain on localhost');
  console.log(JSON.stringify({journey:'PASS',lifecycle:flags,counts:app.counts()},null,2));
} finally {
  try{if(browser)await browser.close();}finally{await app.close();}
}
