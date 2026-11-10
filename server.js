// Content QC server for Render (free web service) or any Node 18+ host.
// Serves the static app and the same /api endpoints as the Netlify functions.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFeeds, fetchPage, llm, siteProfile } from './lib/core.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 8080;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
let feedCache = { at: 0, data: null };

const SECURITY = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'content-security-policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'none'; object-src 'none'" };
const json = (res, code, obj) => { res.writeHead(code, Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, SECURITY)); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/feeds') {
      if (!feedCache.data || Date.now() - feedCache.at > 15 * 60 * 1000) feedCache = { at: Date.now(), data: await getFeeds() };
      return json(res, 200, feedCache.data);
    }
    if (url.pathname === '/api/page') {
      return json(res, 200, await fetchPage(url.searchParams.get('url'), { allowAny: process.env.ALLOW_ANY_URL === '1', extraHosts: process.env.EXTRA_HOSTS }));
    }
    if (url.pathname === '/api/site') return json(res, 200, await siteProfile(url.searchParams.get('domain')));
    if (url.pathname === '/api/llm' && req.method === 'POST') {
      let body = ''; for await (const c of req) body += c;
      return json(res, 200, await llm(JSON.parse(body || '{}'), process.env));
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (p.endsWith('/')) p += 'index.html';
    if (p.includes('..') || /^\/(lib|netlify|node_modules)\b|server\.js|package/.test(p)) { res.writeHead(404); return res.end('Not found'); }
    const file = join(ROOT, p);
    const data = await readFile(file).catch(() => null);
    if (!data) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, Object.assign({ 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': p.endsWith('.html') ? 'no-cache' : 'public, max-age=3600' }, SECURITY));
    res.end(data);
  } catch (e) {
    json(res, e.status || 400, { error: String(e.message || e) });
  }
}).listen(PORT, () => console.log('Content QC running on http://localhost:' + PORT));
