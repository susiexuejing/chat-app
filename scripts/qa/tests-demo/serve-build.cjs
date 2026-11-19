// CI-only localhost static server: no backend, proxies, writes or deployment.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.ttf':'font/ttf', '.woff2':'font/woff2', '.png':'image/png', '.ico':'image/x-icon' };
function createServer(directory, base = '') {
  if (!['', '/ceshi'].includes(base)) throw new Error('QA_BASE_PATH must be empty or /ceshi');
  const root = fs.realpathSync(directory);
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
    if (base && !pathname.startsWith(base + '/')) { res.writeHead(404); return res.end(); }
    pathname = pathname.slice(base.length);
    res.setHeader('Cache-Control', 'private, max-age=0');
    if (pathname === '/qa-away.html') {
      res.setHeader('Content-Type', 'text/html');
      return res.end(req.method === 'HEAD' ? undefined : '<!doctype html><html><title>QA away</title><body>Local navigation target</body></html>');
    }
    let file = path.resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    if (pathname === '/') file = path.join(root, 'index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (base) { res.writeHead(404); return res.end(); }
      file = path.join(root, 'index.html'); // Preserve original root-mode SPA fallback.
    }
    const real = fs.realpathSync(file);
    if (!real.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(real).on('error', () => res.destroy()).pipe(res);
  });
}
if (require.main === module) createServer(process.argv[2] || 'client/dist/tests-demo', process.env.QA_BASE_PATH || '')
  .listen(8421, '127.0.0.1', () => console.log('Static build ready on localhost:8421'));
module.exports = { createServer };
