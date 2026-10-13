// Shared server logic for Netlify Functions and the Render/Node server.
// No dependencies: uses Node 18+ global fetch and a small RSS/Atom parser.

export const FEEDS = [
  { id: 'status', name: 'Search Status Dashboard', url: 'https://status.search.google.com/incidents.json', kind: 'json' },
  { id: 'gblog', name: 'Search Central Blog', url: 'https://developers.google.com/search/blog/feed.xml', kind: 'rss' },
  { id: 'ser', name: 'Search Engine Roundtable', url: 'https://www.seroundtable.com/index.xml', kind: 'rss' },
  { id: 'sej', name: 'Search Engine Journal', url: 'https://www.searchenginejournal.com/feed/', kind: 'rss' },
  { id: 'docs', name: 'Search Central documentation updates', url: 'https://developers.google.com/search/updates/search_docs_updates.rss', kind: 'rss' },
  { id: 'patents', name: 'Google patents and research (SEJ)', url: 'https://www.searchenginejournal.com/category/seo/google-patents/feed/', kind: 'rss' }
];

// Hosts the page reader may fetch (keeps the function from being an open proxy)
export const ALLOWED_HOSTS = [
  'developers.google.com', 'status.search.google.com', 'support.google.com', 'blog.google', 'static.googleusercontent.com',
  'www.seroundtable.com', 'seroundtable.com', 'feeds.seroundtable.com', 'www.searchenginejournal.com', 'searchenginejournal.com',
  'searchengineland.com', 'www.searchengineland.com', 'schema.org', 'patents.google.com',
  // your own sites, so "Import from URL" can pull published articles
  'sureshotfx.com', 'www.sureshotfx.com', 'telegramsignalcopier.com', 'www.telegramsignalcopier.com', 'trade2sync.com', 'www.trade2sync.com', 'statwide.ai'
];

const UA = 'Mozilla/5.0 (compatible; ContentQC/1.0; +https://github.com/)';

const decode = s => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const strip = s => decode(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (xml, name) => { const m = xml.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i')); return m ? m[1] : ''; };

export function parseRSS(xml, source) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks.slice(0, 30)) {
    let link = strip(tag(b, 'link'));
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); link = m ? m[1] : ''; }
    const title = strip(tag(b, 'title')).replace(/\s+via @\w+(,\s*@\w+)*\s*$/i, '');
    const date = strip(tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published') || tag(b, 'dc:date'));
    const summary = strip(tag(b, 'description') || tag(b, 'summary')).replace(/The post .* appeared first on .*$/i, '').slice(0, 260);
    if (title && link) items.push({ source, title, url: link, date: date ? new Date(date).toISOString() : null, summary });
  }
  return items;
}

export function parseStatus(json) {
  const arr = Array.isArray(json) ? json : [];
  return arr.slice(0, 25).map(i => ({
    source: 'status',
    title: i.external_desc,
    url: 'https://status.search.google.com/' + (i.uri || ''),
    date: i.begin,
    end: i.end || null,
    product: i.service_name,
    summary: (i.most_recent_update && i.most_recent_update.text || '').replace(/<[^>]+>/g, '').slice(0, 260)
  }));
}

async function get(url, ms = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

export async function getFeeds() {
  const results = await Promise.allSettled(FEEDS.map(async f => {
    const body = await get(f.url);
    return f.kind === 'json' ? parseStatus(JSON.parse(body)) : parseRSS(body, f.id);
  }));
  const items = [], errors = [];
  results.forEach((r, i) => r.status === 'fulfilled' ? items.push(...r.value) : errors.push({ source: FEEDS[i].id, error: String(r.reason && r.reason.message || r.reason) }));
  return { items, errors, fetchedAt: new Date().toISOString(), via: 'server' };
}

export function htmlToText(html) {
  let h = String(html || '');
  const main = h.match(/<article[\s\S]*?<\/article>/i) || h.match(/<main[\s\S]*?<\/main>/i);
  if (main) h = main[0];
  const title = strip((String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const updated = (String(html).match(/Last updated ([0-9-]+ UTC)/i) || [])[1] || '';
  h = h.replace(/<(script|style|nav|footer|header|aside|noscript|svg|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<h([1-6])[^>]*>/gi, (_, l) => '\n\n' + '#'.repeat(+l) + ' ')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(p|div|section|tr|br|blockquote)[^>]*>/gi, '\n');
  const text = decode(h.replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  return { title, updated, text: text.slice(0, 120000) };
}

export async function fetchPage(url, { allowAny = false, extraHosts = '' } = {}) {
  let u;
  try { u = new URL(url); } catch (e) { throw new Error('Invalid URL'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) URLs');
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(u.hostname) || /\.(local|internal)$/.test(u.hostname)) throw new Error('Private addresses are not allowed');
  const extra = String(extraHosts || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!allowAny && !ALLOWED_HOSTS.includes(u.hostname) && !extra.includes(u.hostname) && !extra.includes(u.hostname.replace(/^www\./, ''))) throw new Error('Host not on the allow list. Add it to the EXTRA_HOSTS environment variable (comma separated) or set ALLOW_ANY_URL=1.');
  const html = await get(u.toString(), 12000);
  return Object.assign({ url: u.toString(), html: html.slice(0, 600000) }, htmlToText(html));
}

// Optional server-side Gemini proxy so the API key never ships to the browser.
export async function llm(body, env) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error('Server has no GEMINI_API_KEY set'), { status: 501 });
  // A shared owner key is only usable with an access code, so strangers cannot spend it.
  if (!env.ACCESS_CODE) throw Object.assign(new Error('Server proxy is locked: the site owner must set ACCESS_CODE. Use your own Gemini key in Settings instead.'), { status: 403 });
  if (body.accessCode !== env.ACCESS_CODE) throw Object.assign(new Error('Wrong access code'), { status: 401 });
  // This endpoint never accepts or forwards a visitor's personal API key; personal keys go browser-to-Google directly.
  const model = body.model || env.GEMINI_MODEL || 'gemini-2.5-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(Object.assign({ contents: [{ role: 'user', parts: [{ text: String(body.prompt || '').slice(0, 200000) }] }], generationConfig: Object.assign({ temperature: 0.4 }, body.json && !body.search ? { responseMimeType: 'application/json' } : {}) }, body.search ? { tools: [{ google_search: {} }] } : {}))
  });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || 'Gemini error'), { status: r.status });
  const cand = (j.candidates || [])[0] || {};
  const text = (cand.content || {}).parts?.map(p => p.text).join('') || '';
  const sources = ((cand.groundingMetadata || {}).groundingChunks || []).map(c => c.web).filter(Boolean).map(w => ({ title: w.title, url: w.uri }));
  return { text, model, sources };
}

