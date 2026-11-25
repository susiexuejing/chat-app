// Browser contract rehearsal for the public build. All responses are local
// fixtures; this script must never contact an actual DEV host or SMS provider.
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { stat } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const dir = path.resolve(process.argv[2] || 'dist/tests-public');
const origin = 'https://dev.douhaoyu.cn';
const prefix = '/ceshi/';
const api = prefix + 'api/auth/v1/';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// Fixed mixed/tied fixture, counted independently from the product scorer
// using the native scoring-sheet question partitions. Also exercise payload
// assignment, not just shape, so a dropped or swapped choice cannot pass.
const keyByDimension = {
  EI:[1,8,11,14,17,24,27,30,33,40,43,46,49,56,59,62,65,72,75,78,81,88,91,93],
  SN:[2,5,12,15,18,21,28,31,34,37,44,47,50,53,60,63,66,69,76,79,82,85,92],
  TF:[3,6,9,16,19,22,25,32,35,38,41,48,51,54,57,64,67,70,73,80,83,86,89],
  JP:[4,7,10,13,20,23,26,29,36,39,42,45,52,55,58,61,68,71,74,77,84,87,90],
};
const expected = { EI:[12,12], SN:[12,11], TF:[14,9], JP:[12,11] };
const reportTitles = { EI:'精力与交流', SN:'信息与理解', TF:'判断与取舍', JP:'计划与节奏' };
const scoreLabels = { EI:['外向','内向'], SN:['实感','直觉'], TF:['思考','情感'], JP:['判断','感知'] };
const interpretationBranch = { EI:'无明显偏向，两种方式选得一样多', SN:'从具体细节切入',
  TF:'先比较理由和标准', JP:'先把安排定下来' };
const answerFor = q => (q-1)%3===0 || (q-1)%7===0 || [11,14,17].includes(q) ? 'B' : 'A';
const questionId = q => 'q' + String(q).padStart(2,'0');
const expectedChoices = new Map(Array.from({length:93},(_,i)=>[questionId(i+1),answerFor(i+1)]));
const testPhone = '+8613200000000'; // Synthetic input, never transmitted.
const fixtureCode = '482931';

