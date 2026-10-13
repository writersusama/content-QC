/* =========================================================================
   Content QC: Google Pulse feed loader
   Order: own server (/api/feeds on Netlify or Render) -> free public CORS
   proxies (works on GitHub Pages) -> cached copy -> built-in snapshot.
   ========================================================================= */
(function () {
  const FEEDS = [
    { id: 'status', name: 'Search Status Dashboard', url: 'https://status.search.google.com/incidents.json', kind: 'json' },
    { id: 'gblog', name: 'Search Central Blog', url: 'https://developers.google.com/search/blog/feed.xml', kind: 'rss' },
    { id: 'ser', name: 'Search Engine Roundtable', url: 'https://www.seroundtable.com/index.xml', kind: 'rss' },
    { id: 'sej', name: 'Search Engine Journal', url: 'https://www.searchenginejournal.com/feed/', kind: 'rss' },
    { id: 'docs', name: 'Search Central documentation updates', url: 'https://developers.google.com/search/updates/search_docs_updates.rss', kind: 'rss' },
    { id: 'patents', name: 'Google patents and research (SEJ)', url: 'https://www.searchenginejournal.com/category/seo/google-patents/feed/', kind: 'rss' }
  ];
  const PROXIES = [
    u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    u => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
    u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u)
  ];
  const CACHE_KEY = 'cqc.feeds.v2';
  const TTL = 30 * 60 * 1000;

  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  const text = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();

  function parseXML(xml, source) {
    const d = new DOMParser().parseFromString(xml, 'text/xml');
    const nodes = Array.from(d.querySelectorAll('item')).length ? d.querySelectorAll('item') : d.querySelectorAll('entry');
    return Array.from(nodes).slice(0, 30).map(n => {
      const linkEl = n.querySelector('link');
      const link = linkEl ? (text(linkEl) || linkEl.getAttribute('href')) : '';
      const date = text(n.querySelector('pubDate')) || text(n.querySelector('updated')) || text(n.querySelector('published'));
      const desc = n.querySelector('description') || n.querySelector('summary');
      const summary = desc ? new DOMParser().parseFromString(desc.textContent, 'text/html').body.textContent.replace(/The post .* appeared first on .*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 260) : '';
      return { source, title: text(n.querySelector('title')).replace(/\s+via @\w+(,\s*@\w+)*\s*$/i, ''), url: link, date: date ? new Date(date).toISOString() : null, summary };
    }).filter(i => i.title && i.url);
  }
  function parseStatus(arr) {
    return (Array.isArray(arr) ? arr : []).slice(0, 25).map(i => ({ source: 'status', title: i.external_desc, url: 'https://status.search.google.com/' + (i.uri || ''), date: i.begin, end: i.end || null, product: i.service_name, summary: ((i.most_recent_update || {}).text || '').replace(/<[^>]+>/g, '').slice(0, 260) }));
  }

  async function viaServer() {
    const r = await withTimeout(fetch('/api/feeds', { headers: { accept: 'application/json' } }), 12000);
    if (!r.ok) throw new Error('no server');
    const j = await r.json();
    if (!j.items || !j.items.length) throw new Error('empty');
    return j;
  }
  async function viaProxies() {
    const items = [], errors = [];
    await Promise.all(FEEDS.map(async f => {
      for (const p of PROXIES) {
        try {
          const r = await withTimeout(fetch(p(f.url)), 10000);
          if (!r.ok) continue;
          const body = await r.text();
          const parsed = f.kind === 'json' ? parseStatus(JSON.parse(body)) : parseXML(body, f.id);
          if (parsed.length) { items.push(...parsed); return; }
        } catch (e) { /* try next proxy */ }
      }
      errors.push({ source: f.id, error: 'unreachable' });
    }));
    if (!items.length) throw new Error('proxies failed');
    return { items, errors, fetchedAt: new Date().toISOString(), via: 'public proxy' };
  }

  async function load(force) {
    const settings = window.CQSettings.get();
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { }
    if (!force && cached && Date.now() - new Date(cached.fetchedAt).getTime() < TTL) return Object.assign(cached, { fromCache: true });
    const chain = settings.feedMode === 'server' ? [viaServer] : settings.feedMode === 'proxy' ? [viaProxies] : [viaServer, viaProxies];
    for (const fn of chain) {
      try { const data = await fn(); try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) { } return data; } catch (e) { }
    }
    if (cached) return Object.assign(cached, { fromCache: true, stale: true });
    return { items: window.KB.updatesSnapshot.map(u => Object.assign({ summary: u.note || '' }, u, { date: u.date + 'T12:00:00Z', end: u.end ? u.end + 'T12:00:00Z' : null })), fetchedAt: window.KB.reviewed + 'T00:00:00Z', via: 'built-in snapshot', snapshot: true };
  }

  const GOOGLE_RE = /google|search console|ai overview|ai mode|discover|gemini|core update|spam update|serp|ranking|googlebot|search central|e-e-a-t|helpful content|site reputation|structured data|schema|indexing|crawl/i;

  // Group into the three sidebar tabs
  function organise(data) {
    const items = (data.items || []).filter(i => i.title);
    const byDate = (a, b) => new Date(b.date || 0) - new Date(a.date || 0);
    const updates = items.filter(i => i.source === 'status').sort(byDate);
    const official = items.filter(i => i.source === 'gblog').sort(byDate);
    const industry = items.filter(i => (i.source === 'ser' || i.source === 'sej') && GOOGLE_RE.test(i.title + ' ' + i.summary) && !/^daily search forum recap/i.test(i.title)).sort(byDate);
    // "Most discussed": topics that appear across several outlets in the last 14 days
    const recent = items.filter(i => i.date && Date.now() - new Date(i.date) < 14 * 864e5 && GOOGLE_RE.test(i.title));
    const TOPICS = [['spam update', /spam update/i], ['core update', /core update/i], ['AI Overviews', /ai overview/i], ['AI Mode', /ai mode/i], ['Discover', /discover/i], ['Search Console', /search console/i], ['site reputation', /site reputation|parasite/i], ['authors & E-E-A-T', /author|e-e-a-t|eeat|expertise/i], ['rank tracking', /rank track|scrap/i], ['structured data', /structured data|schema|rich result/i], ['crawling & indexing', /crawl|index|sitemap/i], ['links', /\blink/i]];
    const hot = TOPICS.map(([name, re]) => { const hits = recent.filter(i => re.test(i.title + ' ' + i.summary)); return { name, count: hits.length, sources: new Set(hits.map(h => h.source)).size, items: hits.sort(byDate).slice(0, 3) }; })
      .filter(t => t.count).sort((a, b) => (b.sources * 2 + b.count) - (a.sources * 2 + a.count)).slice(0, 5);
    const rolling = updates.filter(u => !u.end || new Date(u.end) > Date.now());
    const docs = items.filter(i => i.source === 'docs').sort(byDate);
    const patents = items.filter(i => i.source === 'patents').sort(byDate);
    // Rule-book watch: official doc changes after Content QC's last review that touch a policy it relies on
    const reviewed = new Date(window.KB.reviewed + 'T23:59:59Z');
    const norm = u => String(u || '').replace(/[#?].*$/, '').replace(/\/$/, '');
    const changed = [];
    docs.concat(official).filter(d => d.date && new Date(d.date) > reviewed).forEach(d => {
      const txt = (d.title + ' ' + d.summary + ' ' + d.url).toLowerCase();
      window.KB.policies.forEach(p => { const pu = norm(p.url); if ((pu && txt.includes(pu.toLowerCase())) || (p.url.includes('developers.google.com') && txt.includes(p.title.toLowerCase().split(':')[0]))) changed.push({ policy: p, item: d }); });
    });
    const ruleChanges = []; const seenP = new Set(); changed.forEach(c => { if (!seenP.has(c.policy.id)) { seenP.add(c.policy.id); ruleChanges.push(c); } });
    // New since last visit
    let last = {}; try { last = JSON.parse(localStorage.getItem('cqc.lastSeen') || '{}'); } catch (e) { }
    const fresh = items.filter(i => i.date && last.at && new Date(i.date) > new Date(last.at) && (i.source !== 'ser' && i.source !== 'sej' || GOOGLE_RE.test(i.title)));
    return { updates, official, industry, hot, rolling, docs, patents, ruleChanges, fresh, lastSeen: last.at || null, meta: data };
  }

  function markSeen() { try { localStorage.setItem('cqc.lastSeen', JSON.stringify({ at: new Date().toISOString() })); } catch (e) { } }
  window.CQFeeds = { load, organise, markSeen, FEEDS };
})();
