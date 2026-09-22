// Tiny static file server with in-memory gzip cache.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

export function createStaticHandler(mounts) {
  // mounts: [{ prefix: '/shared/', dir }, { prefix: '/', dir }]
  const cache = new Map();
  return function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const mount = mounts.find((m) => urlPath.startsWith(m.prefix));
    if (!mount) { res.writeHead(404); res.end('Not found'); return; }
    let rel = urlPath.slice(mount.prefix.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(mount.dir, rel);
    if (!file.startsWith(path.resolve(mount.dir) + path.sep) && file !== path.resolve(mount.dir)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
      const key = file;
      const cached = cache.get(key);
      const serve = (entry) => {
        const gzipOk = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && entry.gz;
        const headers = {
          'Content-Type': entry.mime,
          'Cache-Control': 'no-cache',
          ETag: entry.etag,
        };
        if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304, headers); res.end(); return; }
        if (gzipOk) headers['Content-Encoding'] = 'gzip';
        const body = gzipOk ? entry.gz : entry.body;
        headers['Content-Length'] = body.length;
        res.writeHead(200, headers);
        if (req.method === 'HEAD') res.end(); else res.end(body);
      };
      if (cached && cached.mtime === st.mtimeMs) return serve(cached);
      fs.readFile(file, (err2, body) => {
        if (err2) { res.writeHead(500); res.end(); return; }
        const ext = path.extname(file).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        const compressible = /text|javascript|json|svg/.test(mime) && body.length > 1024;
        const entry = {
          body, mime, mtime: st.mtimeMs,
          etag: `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`,
          gz: compressible ? zlib.gzipSync(body, { level: 6 }) : null,
        };
        cache.set(key, entry);
        serve(entry);
      });
    });
  };
}