async function main() {
  assert.ok((await stat(path.join(dir, 'index.html'))).isFile());
  const ids = Object.values(keyByDimension).flat().sort((a,b)=>a-b);
  assert.deepEqual(ids,Array.from({length:93},(_,i)=>i+1));
  assert.deepEqual(Object.fromEntries(Object.entries(keyByDimension).map(([dimension,questions])=>{
    const right=questions.filter(q=>answerFor(q)==='B').length;
    return [dimension,[questions.length-right,right]];
  })),expected);
  const browser = await chromium.launch({ headless: true,
    args:['--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND'],
    ...(process.env.CHROMIUM_PATH ? { executablePath:process.env.CHROMIUM_PATH } : {}) });
  try {
    const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
    const unexpected = [], errors = [], requests = [];
    let signedIn = null, challenge = null;
    const intents = new Set(), reports = new Map();
    const report = { id:'1', type:null, sides:Object.entries(expected).map(([dimension,scores]) => ({
      dimension, preferred:scores[0]===scores[1]?null:dimension[scores[0]>scores[1]?0:1], scores,
    })) };
    await ctx.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      const reply = (status, json) => route.fulfill({ status, json });
      if (url.origin !== origin || !url.pathname.startsWith(prefix)) {
        unexpected.push([req.method(), url.origin, url.pathname]); return route.abort();
      }
      if (url.pathname.startsWith(api)) {
        const name = url.pathname.slice(api.length), method = req.method();
        requests.push(method + ' ' + name);
        if (name === 'result' && method === 'GET') return signedIn
          ? reply(200,{status:'signed-in',report:reports.get(signedIn)??null}) : reply(401,{status:'login-required'});
        const body = req.postDataJSON() || {};
        if (name === 'challenge' && method === 'POST' && !signedIn && body.consent === true &&
          body.phone === testPhone && /^[a-f0-9]{32}$/.test(body.requestId) && !intents.has(body.requestId)) {
          intents.add(body.requestId);
          challenge={phone:body.phone,id:String(intents.size).padStart(32,'0')};
          return reply(200,{status:'pending',challengeId:challenge.id});
        }
        if (name === 'verify' && method === 'POST' && !signedIn && challenge && body.consent === true &&
          body.phone === challenge.phone && body.code === fixtureCode && body.challengeId === challenge.id) {
          signedIn=challenge.phone; challenge=null; return reply(200,{status:'verified'});
        }
        if (name === 'result' && method === 'POST' && signedIn && !reports.has(signedIn) && /^[a-f0-9]{32}$/.test(body.submissionId) &&
          Array.isArray(body.choices) && body.choices.length === 93 && new Set(body.choices.map(c=>c.id)).size === 93 &&
          body.choices.every(c=>expectedChoices.has(c.id)&&expectedChoices.get(c.id)===c.option)) {
          reports.set(signedIn,report);
          return reply(200,{status:'saved',report});
        }
        if (name === 'logout' && method === 'POST' && signedIn) { signedIn = null; return reply(200,{status:'signed-out'}); }
        unexpected.push([method, name]); return reply(400,{status:'try-again'});
      }
      if (req.method() !== 'GET' || (!['document','script','stylesheet','font','image'].includes(req.resourceType()) && url.pathname !== prefix + 'favicon.ico')) {
        unexpected.push([req.method(), url.pathname, req.resourceType()]); return route.abort();
      }
      const relative = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
      const file = path.resolve(dir, relative);
      if (!file.startsWith(dir + path.sep)) return route.abort();
      try { return await route.fulfill({body:await readFile(file),contentType:types[path.extname(file)] || 'application/octet-stream'}); }
      catch { return route.fulfill({status:404,body:''}); }
    });
    await ctx.routeWebSocket('**/*', ws => { unexpected.push(['websocket']); ws.close(); });
    const p = await ctx.newPage();
    p.on('pageerror', err => errors.push(err.name));
    const el = id => p.getByTestId('quiz-account-' + id);
    await p.goto(origin + prefix);
    await el('intro').click();
    await el('phone').waitFor({state:'hidden'});
    await el('start').click();
    for (let q=1; q<=93; q++) { await el('answer-' + answerFor(q)).click(); await el('next').click(); }
    await el('view-result').waitFor();
    await el('phone').waitFor({state:'hidden'});
    assert.deepEqual(requests, []);
    await el('view-result').click();
    await el('phone').waitFor();
    await el('cancel-login').click();
    await el('view-result').waitFor();
    await el('edit').click();
    assert.equal((await el('progress').innerText()).trim(),'93 / 93');
    assert.equal(await el('answer-' + answerFor(93)).getAttribute('aria-pressed'),'true');
    await el('next').click();
    await el('view-result').click();
    const login=async ({checkConsent=false}={})=>{
      await el('phone').fill(testPhone.slice(3));
      assert.equal(await el('send').isEnabled(),false);
      const before=requests.length;
      await el('consent').click();
      await el('send').click();
      await el('code').fill(fixtureCode);
      if(checkConsent){
        await el('consent').click();
        assert.equal(await el('verify').isEnabled(),false);
        assert.deepEqual(requests.slice(before),['POST challenge']);
        await el('consent').click();
      }
      await el('verify').click();
    };
    const inspectReport=async()=>{
      await el('report').waitFor();
      const reportText=await el('report').innerText();
      await el('report').getByText('本次包含无明显偏好的维度',{exact:true}).waitFor();
      assert.doesNotMatch(reportText,/\b[EI][SN][TF][JP]\b/);
      const interpretations=[];
      for(const [dimension,scores] of Object.entries(expected)){
        const card=el('dimension-'+dimension);
        await card.waitFor();
        await card.getByText(reportTitles[dimension],{exact:true}).waitFor();
        const score=(await card.getByTestId('quiz-account-score-'+dimension).innerText()).trim();
        const [a,b]=scoreLabels[dimension];
        assert.equal(score,`${a} ${scores[0]} · ${b} ${scores[1]}${dimension==='EI'?' · 无明显偏向':''}`);
        const paragraph=card.getByTestId('quiz-account-interpretation-'+dimension);
        await paragraph.waitFor();
        const text=(await paragraph.innerText()).trim();
        assert.equal(text,interpretationBranch[dimension],'expected original report copy for '+dimension);
        interpretations.push(text);
      }
      assert.equal(new Set(interpretations).size,4);
      return interpretations;
    };
    assert.deepEqual(requests,[]);
    await login({checkConsent:true});
    const saved=await inspectReport();
    assert.deepEqual(requests,['POST challenge','POST verify','POST result']);
    await el('logout').click();
    await el('intro').waitFor();
    await el('report').waitFor({state:'hidden'});
    await el('read').click();
    await el('phone').waitFor();
    assert.deepEqual(requests,['POST challenge','POST verify','POST result','POST logout','GET result']);
    await login();
    assert.deepEqual(await inspectReport(),saved);
    assert.deepEqual(requests,['POST challenge','POST verify','POST result','POST logout','GET result',
      'POST challenge','POST verify','GET result']);
    await el('logout').click();
    await el('intro').waitFor();
    await el('report').waitFor({state:'hidden'});
    assert.deepEqual(requests,['POST challenge','POST verify','POST result','POST logout','GET result',
      'POST challenge','POST verify','GET result','POST logout']);
    assert.deepEqual(unexpected,[]);
    assert.deepEqual(errors,[]);
    console.log('Public client browser contract: PASS; 93 mixed choices, EI tie, four interpretations retained on same-account readback; no DEV/real SMS/backend tested.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
