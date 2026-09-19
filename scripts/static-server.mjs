/* Static file server + LAN relay, shared by `npm run dev` and `npm run play`.
   Pages send a /__ping heartbeat while open; onPing lets play.mjs tell a
   living page apart from idle browser sockets (which close on their own). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './files.mjs';
import { attachRelay } from './ws-relay.mjs';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8' };

export function createStaticServer({ onPing } = {}) {
  const server = http.createServer((req, res) => {
    if (req.url === '/__ping' || req.url?.startsWith('/__ping?')) {
      onPing?.();
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    try {
      const route = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (route.includes('\\') || route.includes('\0') || route.split('/').some(p => p.startsWith('.'))) throw new Error('Invalid path');
      let file = path.resolve(root, '.' + route);
      if (path.relative(root, file).startsWith('..')) throw new Error('Outside root');
      if (fs.statSync(file, { throwIfNoEntry: false })?.isDirectory()) file = path.join(file, 'index.html');
      const real = fs.realpathSync(file);
      if (path.relative(root, real).startsWith('..') || !fs.statSync(real).isFile()) throw new Error('Invalid file');
      res.writeHead(200, { 'Content-Type': mime[path.extname(real)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(real).pipe(res);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  attachRelay(server, { accept: req => (req.url || '').startsWith('/ws') });
  return server;
}
