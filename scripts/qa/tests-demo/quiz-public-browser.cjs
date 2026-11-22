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

async function main() {
  assert.ok((await stat(path.join(dir, 'index.html'))).isFile());
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath:process.env.CHROMIUM_PATH } : {}) });
  try {
    const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
    const unexpected = [], errors = [], requests = [];
    let signedIn = false;
    const report = { id:'1', type:'ESTJ', sides:['EI','SN','TF','JP'].map((dimension,i) => ({
      dimension, preferred:dimension[0], scores:[i === 0 ? 24 : 23, 0],
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
        if (name === 'result' && method === 'GET') return signedIn ? reply(200,{status:'signed-in',report}) : reply(401,{status:'login-required'});
        const body = req.postDataJSON() || {};
        if (name === 'challenge' && method === 'POST' && body.consent === true && /^\+861\d{10}$/.test(body.phone) && /^[a-f0-9]{32}$/.test(body.requestId)) {
          return reply(200,{status:'pending',challengeId:'1'.repeat(32)});
        }
        if (name === 'verify' && method === 'POST' && body.consent === true && body.code === '482931' && body.challengeId === '1'.repeat(32)) {
          signedIn = true; return reply(200,{status:'verified'});
        }
        if (name === 'result' && method === 'POST' && signedIn && body.choices?.length === 93 && new Set(body.choices.map(c=>c.id)).size === 93) {
          return reply(200,{status:'saved',report});
        }
        if (name === 'logout' && method === 'POST') { signedIn = false; return reply(200,{status:'signed-out'}); }
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
    for (let i=0; i<93; i++) { await el('answer-A').click(); await el('next').click(); }
    await el('view-result').waitFor();
    await el('phone').waitFor({state:'hidden'});
    assert.deepEqual(requests, []);
    await el('view-result').click();
    await el('phone').waitFor();
    await el('cancel-login').click();
    await el('view-result').waitFor();
    await el('edit').click();
    assert.equal((await el('progress').innerText()).trim(),'93 / 93');
    assert.equal(await el('answer-A').getAttribute('aria-pressed'),'true');
    await el('next').click();
    await el('view-result').click();
    await el('phone').fill('13200000000'); // Fictitious input, intercepted; not delivered.
    assert.equal(await el('send').isEnabled(),false);
    assert.deepEqual(requests.filter(r=>r.startsWith('POST ')),[]);
    await el('consent').click();
    await el('send').click();
    await el('code').fill('482931');
    await el('consent').click();
    assert.equal(await el('verify').isEnabled(),false);
    await el('consent').click();
    await el('verify').click();
    assert.match(await el('report').innerText(),/ESTJ/);
    assert.deepEqual(requests.filter(r=>r.startsWith('POST ')),['POST challenge','POST verify','POST result']);
    await el('logout').click();
    await el('intro').waitFor();
    await el('report').waitFor({state:'hidden'});
    assert.deepEqual(unexpected,[]);
    assert.deepEqual(errors,[]);
    console.log('Public client browser contract: PASS, fully intercepted; no DEV/real SMS/backend tested.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
