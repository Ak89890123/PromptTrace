// Minimal static file server for the e2e fixtures (no deps).
// Content scripts match <all_urls> over http but NOT file:// (which needs the
// "Allow access to file URLs" toggle), so fixtures must be served over http.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 5599;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://127.0.0.1');
    const rel = decodeURIComponent(pathname === '/' ? '/chatgpt-like.html' : pathname);
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`fixtures on http://127.0.0.1:${PORT}`));
