const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('./serve-build.cjs');
for (const base of ['', '/ceshi']) test(`static export ${base || 'root'} contract`, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tests-demo-static-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>fixture</h1>');
  fs.writeFileSync(path.join(dir, 'app.js'), '/* static fixture */');
  const server = createServer(dir, base);
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive:true, force:true }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [suffix, type] of [['/', 'text/html'], ['/app.js','text/javascript'], ['/qa-away.html','text/html']]) {
    const res = await fetch(origin + base + suffix); assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), type);
    const head = await fetch(origin + base + suffix, { method:'HEAD' }); assert.equal(head.status,200); assert.equal(await head.text(),'');
  }
  for (const suffix of ['/chat','/missing.js','/missing.css','/missing.html']) assert.equal((await fetch(origin+base+suffix)).status,base ? 404 : 200);
  if (base) for (const suffix of ['/', '/ceshi', '/chat', '/app.js', '/ceshix/app.js', '/ceshi/%2e%2e%2fapp.js']) assert.ok([403,404].includes((await fetch(origin+suffix)).status));
  assert.equal((await fetch(origin + base + '/%XX')).status,400);
  assert.equal((await fetch(origin + base + '/', {method:'POST'})).status,405);
});
test('reject unsupported mount', () => assert.throws(() => createServer('.', '/other'), /QA_BASE_PATH/));
