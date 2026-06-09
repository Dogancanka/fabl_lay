// Zero-dependency static file server for local development.
// Usage: node serve.js [port]
import http from 'node:http';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2]) || 8000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) throw new Error('forbidden');
    let stat = await fs.stat(file).catch(() => null);
    if (stat && stat.isDirectory()) {
      file = path.join(file, 'index.html');
      stat = await fs.stat(file).catch(() => null);
    }
    if (!stat) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = await fs.readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(500).end('error');
  }
}).listen(port, () => {
  console.log(`FABL Lay running at http://localhost:${port}`);
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`  on your phone (same Wi-Fi): http://${iface.address}:${port}`);
      }
    }
  }
});