// ---------------------------------------------------------------------------
// Site profile for the "domain fit" check: homepage, robots.txt, sitemaps and
// RSS feed of ONE public domain. Only fixed paths on that domain are fetched,
// so this is not an open proxy.
// ---------------------------------------------------------------------------
const attr = (tagStr, name) => { const m = tagStr.match(new RegExp(name + '\\s*=\\s*["\']([^"\']*)["\']', 'i')); return m ? m[1] : ''; };

export async function siteProfile(input) {
  let host = String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw Object.assign(new Error('Enter a domain like example.com'), { status: 400 });
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /\.(local|internal)$/.test(host)) throw Object.assign(new Error('Private addresses are not allowed'), { status: 400 });
  const errors = [];
  const tryGet = async (url, ms = 9000) => { try { return await get(url, ms); } catch (e) { errors.push(url + ': ' + (e.message || e)); return ''; } };
  let base = 'https://' + host;
  let home = await tryGet(base + '/');
  if (!home && !host.startsWith('www.')) { const alt = await tryGet('https://www.' + host + '/'); if (alt) { home = alt; base = 'https://www.' + host; } }
  if (!home) throw Object.assign(new Error('Could not reach ' + host), { status: 502 });
  home = home.slice(0, 2000000);
  const metaTag = name => { const m = home.match(new RegExp('<meta[^>]+(?:name|property)=["\']' + name + '["\'][^>]*>', 'i')); return m ? decode(attr(m[0], 'content')) : ''; };
  const title = strip((home.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const headings = (home.match(/<h[1-3][^>]*>[\s\S]*?<\/h[1-3]>/gi) || []).map(strip).filter(t => t && t.length < 160).slice(0, 60);
  const links = [];
  (home.match(/<a\s[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi) || []).forEach(a => {
    const href = attr(a, 'href'); const text = strip(a);
    try { const u = new URL(href, base); if (u.hostname.replace(/^www\./, '') === host.replace(/^www\./, '') && text && text.length < 90) links.push({ url: u.origin + u.pathname, text }); } catch (e) { }
  });
  // sitemaps
  const robots = await tryGet(base + '/robots.txt', 6000);
  let maps = (robots.match(/^\s*sitemap:\s*(\S+)/gim) || []).map(l => l.replace(/^\s*sitemap:\s*/i, '').trim());
  if (!maps.length) maps = [base + '/sitemap.xml', base + '/sitemap_index.xml', base + '/wp-sitemap.xml'];
  const urls = []; const seen = new Set(); let fetched = 0;
  const queue = maps.slice(0, 3);
  while (queue.length && fetched < 6 && urls.length < 2000) {
    const sm = queue.shift(); fetched++;
    const xml = (await tryGet(sm, 9000)).slice(0, 4000000);
    if (!xml) continue;
    if (/<sitemapindex/i.test(xml)) {
      const kids = (xml.match(/<loc>([\s\S]*?)<\/loc>/gi) || []).map(l => strip(l)).filter(Boolean);
      kids.sort((a, b) => (/post|blog|article|news|page/i.test(b) ? 1 : 0) - (/post|blog|article|news|page/i.test(a) ? 1 : 0));
      queue.push(...kids.slice(0, 6));
      continue;
    }
    (xml.match(/<url>[\s\S]*?<\/url>/gi) || []).forEach(u => {
      const loc = strip(tag(u, 'loc')); const lastmod = strip(tag(u, 'lastmod'));
      if (loc && !seen.has(loc) && !/\.(jpe?g|png|webp|gif|pdf)$/i.test(loc)) { seen.add(loc); urls.push({ url: loc, lastmod: lastmod || null }); }
    });
  }
  // feed
  let feedUrl = ''; const fl = home.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i);
  if (fl) { try { feedUrl = new URL(attr(fl[0], 'href'), base).toString(); } catch (e) { } }
  let feed = [];
  for (const f of [feedUrl, base + '/feed', base + '/rss.xml', base + '/blog/rss.xml'].filter(Boolean)) {
    const body = await tryGet(f, 7000);
    if (body && /<(rss|feed)[\s>]/i.test(body)) { feed = parseRSS(body, 'site').slice(0, 30); break; }
  }
  return {
    domain: host, base, title, description: metaTag('description'), siteName: metaTag('og:site_name'),
    lang: ((home.match(/<html[^>]*\slang=["']([^"']+)["']/i) || [])[1] || '').toLowerCase(),
    headings, nav: links.slice(0, 300), urls: urls.slice(0, 2000), feed, fetchedAt: new Date().toISOString(), errors: errors.slice(0, 8)
  };
}
