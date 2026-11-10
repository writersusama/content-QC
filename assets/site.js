/* =========================================================================
   Content QC: target-site reader for the "domain fit" check
   Order: own server (/api/site) -> free public CORS proxies -> nothing.
   Profiles are cached in this browser for 24 hours.
   ========================================================================= */
(function () {
  const PROXIES = [
    u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    u => 'https://corsproxy.io/?url=' + encodeURIComponent(u)
  ];
  const TTL = 24 * 3600 * 1000;
  const key = d => 'cqc.site.' + d;
  const clean = d => String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

  async function viaServer(d) {
    const r = await withTimeout(fetch('/api/site?domain=' + encodeURIComponent(d)), 25000);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) { const e = new Error((j && j.error) || 'site reader unavailable'); e.answered = !!j; throw e; }
    return j;
  }
  async function proxyGet(url) {
    for (const p of PROXIES) { try { const r = await withTimeout(fetch(p(url)), 12000); if (r.ok) return await r.text(); } catch (e) { } }
    return '';
  }
  async function viaProxy(d) {
    const base = 'https://' + d;
    const home = await proxyGet(base + '/');
    if (!home) throw new Error('could not reach ' + d);
    const doc = new DOMParser().parseFromString(home, 'text/html');
    const txt = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
    const meta = n => { const m = doc.querySelector(`meta[name="${n}"],meta[property="${n}"]`); return m ? m.getAttribute('content') || '' : ''; };
    const nav = [];
    doc.querySelectorAll('a[href]').forEach(a => { try { const u = new URL(a.getAttribute('href'), base); if (u.hostname.replace(/^www\./, '') === d && txt(a) && txt(a).length < 90) nav.push({ url: u.origin + u.pathname, text: txt(a) }); } catch (e) { } });
    const urls = [];
    const sm = await proxyGet(base + '/sitemap.xml');
    if (sm) {
      const x = new DOMParser().parseFromString(sm, 'text/xml');
      const locs = Array.from(x.querySelectorAll('loc')).map(l => l.textContent.trim());
      if (x.querySelector('sitemapindex')) {
        for (const child of locs.sort((a, b) => /post|blog|article|page/i.test(b) - /post|blog|article|page/i.test(a)).slice(0, 3)) {
          const c = await proxyGet(child);
          if (c) new DOMParser().parseFromString(c, 'text/xml').querySelectorAll('url').forEach(u => urls.push({ url: txt(u.querySelector('loc')), lastmod: txt(u.querySelector('lastmod')) || null }));
        }
      } else x.querySelectorAll('url').forEach(u => urls.push({ url: txt(u.querySelector('loc')), lastmod: txt(u.querySelector('lastmod')) || null }));
    }
    let feed = [];
    const fl = doc.querySelector('link[type="application/rss+xml"],link[type="application/atom+xml"]');
    const fbody = await proxyGet(fl ? new URL(fl.getAttribute('href'), base).toString() : base + '/feed');
    if (fbody && /<(rss|feed)[\s>]/i.test(fbody)) {
      const x = new DOMParser().parseFromString(fbody, 'text/xml');
      feed = Array.from(x.querySelectorAll('item, entry')).slice(0, 30).map(i => ({ title: txt(i.querySelector('title')), url: txt(i.querySelector('link')) || (i.querySelector('link') || { getAttribute: () => '' }).getAttribute('href'), date: (() => { const t = txt(i.querySelector('pubDate')) || txt(i.querySelector('updated')); return t ? new Date(t).toISOString() : null; })() }));
    }
    return { domain: d, base, title: txt(doc.querySelector('title')), description: meta('description'), siteName: meta('og:site_name'), lang: (doc.documentElement.getAttribute('lang') || '').toLowerCase(), headings: Array.from(doc.querySelectorAll('h1,h2,h3')).map(txt).filter(t => t && t.length < 160).slice(0, 60), nav: nav.slice(0, 300), urls: urls.filter(u => u.url).slice(0, 2000), feed, fetchedAt: new Date().toISOString(), errors: [], via: 'public proxy' };
  }

  async function load(domain, force) {
    const d = clean(domain);
    if (!d) return null;
    if (!force) { try { const c = JSON.parse(localStorage.getItem(key(d)) || 'null'); if (c && Date.now() - new Date(c.fetchedAt) < TTL) return Object.assign(c, { fromCache: true }); } catch (e) { } }
    let prof = null, err = null;
    for (const fn of [viaServer, viaProxy]) { try { prof = await fn(d); break; } catch (e) { err = e; if (e.answered) break; } }
    if (!prof) throw err || new Error('site unreachable');
    try { localStorage.setItem(key(d), JSON.stringify(prof)); } catch (e) { }
    return prof;
  }
  window.CQSite = { load, clean };
})();
