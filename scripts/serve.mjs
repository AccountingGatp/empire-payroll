// Tiny static file server for local use:  npm start  ->  http://localhost:5173
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const port = process.env.PORT || 5173;
// Apply the same security headers that vercel.json sets in production, so local runs behave the same.
const vj = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const extra = Object.fromEntries((vj.headers?.[0]?.headers || []).map(h => [h.key, h.value]));
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || f.includes('node_modules') || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', ...extra });
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log('http://localhost:' + port));
