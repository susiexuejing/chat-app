// CI-only static server: no backend, proxies, writes or deployment.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.argv[2] || 'client/dist/tests-demo');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.ttf':'font/ttf', '.woff2':'font/woff2', '.png':'image/png', '.ico':'image/x-icon' };
http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  if (req.url === '/qa-away.html') {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'private, max-age=0');
    return res.end('<!doctype html><html><title>QA away</title><body>Local navigation target</body></html>');
  }
  let file;
  try { file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); } catch { res.writeHead(400); return res.end(); }
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'index.html');
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=0');
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}).listen(8421, '127.0.0.1', () => console.log('Static build ready on localhost:8421'));
