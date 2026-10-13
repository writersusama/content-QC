/* =========================================================================
   Content QC: user interface
   ========================================================================= */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = window.CQ.esc;
  const KB = window.KB;
  const PREVIEW = !!window.CQ_PREVIEW;

  /* ------------------------------ storage + settings ------------------------------ */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } }
  };
  const DEFAULTS = {
    provider: 'none', apiKey: '', model: 'gemini-2.5-flash', baseUrl: 'https://openrouter.ai/api/v1', accessCode: '',
    sensitivity: 'balanced', feedMode: 'auto', domain: '', author: '',
    house: { emDash: true, list46: true, faq5: true, noTables: true, shortParas: true, prNoFaq: true, prHeadings: true, newsRules: true, cryptoTrading: true, proofread: true }
  };
  /* API keys never go into the settings object on disk and never go to the Content QC server.
     Default: kept for this browser tab only (sessionStorage). Opt-in: remembered on this browser (localStorage). */
  const SECRET = 'cqc.secret';
  const secret = {
    read() { try { return JSON.parse(sessionStorage.getItem(SECRET) || localStorage.getItem(SECRET) || '{}'); } catch (e) { return {}; } },
    write(v, remember) {
      const empty = !v.apiKey && !v.accessCode;
      try { sessionStorage.removeItem(SECRET); } catch (e) { }
      try { localStorage.removeItem(SECRET); } catch (e) { }
      if (empty) return;
      try { (remember ? localStorage : sessionStorage).setItem(SECRET, JSON.stringify(v)); } catch (e) { }
    }
  };
  const persisted = store.get('cqc.settings', {});
  let settings = Object.assign({}, DEFAULTS, { rememberKey: false }, persisted);
  if (persisted.apiKey || persisted.accessCode) { secret.write({ apiKey: persisted.apiKey || '', accessCode: persisted.accessCode || '' }, true); settings.rememberKey = true; }
  Object.assign(settings, { apiKey: '', accessCode: '' }, secret.read());
  settings.house = Object.assign({}, DEFAULTS.house, settings.house || {});
  const saveSettings = s => {
    settings = s;
    const { apiKey, accessCode, ...rest } = s;
    store.set('cqc.settings', rest);
    secret.write({ apiKey: apiKey || '', accessCode: accessCode || '' }, !!s.rememberKey);
  };
  saveSettings(settings);
  window.CQSettings = { get: () => settings, save: saveSettings };

  const houseOpts = () => Object.assign({}, settings.house, { enabled: settings.houseOn !== false });

  /* ------------------------------ toast ------------------------------ */
  let tt;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2600); }
  async function copy(text, label = 'Copied') {
    try { await navigator.clipboard.writeText(text); toast(label); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast(label); } catch (e2) { toast('Select the text and copy it manually'); } ta.remove(); }
  }

  /* ------------------------------ theme ------------------------------ */
  const savedTheme = store.get('cqc.theme', null);
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next); store.set('cqc.theme', next);
  });

  /* ------------------------------ routing ------------------------------ */
  const VIEWS = ['check', 'report', 'library', 'sources', 'settings'];
  function go(view, push = true) {
    if (!VIEWS.includes(view)) view = 'check';
    $$('[data-view]').forEach(s => s.hidden = s.dataset.view !== view);
    $$('.nav button').forEach(b => b.setAttribute('aria-current', b.dataset.go === view ? 'page' : 'false'));
    const rail = view === 'check' || view === 'report';
    $('#rail').hidden = !rail; $('#wrap').classList.toggle('full', !rail);
    if (view === 'report') renderReport();
    if (view === 'library' && !$('#view-library').dataset.ready) renderLibrary();
    if (view === 'sources') renderSources();
    if (view === 'settings') renderSettings();
    if (push) { try { history.replaceState(null, '', '#' + view); } catch (e) { } }
    window.scrollTo({ top: 0 });
  }
  $$('[data-go]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); go(b.dataset.go); }));

  /* ------------------------------ content types ------------------------------ */
  const typeSel = $('#f-type');
  (function buildTypes() {
    const groups = {};
    Object.entries(KB.typeRules).forEach(([k, t]) => { (groups[t.group] = groups[t.group] || []).push([k, t]); });
    typeSel.innerHTML = Object.entries(groups).map(([g, items]) => `<optgroup label="${esc(g)}">${items.map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('')}</optgroup>`).join('');
  })();
  const PLACEHOLDER = {
    email: 'Paste the email. Start with "Subject: ..." on the first line so the subject is checked too.',
    ad: 'One headline or description per line. Search ads: headlines up to 30 characters, descriptions up to 90.',
    meta: 'Line 1: title tag. Line 2: meta description. (Or use the fields above.)',
    social: 'Paste the post, caption or thread. Separate thread posts with a blank line.'
  };
  function syncPlaceholder() { const t = KB.typeRules[typeSel.value]; $('#editor').dataset.placeholder = PLACEHOLDER[t.fam] || 'Paste or write your content here. Any length works; even an empty box gives you a content brief.'; }
  typeSel.addEventListener('change', () => { syncPlaceholder(); renderRoles(); });
  let role = store.get('cqc.role', null);
  function renderRoles() {
    $('#roles').innerHTML = '<span class="eyebrow" style="align-self:center;margin-right:4px">I am a</span>' + KB.roles.map(r => `<button type="button" data-role="${r.id}" aria-pressed="${role === r.id}">${esc(r.label)}</button>`).join('');
    const R = KB.roles.find(r => r.id === role);
    $('#roleTypes').innerHTML = R ? R.types.map(t => `<button type="button" data-qt="${t}" aria-pressed="${typeSel.value === t}">${esc(KB.typeRules[t].label)}</button>`).join('') : '';
    $$('[data-role]').forEach(b => b.onclick = () => { role = role === b.dataset.role ? null : b.dataset.role; store.set('cqc.role', role); const R2 = KB.roles.find(r => r.id === role); if (R2 && !R2.types.includes(typeSel.value)) { typeSel.value = R2.types[0]; syncPlaceholder(); saveDraft(); } renderRoles(); });
    $$('[data-qt]').forEach(b => b.onclick = () => { typeSel.value = b.dataset.qt; syncPlaceholder(); saveDraft(); renderRoles(); if (b.dataset.qt === 'source') $$('[data-src]').find(x => x.dataset.src === 'source').click(); });
  }

  /* ------------------------------ editor ------------------------------ */
  const ed = $('#editor');
  const ALLOWED = /^(H[1-6]|P|UL|OL|LI|A|STRONG|B|EM|I|TABLE|THEAD|TBODY|TR|TD|TH|BLOCKQUOTE|IMG|BR)$/;
  function sanitize(html) {
    const doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
    const root = doc.body.firstChild;
    root.querySelectorAll('script,style,meta,link,noscript,iframe,svg,nav,footer,header,form,button,aside').forEach(n => n.remove());
    // Google Docs: bold via style, headings via spans inside headings, wrapper <b id="docs-internal-guid...">
    root.querySelectorAll('span').forEach(sp => {
      const st = sp.getAttribute('style') || '';
      if (/font-weight\s*:\s*(700|bold|[6-9]00)/i.test(st) && !sp.closest('h1,h2,h3,h4,h5,h6')) { const s = doc.createElement('strong'); s.innerHTML = sp.innerHTML; sp.replaceWith(s); }
    });
    root.querySelectorAll('b[id^="docs-internal-guid"]').forEach(b => { const f = doc.createDocumentFragment(); while (b.firstChild) f.appendChild(b.firstChild); b.replaceWith(f); });
    const walk = el => {
      Array.from(el.children).forEach(c => {
        walk(c);
        if (!ALLOWED.test(c.tagName)) {
          if (c.tagName === 'DIV' || c.tagName === 'SECTION' || c.tagName === 'ARTICLE' || c.tagName === 'MAIN') { const p = doc.createElement(Array.from(c.children).some(x => /^(P|H\d|UL|OL|TABLE|BLOCKQUOTE|DIV)$/.test(x.tagName)) ? 'div' : 'p'); p.innerHTML = c.innerHTML; if (p.tagName === 'DIV') { const f = doc.createDocumentFragment(); while (p.firstChild) f.appendChild(p.firstChild); c.replaceWith(f); } else c.replaceWith(p); }
          else { const f = doc.createDocumentFragment(); while (c.firstChild) f.appendChild(c.firstChild); c.replaceWith(f); }
          return;
        }
        Array.from(c.attributes).forEach(a => { if (!['href', 'rel', 'alt', 'src'].includes(a.name)) c.removeAttribute(a.name); });
        if (c.tagName === 'A' && /^javascript:/i.test(c.getAttribute('href') || '')) c.removeAttribute('href');
        if (c.tagName === 'IMG' && /^data:/.test(c.getAttribute('src') || '') && (c.getAttribute('src') || '').length > 2000) c.setAttribute('src', 'embedded-image');
      });
    };
    walk(root);
    root.querySelectorAll('p').forEach(p => { if (!p.textContent.trim() && !p.querySelector('img')) p.remove(); });
    return root.innerHTML;
  }
  ed.addEventListener('paste', e => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const clean = html ? sanitize(html) : window.CQ.toHTML(text);
    document.execCommand('insertHTML', false, clean);
    $('#sampleTag').hidden = true; updateWC(); saveDraft();
  });
  ed.addEventListener('input', () => { updateWC(); saveDraft(); });
  function updateWC() { const n = window.CQ.wordsOf(ed.innerText || '').length; $('#wc').textContent = n.toLocaleString() + ' words'; }
  let dt; function saveDraft() { clearTimeout(dt); dt = setTimeout(() => store.set('cqc.draft', { html: ed.innerHTML, fields: readFields() }), 600); }

  const F = { type: '#f-type', keyword: '#f-kw', secondary: '#f-sec', metaTitle: '#f-mt', metaDesc: '#f-md', domain: '#f-dom', author: '#f-auth', slug: '#f-slug' };
  function readFields() { const o = {}; for (const [k, s] of Object.entries(F)) o[k] = $(s).value.trim(); return o; }
  function writeFields(o) { for (const [k, s] of Object.entries(F)) if (o[k] != null) $(s).value = o[k]; counters(); }
  function counters() {
    const mt = $('#f-mt').value.length, md = $('#f-md').value.length;
    $('#c-mt').textContent = mt; $('#c-mt').classList.toggle('bad', mt > 60 || (mt > 0 && mt < 30));
    $('#c-md').textContent = md; $('#c-md').classList.toggle('bad', md > 160 || (md > 0 && md < 70));
  }
  Object.values(F).forEach(s => $(s).addEventListener('input', () => { counters(); saveDraft(); }));

  // Source tabs
  $$('[data-src]').forEach(b => b.addEventListener('click', () => {
    $$('[data-src]').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    $$('[data-srcpane]').forEach(p => p.hidden = p.dataset.srcpane !== b.dataset.src);
  }));

  // File upload
  $('#f-file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      let html;
      if (/\.docx$/i.test(f.name)) {
        if (!window.mammoth) await loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js');
        const res = await window.mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
        html = sanitize(res.value);
      } else {
        const t = await f.text();
        html = /\.html?$/i.test(f.name) ? sanitize(extractMain(t)) : window.CQ.toHTML(t);
      }
      ed.innerHTML = html; $('#sampleTag').hidden = true; updateWC(); saveDraft(); toast('Imported ' + f.name);
    } catch (err) { toast('Could not read that file: ' + err.message); }
  });
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('library failed to load')); document.head.appendChild(s); }); }
  function extractMain(html) {
    const d = new DOMParser().parseFromString(html, 'text/html');
    d.querySelectorAll('script,style,nav,footer,header,aside,form,noscript,iframe,[role="navigation"],.related,.share,.comments').forEach(n => n.remove());
    const main = d.querySelector('article') || d.querySelector('main') || d.body;
    return main ? main.innerHTML : html;
  }
  function metaFrom(html) {
    const d = new DOMParser().parseFromString(html, 'text/html');
    return { title: (d.querySelector('title') || {}).textContent || '', desc: (d.querySelector('meta[name="description"]') || { getAttribute: () => '' }).getAttribute('content') || '' };
  }
  // URL import
  $('#btnImport').addEventListener('click', async () => {
    const url = $('#f-url').value.trim(); if (!/^https?:\/\//.test(url)) return toast('Enter a full URL starting with https://');
    const btn = $('#btnImport'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Importing';
    try {
      let html = null;
      try { const r = await fetch('/api/page?url=' + encodeURIComponent(url)); if (r.ok) html = (await r.json()).html; } catch (e) { }
      if (!html) {
        for (const p of [u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u), u => 'https://corsproxy.io/?url=' + encodeURIComponent(u)]) {
          try { const r = await fetch(p(url)); if (r.ok) { html = await r.text(); break; } } catch (e) { }
        }
      }
      if (!html) throw new Error('the page could not be reached from here');
      const meta = metaFrom(html);
      $('#f-source').value = html.slice(0, 800000);
      ed.innerHTML = sanitize(extractMain(html));
      if (meta.title && !$('#f-mt').value) $('#f-mt').value = meta.title.trim();
      if (meta.desc && !$('#f-md').value) $('#f-md').value = meta.desc.trim();
      try { $('#f-slug').value = new URL(url).pathname; $('#f-dom').value = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { }
      counters(); $('#sampleTag').hidden = true; updateWC(); saveDraft(); toast('Imported. Check the editor before running.');
      $$('[data-src]')[0].click();
    } catch (e) { toast('Import failed: ' + e.message + '. Paste the article instead.'); }
    btn.disabled = false; btn.textContent = 'Import';
  });

  /* ------------------------------ sample ------------------------------ */
  const SAMPLE = `# Scalping vs Swing Trading: Which Strategy Fits You in 2025?

In today's fast-paced markets, choosing the right trading style is crucial for your success. **Scalping suits traders who want quick, small gains, while swing trading suits traders who hold positions for days to catch bigger moves.**

In this guide, we'll break down how each style works, the risks, and which one fits your schedule. Let's dive in.

Summary

- Scalping trades last seconds to minutes and target a few pips.
- Swing trades last days to weeks and target larger moves.
- Your schedule and risk tolerance decide the better fit.

## What Is Scalping?

Scalping is a very short-term trading method where traders open and close positions within seconds or minutes to capture small price moves.

For example, a scalper might buy EUR/USD at 1.1601 with a 10-pip stop loss and a 15-pip take profit, then repeat that setup 20 times a day.

## How Does Swing Trading Work?

It focuses on holding trades for several days or weeks to capture a larger part of a trend. Furthermore, swing trading offers a robust and seamless way to navigate the ever-evolving landscape of the forex market — it's not just about profit, it's about discipline, patience, and strategy. Moreover, it is important to note that swing traders typically rely on daily charts, moving averages, and support and resistance levels to plan their entries and exits, which ultimately helps them make informed decisions in a comprehensive manner.

Over 70% of retail traders lose money within their first year. According to the [Bank for International Settlements](https://www.bis.org/statistics/rpfx25.htm), forex turnover averaged $9.6 trillion a day in April 2025.

## Scalping Pros and Cons

- Fast trade execution
- Many trade opportunities every day
- Works well in liquid sessions
- Higher spread and commission costs
- Mentally exhausting

## Which Is More Profitable?

Both styles can be profitable when you manage risk. Our signals deliver 90% accuracy and guaranteed profits every week, so you can trade with confidence. [Click here](https://sureshotfx.com/forex-vip-signals) to join.

## FAQs

**Is Scalping Good for Beginners?**

Scalping requires fast decisions, tight risk control and a low-cost broker, so most beginners should practise on a demo account first.

**Which Currency Pair Is Best for Scalping?**

EUR/USD is usually the best pair for scalping because it has deep liquidity and tight spreads.

**Can I Switch Between Scalping and Swing Trading?**

Yes, you can switch between them as your schedule changes.

## Final Wrap

Scalping rewards speed and screen time, while swing trading rewards patience. Pick the style that fits your day, and always risk only what you can afford to lose.`;
  function loadSample() {
    ed.innerHTML = window.CQ.mdToHTML(SAMPLE);
    writeFields({ type: 'blog', keyword: 'scalping vs swing trading', secondary: 'scalping strategy, swing trading for beginners', metaTitle: 'Scalping vs Swing Trading: Which Strategy Fits You in 2025?', metaDesc: 'Scalping vs swing trading explained for beginners.', domain: settings.domain || '', author: settings.author || '', slug: '/blog/scalping-vs-swing-trading' });
    $('#sampleTag').hidden = false; updateWC();
  }
  $('#btnSample').addEventListener('click', () => { loadSample(); toast('Sample article loaded'); });
  $('#btnClear').addEventListener('click', () => { ed.innerHTML = ''; $('#f-source').value = ''; writeFields({ keyword: '', secondary: '', metaTitle: '', metaDesc: '', slug: '' }); $('#sampleTag').hidden = true; updateWC(); saveDraft(); ed.focus(); });

  /* ------------------------------ run ------------------------------ */
  let report = null;
  let reportTab = 'findings';
  let filter = { sev: 'all', cat: null };
  let siteProfile = null, running = false;
  async function readSite(force) {
    const d = window.CQSite.clean($('#f-dom').value);
    if (!d) { siteProfile = null; $('#siteState').textContent = ''; return null; }
    if (!force && siteProfile && siteProfile.domain.replace(/^www\./, '') === d) return siteProfile;
    $('#siteState').innerHTML = '<span class="spin"></span> Reading ' + esc(d) + ' (homepage, sitemap, feed)...';
    try {
      siteProfile = await window.CQSite.load(d, force);
      $('#siteState').textContent = `Read ${siteProfile.domain}: ${(siteProfile.urls || []).length} sitemap pages, ${(siteProfile.feed || []).length} feed posts${siteProfile.fromCache ? ' (cached today)' : ''}.`;
    } catch (e) { siteProfile = null; $('#siteState').textContent = `Could not read ${d}${PREVIEW ? ' in the preview (works once hosted)' : ''}: ${e.message}. Other checks still run.`; }
    return siteProfile;
  }
  $('#btnSite').addEventListener('click', () => readSite(true));
  async function run() {
    if (running) return; running = true;
    const btn = $('#btnRun'), old = btn.innerHTML;
    const fields = readFields();
    if (window.CQSite.clean(fields.domain)) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Reading site'; await readSite(false); btn.disabled = false; btn.innerHTML = old; }
    running = false;
    const t0 = performance.now();
    report = window.CQ.analyze(Object.assign({}, fields, { html: ed.innerHTML, sourceHtml: $('#f-source').value.trim(), siteProfile: window.CQSite.clean(fields.domain) ? siteProfile : null, house: houseOpts(), sensitivity: settings.sensitivity }));
    report.ms = Math.round(performance.now() - t0);
    report.html = ed.innerHTML;
    filter = { sev: 'all', cat: null }; reportTab = 'findings';
    if (!report.brief) saveHistory(report, fields);
    go('report');
  }
  $('#btnRun').addEventListener('click', run);
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } });

  /* ------------------------------ history ------------------------------ */
  function saveHistory(r, fields) {
    const h = store.get('cqc.history', []);
    const title = (r.model.blocks.find(b => b.type === 'h' && b.level === 1) || {}).text || fields.metaTitle || r.model.sentences[0]?.text || 'Untitled';
    h.unshift({ id: Date.now(), title: window.CQ.trimWords(title, 12), score: r.overall, type: r.typeLabel, at: new Date().toISOString(), fields, html: r.html.length < 200000 ? r.html : '' });
    while (h.length > 12 || JSON.stringify(h).length > 1500000) h.pop();
    store.set('cqc.history', h); renderHistory();
  }
  function renderHistory() {
    const h = store.get('cqc.history', []);
    $('#historyPanel').hidden = !h.length;
    $('#history').innerHTML = h.map(x => `<div class="row"><span class="tag ${x.score >= 80 ? 'yes' : x.score >= 60 ? 'partial' : 'no'} num">${x.score}</span><div class="grow"><b>${esc(x.title)}</b><div class="muted" style="font-size:12.5px">${esc(x.type)} · ${new Date(x.at).toLocaleString()}</div></div>${x.html ? `<button class="btn sm" data-hist="${x.id}">Open</button>` : ''}</div>`).join('');
    $$('[data-hist]').forEach(b => b.addEventListener('click', () => { const it = store.get('cqc.history', []).find(x => String(x.id) === b.dataset.hist); if (it) { ed.innerHTML = it.html; writeFields(it.fields); $('#sampleTag').hidden = true; updateWC(); run(); } }));
  }
  $('#btnClearHist').addEventListener('click', () => { store.del('cqc.history'); renderHistory(); });

  /* ------------------------------ report ------------------------------ */
  const SEV_LABEL = { critical: 'Critical', warning: 'Warning', info: 'Suggestion', pass: 'Passed' };
  const scoreColor = s => s >= 80 ? 'var(--pass)' : s >= 60 ? 'var(--info)' : s >= 40 ? 'var(--warn)' : 'var(--crit)';
  function ring(score, label, invert) {
    const C = 2 * Math.PI * 52, off = C * (1 - score / 100);
    return `<div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--chip)" stroke-width="11"/><circle cx="60" cy="60" r="52" fill="none" stroke="${scoreColor(invert ? 100 - score : score)}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${off}"/></svg><div class="val"><div><b class="num">${score}</b><span>${label}</span></div></div></div>`;
  }
  function verdictText(r) {
    const c = r.findings.filter(f => f.sev === 'critical').length;
    if (c) return ['Fix critical issues before publishing', `${c} critical issue${c > 1 ? 's' : ''} conflict with Google policy or your guardrails. Overall score is capped until they are fixed.`];
    if (r.overall >= 85) return ['Ready to publish', 'Strong on policy, structure and trust. Polish the suggestions if you have time.'];
    if (r.overall >= 70) return ['Nearly there', 'No policy conflicts. Work through the warnings to lift rankings and AI visibility.'];
    if (r.overall >= 55) return ['Needs a revision pass', 'Several warnings affect search visibility or trust.'];
    return ['Major rework recommended', 'The content misses many quality, structure and trust signals.'];
  }

  function renderReport() {
    const v = $('#view-report');
    if (!report) {
      v.innerHTML = `<div class="panel"><div class="empty"><h3>No report yet</h3><p>Paste your content on the Check tab and run a check. Want to see how it works first? Click "Load sample" there.</p><button class="btn primary" id="goCheck">Go to Check</button></div></div>`;
      $('#goCheck').onclick = () => go('check'); return;
    }
    const r = report, m = r.metrics;
    if (r.brief) return renderBrief(v, r);
    const counts = { critical: 0, warning: 0, info: 0, pass: 0 }; r.findings.forEach(f => counts[f.sev]++);
    const [vh, vp] = verdictText(r);
    v.innerHTML = `
      <div class="panel">
        <div class="hero">
          ${ring(r.overall, 'QC score')}
          <div class="verdict" style="min-width:0">
            <div class="eyebrow">${esc(r.typeLabel)} · focus "${esc(m.keyword || 'none')}"${m.keywordInferred ? ' (inferred)' : ''}</div>
            <h2 style="margin-top:6px">${esc(vh)}</h2>
            <p class="muted" style="margin:6px 0 0">${esc(vp)}</p>
            <div class="counts">${Object.entries(counts).map(([k, n]) => `<span class="pill ${k}">${n} ${SEV_LABEL[k]}${n === 1 || k === 'pass' ? '' : 's'}</span>`).join('')}</div>
            <div class="metrics">
              ${metric(m.words.toLocaleString(), 'words · ' + m.readMin + ' min read')}
              ${metric(m.fre, 'reading ease (grade ' + m.grade + ')')}
              ${metric(m.ai.probability == null ? 'n/a' : m.ai.probability + '%', 'AI-likeness')}
              ${metric((m.voice ?? '-') + '%', 'voice match')}
              ${metric(m.keywordDensity + '%', 'keyword density')}
              ${metric(m.topicalCoverage + '%', 'topical coverage')}
            </div>
            <div class="actions">
              <button class="btn sm" id="rCopy">Copy report</button>
              ${PREVIEW ? '' : '<button class="btn sm" id="rDl">Download .md</button>'}
              <button class="btn sm" id="rEdit">Edit content</button>
              <span class="muted" style="font-size:12px">${r.findings.length} checks in ${r.ms} ms · ${new Date(r.checkedAt).toLocaleTimeString()}</span>
            </div>
          </div>
        </div>
        <div class="cats">${Object.entries(r.cats).map(([k, c]) => r.scores[k] == null ? `<div class="cat na" title="Not used for this content type"><span class="n">${esc(c.label)}</span><span class="s">n/a</span><span class="b"></span></div>` : `<button class="cat" data-cat="${k}" aria-pressed="${filter.cat === k}"><span class="n">${esc(c.label)}</span><span class="s">${r.scores[k]}</span><span class="b"><i style="width:${r.scores[k]}%;background:${scoreColor(r.scores[k])}"></i></span></button>`).join('')}</div>
      </div>
      <div class="panel">
        <div class="panel-b" style="padding-top:12px">
          <div class="tabs" role="tablist">${[['findings', 'Findings'], ['fit', 'Domain fit'], ['highlights', 'Highlights'], ['ai', 'AI detector'], ['suggest', 'Suggestions'], ['voice', 'Voice'], ['assist', 'AI Assist']].filter(([k]) => (k !== 'voice' || settings.houseOn !== false) && (k !== 'fit' || r.suggestions.fit)).map(([k, l]) => `<button role="tab" data-rtab="${k}" aria-selected="${reportTab === k}">${l}</button>`).join('')}</div>
          <div id="rbody"></div>
        </div>
      </div>`;
    $$('.cat', v).forEach(b => b.addEventListener('click', () => { filter.cat = filter.cat === b.dataset.cat ? null : b.dataset.cat; reportTab = 'findings'; renderReport(); }));
    $$('[data-rtab]', v).forEach(b => b.addEventListener('click', () => { reportTab = b.dataset.rtab; $$('[data-rtab]', v).forEach(x => x.setAttribute('aria-selected', x === b)); renderTab(); }));
    $('#rCopy').onclick = () => copy(toMarkdown(r), 'Report copied as Markdown');
    if ($('#rDl')) $('#rDl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([toMarkdown(r)], { type: 'text/markdown' })); a.download = 'content-qc-report.md'; a.click(); };
    $('#rEdit').onclick = () => go('check');
    renderTab();
  }
  function renderBrief(v, r) {
    const pl = r.plan, s = r.suggestions, kw = r.opts.keyword;
    v.innerHTML = `
      <div class="panel"><div class="hero">
        <div class="ring"><div class="val"><div><b class="num" style="font-size:26px">Brief</b><span>no text yet</span></div></div></div>
        <div class="verdict" style="min-width:0">
          <div class="eyebrow">${esc(r.typeLabel)}${kw ? ' · focus "' + esc(kw) + '"' : ''}</div>
          <h2 style="margin-top:6px">Content brief: what this ${esc(KB.typeRules[r.key].short)} needs to pass</h2>
          <p class="muted" style="margin:6px 0 0">There is no body text yet, so Content QC built a plan from the content type${kw ? ' and keyword' : ''}. Paste your draft and run again for the full quality check.</p>
          <div class="metrics" style="margin-top:12px">${metric(pl.words[0] + '-' + pl.words[1], 'words typical')}${metric(KB.typeRules[r.key].faq ? '5' : '0', 'FAQs (house rule)')}${metric(pl.policies.length, 'policies apply')}</div>
          <div class="actions"><button class="btn sm" id="rEdit">Write or paste content</button></div>
        </div></div></div>
      <div class="panel"><div class="panel-b" style="padding-top:16px">
        ${pl.outline.length ? `<div class="sec" style="margin-top:0"><h3>Suggested outline</h3>${pl.outline.map(o => `<div class="row"><div class="grow">${esc(o)}</div></div>`).join('')}</div>` : '<p class="note" style="margin-top:0">Add a focus keyword to get an outline, title ideas and People Also Ask questions.</p>'}
        ${s.titles.length ? `<div class="sec"><h3>Title ideas</h3>${s.titles.map(t => `<div class="row"><span class="tag ${t.ok ? 'yes' : 'partial'} num">${t.len}</span><div class="grow">${esc(t.text)}</div></div>`).join('')}</div>` : ''}
        ${s.paa.length ? `<div class="sec"><h3>Questions to answer</h3>${s.paa.map(p => `<div class="row"><span class="tag partial">PAA</span><div class="grow">${esc(p.q)}</div></div>`).join('')}</div>` : ''}
        ${s.lsi.missing.length ? `<div class="sec"><h3>${esc(s.lsi.niche)}: concepts and entities to cover</h3><div class="terms">${s.lsi.missing.concat(s.lsi.entMissing).map(t => `<span class="term">${esc(t)}</span>`).join('')}</div></div>` : ''}
        <div class="sec"><h3>Policies this content type is judged on</h3><div class="grid2">${pl.policies.map(p => `<div class="pol"><div class="g">${esc(p.group)}</div><h4>${esc(p.title)}</h4><p>${esc(p.summary)}</p>${refLinks([{ label: 'Official source', url: p.url }].concat(p.also || []))}</div>`).join('')}</div></div>
      </div></div>`;
    $('#rEdit').onclick = () => go('check');
  }
  const metric = (b, s) => `<div class="metric"><b>${esc(String(b))}</b><span>${esc(s)}</span></div>`;

  function renderTab() {
    const b = $('#rbody');
    ({ findings: tabFindings, fit: tabFit, highlights: tabHighlights, ai: tabAI, suggest: tabSuggest, voice: tabVoice, assist: tabAssist })[reportTab](b);
  }

  function refLinks(refs) { return refs && refs.length ? `<div class="refs">${refs.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)} &#8599;</a>`).join('')}</div>` : ''; }
  function findingCard(f) {
    return `<article class="finding ${f.sev}">
      <div class="top"><span class="pill ${f.sev}">${SEV_LABEL[f.sev]}</span><h4>${esc(f.title)}</h4><span class="catc">${esc(report.cats[f.cat].label)}</span></div>
      <p>${esc(f.reason)}</p>
      ${f.fix ? `<div class="fix"><b>How to resolve:</b> ${esc(f.fix)}</div>` : ''}
      ${f.locate && f.locate.length ? `<div class="locs">${f.locate.slice(0, 8).map(l => `<button class="loc" data-loc="${esc(l)}" title="Show in Highlights">${esc(window.CQ.trimWords(l, 8))}</button>`).join('')}</div>` : ''}
      ${refLinks(f.refs)}
    </article>`;
  }
  function tabFindings(b) {
    const sevs = ['all', 'critical', 'warning', 'info', 'pass'];
    const list = report.findings.filter(f => (filter.sev === 'all' ? f.sev !== 'pass' || filter.cat : f.sev === filter.sev) && (!filter.cat || f.cat === filter.cat));
    b.innerHTML = `<div class="filters">${sevs.map(s => `<button class="chipbtn" data-sev="${s}" aria-pressed="${filter.sev === s}">${s === 'all' ? 'All issues' : SEV_LABEL[s]}</button>`).join('')}${filter.cat ? `<button class="chipbtn" aria-pressed="true" id="clrCat">${esc(report.cats[filter.cat].label)} &times;</button>` : ''}</div>
      ${list.length ? list.map(findingCard).join('') : '<div class="empty"><h3>Nothing here</h3><p>No findings match this filter.</p></div>'}`;
    $$('[data-sev]', b).forEach(x => x.addEventListener('click', () => { filter.sev = x.dataset.sev; tabFindings(b); }));
    if ($('#clrCat')) $('#clrCat').onclick = () => { filter.cat = null; renderReport(); };
    bindLocs(b);
  }
  function bindLocs(scope) {
    $$('[data-loc]', scope).forEach(x => x.addEventListener('click', () => {
      reportTab = 'highlights'; $$('[data-rtab]').forEach(t => t.setAttribute('aria-selected', t.dataset.rtab === 'highlights')); renderTab();
      const key = x.dataset.loc.toLowerCase();
      const mk = $$('mark.iss').find(mm => mm.dataset.key === key) || $$('mark.iss').find(mm => mm.textContent.toLowerCase().includes(key.slice(0, 20)));
      if (mk) { mk.scrollIntoView({ behavior: 'smooth', block: 'center' }); mk.classList.add('flash'); setTimeout(() => mk.classList.remove('flash'), 3300); }
    }));
  }

  // Highlight view: rebuild text with sentence heat + issue marks
  function tabHighlights(b) {
    const m = report.model, ps = report.ai.perSentence;
    let si = 0;
    const sentHTML = text => window.CQ.splitSentences(text).map(s => { const sc = (ps[si] && ps[si].text === s) ? ps[si++].score : (si++, 0); return `<span class="${sc >= 0.55 ? 's-hi' : sc >= 0.38 ? 's-mid' : ''}" title="AI-likeness ${Math.round(sc * 100)}%">${esc(s)}</span>`; }).join(' ');
    const html = m.blocks.map(bl => {
      if (bl.type === 'h') return `<h${Math.min(bl.level, 3)}>${esc(bl.text)}</h${Math.min(bl.level, 3)}>`;
      if (bl.type === 'list') return `<ul>${bl.items.map(i => `<li>${sentHTML(i)}</li>`).join('')}</ul>`;
      if (bl.type === 'table') return `<p class="muted">[Table: ${bl.rows.length} rows]</p>`;
      if (bl.type === 'quote') return `<blockquote>${sentHTML(bl.text)}</blockquote>`;
      if (bl.boldOnly) return `<p><strong>${esc(bl.text)}</strong></p>`;
      return `<p>${sentHTML(bl.text)}</p>`;
    }).join('');
    b.innerHTML = `<div class="legend"><span><i style="background:var(--heat-hi)"></i>Reads AI-like</span><span><i style="background:var(--heat-mid)"></i>Borderline</span><span><i style="border-bottom:2px solid var(--crit);height:6px"></i>Flagged by a finding</span><span>Hover a sentence for its score.</span></div><div class="prose" id="hl">${html}</div>`;
    // Mark located phrases
    const phrases = [...new Set(report.findings.flatMap(f => f.locate || []).filter(p => p && p.length > 1))].sort((a, c) => c.length - a.length).slice(0, 80);
    const root = $('#hl');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(n => {
      if (n.parentNode.closest('mark')) return;
      let txt = n.nodeValue, lower = txt.toLowerCase(), hits = [];
      phrases.forEach(p => { let i = lower.indexOf(p.toLowerCase()); while (i >= 0) { if (!hits.some(h => i < h.e && i + p.length > h.s)) hits.push({ s: i, e: i + p.length, key: p.toLowerCase() }); i = lower.indexOf(p.toLowerCase(), i + p.length); } });
      if (!hits.length) return;
      hits.sort((a, c) => a.s - c.s);
      const frag = document.createDocumentFragment(); let pos = 0;
      hits.forEach(h => { frag.appendChild(document.createTextNode(txt.slice(pos, h.s))); const mk = document.createElement('mark'); mk.className = 'iss'; mk.dataset.key = h.key; mk.textContent = txt.slice(h.s, h.e); frag.appendChild(mk); pos = h.e; });
      frag.appendChild(document.createTextNode(txt.slice(pos)));
      n.parentNode.replaceChild(frag, n);
    });
  }

  function tabAI(b) {
    const a = report.ai, s = a.summary;
    const top = s.probability == null ? [] : a.perSentence.filter(x => x.score >= 0.5).sort((x, y) => y.score - x.score).slice(0, 8);
    b.innerHTML = `
      ${s.probability == null ? '<p class="note warn" style="margin-top:0">This copy is under 60 words, too short for any detector to give a meaningful score. Phrase-level checks below still apply.</p>' : ''}
      <div class="gauge-row">
        ${s.probability == null ? '<div class="ring"><div class="val"><div><b class="num">n/a</b><span>too short</span></div></div></div>' : ring(s.probability, s.verdict, true)}
        <div style="min-width:0">
          <p style="margin:0 0 10px">${s.flaggedSentences} of ${s.totalSentences} sentences read AI-like. Burstiness (sentence-length variation) ${s.burstinessCV}, contractions ${s.contractionsPer100} per 100 words, specificity ${s.specificity} details per 100 words.</p>
          ${Object.entries(a.signals).map(([k, v]) => `<div class="sig"><span>${esc(a.labels[k])}</span><span class="num" style="text-align:right">${Math.round(v * 100)}</span><span class="b"><i style="width:${Math.round(v * 100)}%;background:${v >= .6 ? 'var(--crit)' : v >= .35 ? 'var(--warn)' : 'var(--pass)'}"></i></span></div>`).join('')}
        </div>
      </div>
      <p class="note" style="margin-top:14px">Google ranks content on helpfulness, not on whether AI was used. Detector scores (here and in GPTZero, ZeroGPT, Originality or QuillBot) are probabilistic and produce false positives, especially on formal or edited text. Use this to find sentences that read generic, then rewrite them with your own data and voice.</p>
      <div class="sec"><h3>Model second opinion</h3>
        <div class="actions" style="margin-top:0"><button class="btn" id="aiSecond">Run with ${esc(providerName())}</button><span class="muted" style="font-size:12.5px">${settings.provider === 'none' ? 'Connect a free Gemini key in Settings to enable.' : 'Sends the text to your chosen model.'}</span></div>
        <div id="aiSecondOut"></div></div>
      ${top.length ? `<div class="sec"><h3>Sentences to rewrite first</h3>${top.map(x => `<div class="row"><span class="tag no num">${Math.round(x.score * 100)}</span><div class="grow">${esc(x.text)}</div></div>`).join('')}</div>` : ''}
      ${a.phraseHits.length ? `<div class="sec"><h3>AI-associated phrases</h3><div class="terms">${a.phraseHits.map(h => `<span class="term">${esc(h.phrase)}${h.count > 1 ? ' ×' + h.count : ''}</span>`).join('')}</div></div>` : ''}
      <div class="sec"><h3>How popular detectors work, and how Content QC mirrors them</h3><div class="grid2">${KB.detectors.map(d => `<div class="card"><h4>${esc(d.name)}</h4><p>${esc(d.how)}</p><p class="muted">${esc(d.mimic)}</p></div>`).join('')}</div></div>`;
    $('#aiSecond').onclick = () => runTask('detect', $('#aiSecondOut'), $('#aiSecond'));
  }

  function tabFit(b) {
    const f = report.suggestions.fit; if (!f) { b.innerHTML = '<p class="muted">Enter a target website on the Check page to see domain fit.</p>'; return; }
    const S = f.site;
    b.innerHTML = `<div class="gauge-row">${ring(f.score, 'domain fit')}<div style="min-width:0">
        <div class="eyebrow">${esc(S.domain)} · ${esc(f.siteNiche)}</div><h3 style="font-size:19px;margin:6px 0">${esc(f.verdict)}</h3>
        <p style="margin:0" class="muted">${esc(S.title || '')}${S.description ? ' · ' + esc(window.CQ.trimWords(S.description, 22)) : ''}</p>
        <div class="metrics" style="margin-top:10px">${metric(S.pages, 'pages known')}${metric(S.feedCount, 'recent posts')}${metric(S.lastPost ? new Date(S.lastPost).toLocaleDateString() : 'n/a', 'latest post')}${metric(f.shared.length + '/' + (f.shared.length + f.newTopics.length), 'topics shared')}</div></div></div>
      <div class="sec"><h3>Topics the site already covers</h3><div class="terms">${f.shared.map(t => `<span class="term">${esc(t)}</span>`).join('') || '<span class="muted">None</span>'}</div></div>
      <div class="sec"><h3>Topics new to this site</h3><div class="terms">${f.newTopics.map(t => `<span class="term miss">${esc(t)}</span>`).join('') || '<span class="muted">None: fully on-topic</span>'}</div></div>
      ${f.cannibal.length ? `<div class="sec"><h3>Existing pages on the same topic</h3>${f.cannibal.map(c => `<div class="row"><span class="tag ${c.same ? 'yes' : 'no'}">${c.same ? 'This page' : 'Competes'}</span><div class="grow"><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a><div class="muted" style="font-size:12.5px">${esc(c.label)}</div></div></div>`).join('')}</div>` : ''}
      ${f.links.length ? `<div class="sec"><h3>Internal links to add (real URLs)</h3>${f.links.map(l => `<div class="row"><div class="grow"><b>"${esc(l.anchor)}"</b> &#8594; <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url)}</a></div><button class="btn sm" data-copylink="${esc('<a href="' + l.url + '">' + l.anchor + '</a>')}">Copy link</button></div>`).join('')}</div>` : ''}
      <div class="sec"><h3>Fit findings</h3>${report.findings.filter(x => x.cat === 'fit').map(findingCard).join('')}</div>
      <p class="note">Content QC compares your text with the site's homepage, navigation, sitemap URLs and RSS feed (read ${S.via === 'public proxy' ? 'through a public proxy' : 'by your server'}; cached for 24 hours). Click "Read site" on the Check page to refresh.</p>`;
    $$('[data-copylink]', b).forEach(x => x.addEventListener('click', () => copy(x.dataset.copylink, 'Link HTML copied')));
  }
  function tabSuggest(b) {
    const s = report.suggestions;
    const copyBtn = (id) => `<button class="btn sm" data-copy="${id}">Copy</button>`;
    const blobs = {};
    let i = 0; const reg = t => { const k = 'c' + (i++); blobs[k] = t; return k; };
    b.innerHTML = `
      ${s.titles.length ? `<div class="sec" style="margin-top:4px"><h3>Title tags</h3>${s.titles.map(t => `<div class="row"><span class="tag ${t.ok ? 'yes' : 'partial'} num">${t.len}</span><div class="grow">${esc(t.text)}</div>${copyBtn(reg(t.text))}</div>`).join('')}</div>` : ''}
      ${s.descriptions.length ? `<div class="sec"><h3>Meta descriptions</h3>${s.descriptions.map(t => `<div class="row"><span class="tag ${t.ok ? 'yes' : 'partial'} num">${t.len}</span><div class="grow">${esc(t.text)}</div>${copyBtn(reg(t.text))}</div>`).join('')}<p class="note" style="margin-top:8px">These are drafted from your own sentences. Use AI Assist for polished, CTR-focused versions.</p></div>` : ''}
      <div class="sec"><h3>Snippet summaries per heading <span class="muted" style="font-weight:500;font-size:12.5px">for featured snippets and AI Overviews</span></h3>${s.snippets.length ? s.snippets.map(x => `<div class="row"><span class="tag ${x.ok ? 'yes' : 'no'}">${x.ok ? 'Ready' : 'Revise'}</span><div class="grow"><b>${esc(x.heading)}</b><div style="font-size:13.5px;margin-top:3px">${esc(x.suggestion || '(no opening paragraph)')}</div><div class="muted" style="font-size:12.5px">${esc(x.why)}</div></div></div>`).join('') : '<p class="muted">No H2 sections found.</p>'}</div>
      ${s.paa.length ? `<div class="sec"><h3>People Also Ask coverage</h3>${s.paa.map(p => `<div class="row"><span class="tag ${p.covered}">${p.covered === 'yes' ? 'Answered' : p.covered === 'partial' ? 'Partly' : 'Missing'}</span><div class="grow">${esc(p.q)}</div></div>`).join('')}</div>` : ''}
      <div class="sec"><h3>Semantic SEO: ${esc(s.lsi.niche)}</h3>
        ${s.lsi.present.length || s.lsi.missing.length ? `<p class="muted" style="margin:0 0 6px;font-size:13px">Related concepts (solid = used, dashed = missing)</p><div class="terms">${s.lsi.present.map(t => `<span class="term">${esc(t)}</span>`).join('')}${s.lsi.missing.map(t => `<span class="term miss">${esc(t)}</span>`).join('')}</div>` : ''}
        ${s.lsi.entPresent.length || s.lsi.entMissing.length ? `<p class="muted" style="margin:12px 0 6px;font-size:13px">Entities</p><div class="terms">${s.lsi.entPresent.map(t => `<span class="term">${esc(t)}</span>`).join('')}${s.lsi.entMissing.map(t => `<span class="term miss">${esc(t)}</span>`).join('')}</div>` : ''}
        <p class="muted" style="margin:12px 0 6px;font-size:13px">What your page is about (most frequent terms)</p><div class="terms">${s.lsi.topTerms.map(t => `<span class="term">${esc(t.term)} <span class="num muted">${t.count}</span></span>`).join('')}</div></div>
      ${s.internal.length ? `<div class="sec"><h3>Internal linking opportunities${s.fit ? ' (from the target site)' : ''}</h3>${s.internal.map(x => `<div class="row"><div class="grow"><b>"${esc(x.anchor)}"</b> <span class="muted">${x.url ? '' : 'in ' + esc(window.CQ.trimWords(x.where, 8))}</span><div style="font-size:13px">Link to ${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url)}</a>` : esc(x.target)}</div></div></div>`).join('')}</div>` : ''}
      ${s.unsourced.length ? `<div class="sec"><h3>Statistics that need a source</h3>${s.unsourced.map(x => `<div class="row"><span class="tag no">Source?</span><div class="grow">${esc(x)}</div></div>`).join('')}</div>` : ''}
      <div class="sec"><h3>Plagiarism spot-check (free, exact-match on Google)</h3><p class="muted" style="margin:0 0 6px;font-size:13px">Copyscape-style sampling: open each search. If another site shows the same wording, rewrite that passage.</p>${s.spot.map(x => `<div class="row"><div class="grow" style="font-size:13.5px">"${esc(x.fragment)}"</div><a class="btn sm" href="${esc(x.url)}" target="_blank" rel="noopener">Search &#8599;</a></div>`).join('') || '<p class="muted">Not enough long sentences to sample.</p>'}</div>
      ${s.faqs.length ? `<div class="sec"><h3>FAQs detected (${s.faqs.length})</h3>${s.faqs.map(f => `<div class="row"><div class="grow"><b>${esc(f.q)}</b><div style="font-size:13.5px">${esc(f.a || '(no answer found)')}</div></div></div>`).join('')}</div>` : ''}
      ${s.faqSchema ? `<div class="sec"><h3>FAQPage JSON-LD ${copyBtn(reg(wrapLd(s.faqSchema)))}</h3><p class="note" style="margin:0 0 6px">Optional: Google stopped showing FAQ rich results in May 2026. Other engines and AI tools can still read it.</p><pre class="code">${esc(s.faqSchema)}</pre></div>` : ''}
      <div class="sec"><h3>Article JSON-LD ${copyBtn(reg(wrapLd(s.articleSchema)))}</h3><p class="note" style="margin:0 0 6px">Use the real publish date and author; markup must match what is visible on the page.</p><pre class="code">${esc(s.articleSchema)}</pre></div>`;
    $$('[data-copy]', b).forEach(x => x.addEventListener('click', () => copy(blobs[x.dataset.copy])));
  }
  const wrapLd = j => '<script type="application/ld+json">\n' + j + '\n</' + 'script>';

  function tabVoice(b) {
    const v = report.suggestions.voice;
    b.innerHTML = `<div class="gauge-row">${ring(v.score, 'voice match')}<div style="min-width:0"><p style="margin:0">Compared with the structure and tone of your published articles. Each trait below is something those articles do consistently.</p><div class="refs" style="margin-top:8px">${KB.voice.samples.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">Sample ${i + 1} &#8599;</a>`).join('')}</div></div></div>
      <div class="sec">${v.traits.map(t => `<div class="row"><span class="tag ${t.ok ? 'yes' : 'no'}">${t.ok ? 'Matches' : 'Missing'}</span><div class="grow">${esc(t.label)}</div></div>`).join('')}</div>
      <div class="sec"><h3>House rules applied</h3><div class="terms">${Object.entries(settings.house).filter(([, on]) => on).map(([k]) => `<span class="term">${esc(HOUSE[k][0])}</span>`).join('')}</div><p class="muted" style="font-size:13px">Change these in Settings.</p></div>`;
  }

  function providerName() { return { none: 'an AI model', gemini: 'Gemini', openai: 'your model', server: 'the server model' }[settings.provider]; }
  function tabAssist(b) {
    const T = window.CQAI.tasks;
    b.innerHTML = `${settings.provider === 'none' ? `<p class="note warn">No model connected. Content QC works fully without one; these extras use your own free key. Open Settings, choose Gemini and paste your key from Google AI Studio. It goes only from your browser to Google, never to this site's server.</p>` : `<p class="note">Using ${esc(providerName())}${settings.model ? ' · ' + esc(settings.model) : ''}. Your article text is sent to that provider only when you click a button.</p>`}
      <div class="field" style="margin-top:12px"><label for="selText">Text to humanize (leave empty to use the sentences flagged as AI-like)</label><textarea class="input" id="selText" rows="4" placeholder="Paste a paragraph..."></textarea></div>
      <div class="actions">${Object.entries(T).filter(([k]) => k !== 'detect').map(([k, t]) => `<button class="btn" data-task="${k}">${esc(t.label)}</button>`).join('')}</div>
      <div id="assistOut" style="margin-top:14px"></div>`;
    $$('[data-task]', b).forEach(x => x.addEventListener('click', () => runTask(x.dataset.task, $('#assistOut'), x, $('#selText').value.trim())));
  }
  async function runTask(key, out, btn, sel) {
    const t = window.CQAI.tasks[key];
    const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Working';
    out.innerHTML = '';
    try {
      const raw = await window.CQAI.call(t.prompt(report, sel), { json: t.json });
      const j = t.json ? window.CQAI.parseJSON(raw) : null;
      out.innerHTML = renderTaskOut(key, j, raw);
      $$('[data-copyraw]', out).forEach(x => x.addEventListener('click', () => copy(x.closest('.sec').querySelector('.out,pre').innerText)));
    } catch (e) { out.innerHTML = `<p class="note warn">${esc(e.message)}</p>`; }
    btn.disabled = false; btn.innerHTML = old;
  }
  function renderTaskOut(key, j, raw) {
    const cp = '<button class="btn sm" data-copyraw>Copy</button>';
    if (!j && key !== 'humanize') return `<div class="sec"><h3>Result ${cp}</h3><div class="out">${esc(raw)}</div></div>`;
    switch (key) {
      case 'humanize': return `<div class="sec"><h3>Rewrite in your voice ${cp}</h3><div class="out">${esc(raw.replace(/—/g, ','))}</div><p class="muted" style="font-size:12.5px">Em dashes are removed automatically. Re-run the check after pasting it back.</p></div>`;
      case 'detect': return `<div class="sec"><h3>${esc(j.verdict || '')} · ${esc(String(j.ai_probability ?? '?'))}% (model) vs ${report.ai.summary.probability == null ? 'n/a' : report.ai.summary.probability + '%'} (local)</h3>${(j.reasons || []).map(r => `<div class="row"><div class="grow">${esc(r)}</div></div>`).join('')}${(j.sentences_to_revise || []).map(s => `<div class="row"><span class="tag no">Revise</span><div class="grow">${esc(s.sentence)}<div class="muted" style="font-size:12.5px">${esc(s.why)}</div></div></div>`).join('')}</div>`;
      case 'meta': return `<div class="sec"><h3>Title tags</h3>${(j.titles || []).map(t => `<div class="row"><span class="tag ${t.length <= 60 ? 'yes' : 'partial'} num">${t.length}</span><div class="grow">${esc(t)}</div></div>`).join('')}</div><div class="sec"><h3>Meta descriptions</h3>${(j.descriptions || []).map(t => `<div class="row"><span class="tag ${t.length <= 160 ? 'yes' : 'partial'} num">${t.length}</span><div class="grow">${esc(t)}</div></div>`).join('')}</div>${j.slug ? `<div class="sec"><h3>Slug</h3><div class="out">${esc(j.slug)}</div></div>` : ''}`;
      case 'snippets': return `<div class="sec"><h3>Snippet summaries ${cp}</h3><div class="out">${esc((j.items || []).map(x => x.heading + '\n' + x.summary).join('\n\n'))}</div></div>`;
      case 'faq': return `<div class="sec"><h3>5 FAQs ${cp}</h3><div class="out">${esc((j.faqs || []).map(f => f.q + '\n' + f.a).join('\n\n'))}</div></div>`;
      case 'policy': return `<div class="sec"><h3>Policy review</h3>${(j.issues || []).length ? j.issues.map(x => `<article class="finding warning"><div class="top"><h4>${esc(x.policy)}</h4></div><p><i>"${esc(x.quote)}"</i></p><p>${esc(x.reason)}</p><div class="fix"><b>How to resolve:</b> ${esc(x.fix)}</div>${x.url && /^https:\/\//.test(x.url) ? `<div class="refs"><a href="${esc(x.url)}" target="_blank" rel="noopener">Reference &#8599;</a></div>` : ''}</article>`).join('') : '<p>No conflicts found by the model.</p>'}${(j.strengths || []).length ? `<h3 style="margin-top:14px;font-size:14px">Strengths</h3>${j.strengths.map(s => `<div class="row"><span class="tag yes">Good</span><div class="grow">${esc(s)}</div></div>`).join('')}` : ''}</div>`;
      case 'facts': return `<div class="sec"><h3>Claims to verify</h3>${(j.claims || []).map(c => `<div class="row"><span class="tag ${c.risk === 'high' ? 'no' : c.risk === 'medium' ? 'partial' : 'yes'}">${esc(c.risk || '')}</span><div class="grow">${esc(c.claim)}<div class="muted" style="font-size:12.5px">Source to find: ${esc(c.source_to_find || '')}</div></div></div>`).join('')}</div>`;
    }
    return `<div class="out">${esc(raw)}</div>`;
  }

  function toMarkdown(r) {
    const L = [];
    L.push(`# Content QC report`, '', `- Type: ${r.typeLabel}`, `- Focus keyword: ${r.metrics.keyword || 'none'}`, `- QC score: ${r.overall}/100`, `- Words: ${r.metrics.words} · Reading ease: ${r.metrics.fre} · AI-likeness: ${r.metrics.ai.probability == null ? 'n/a' : r.metrics.ai.probability + '%'} · Voice match: ${r.metrics.voice}%`, `- Checked: ${new Date(r.checkedAt).toLocaleString()}`, '', '## Category scores', '');
    Object.entries(r.cats).forEach(([k, c]) => L.push(`- ${c.label}: ${r.scores[k] == null ? 'n/a' : r.scores[k]}`));
    ['critical', 'warning', 'info'].forEach(sev => {
      const fs = r.findings.filter(f => f.sev === sev); if (!fs.length) return;
      L.push('', `## ${SEV_LABEL[sev]}s (${fs.length})`, '');
      fs.forEach(f => { L.push(`### ${f.title}`, `*${r.cats[f.cat].label}*`, '', f.reason, '', f.fix ? `**How to resolve:** ${f.fix}` : '', f.refs.length ? 'References: ' + f.refs.map(x => `[${x.label}](${x.url})`).join(', ') : '', ''); });
    });
    const s = r.suggestions;
    if (s.titles.length) { L.push('## Suggested title tags', ''); s.titles.forEach(t => L.push(`- ${t.text} (${t.len})`)); }
    if (s.descriptions.length) { L.push('', '## Suggested meta descriptions', ''); s.descriptions.forEach(t => L.push(`- ${t.text} (${t.len})`)); }
    if (s.paa.length) { L.push('', '## People Also Ask coverage', ''); s.paa.forEach(p => L.push(`- [${p.covered}] ${p.q}`)); }
    return L.filter(x => x !== null).join('\n');
  }

  /* ------------------------------ Google Pulse ------------------------------ */
  let feeds = null, feedTab = store.get('cqc.feedTab', 'hot');
  const SRC_NAME = { status: 'Status', gblog: 'Google', ser: 'SER', sej: 'SEJ', docs: 'Docs', patents: 'Patents' };
  const ago = d => { if (!d) return ''; const s = (Date.now() - new Date(d)) / 1000; if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago'; if (s < 86400 * 30) return Math.round(s / 86400) + 'd ago'; return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
  const dur = (a, b) => { const d = (new Date(b) - new Date(a)) / 864e5; return d < 1 ? Math.round(d * 24) + ' hours' : Math.round(d) + ' days'; };
  async function loadFeeds(force) {
    $('#btnRefresh').disabled = true;
    try { feeds = window.CQFeeds.organise(await window.CQFeeds.load(force)); if (!feeds.meta.snapshot) window.CQFeeds.markSeen(); } catch (e) { feeds = null; }
    $('#btnRefresh').disabled = false;
    if (!$('#view-library').hidden) renderLibrary();
    renderFeeds();
    if (!$('#view-sources').hidden) renderSources();
  }
  function feedItem(i) {
    const st = i.source === 'status' ? (i.end && new Date(i.end) < Date.now() ? `<span class="state">Complete · ${dur(i.date, i.end)}</span>` : '<span class="state on">Rolling out</span>') : '';
    const isNew = feeds && feeds.lastSeen && i.date && new Date(i.date) > new Date(feeds.lastSeen);
    return `<li><a class="t" href="${esc(i.url)}" target="_blank" rel="noopener">${isNew ? '<span class="newdot" title="New since your last visit"></span>' : ''}${esc(i.title)}</a><div class="m"><span class="src ${i.source}">${SRC_NAME[i.source] || i.source}</span><span>${ago(i.date)}</span>${st}</div></li>`;
  }
  function renderFeeds() {
    $$('[data-feed]').forEach(b => b.setAttribute('aria-selected', b.dataset.feed === feedTab));
    const body = $('#feedBody');
    if (!feeds) { body.innerHTML = '<p class="muted" style="padding:0 16px 14px">Feeds unavailable.</p>'; return; }
    const meta = feeds.meta;
    $('#liveDot').classList.toggle('off', !!(meta.snapshot || meta.stale));
    $('#feedMeta').textContent = meta.snapshot ? 'Offline snapshot from ' + new Date(meta.fetchedAt).toLocaleDateString() : `Updated ${ago(meta.fetchedAt)} via ${meta.via}${meta.fromCache ? ' (cached)' : ''}`;
    $('#rollingBox').innerHTML = (feeds.rolling.length ? feeds.rolling.map(r => `<div class="rolling">Rolling out now: <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a> · started ${ago(r.date)}</div>`).join('') : '')
      + (feeds.ruleChanges.length ? `<div class="rolling" style="background:var(--info-bg);color:var(--info)">Google changed ${feeds.ruleChanges.length} page(s) in Content QC's rule book since its last review: ${feeds.ruleChanges.slice(0, 3).map(c => `<a href="${esc(c.item.url)}" target="_blank" rel="noopener">${esc(c.policy.title)}</a>`).join(', ')}. Findings that cite them still link to the live page.</div>` : '')
      + (feeds.fresh.length ? `<div class="rolling" style="background:var(--pass-bg);color:var(--pass)">${feeds.fresh.length} new item(s) since your last visit, marked with a dot.</div>` : '');
    if (feedTab === 'hot') {
      const latest = feeds.updates[0];
      body.innerHTML = `${latest ? `<div class="hot"><div class="hot-item"><div class="eyebrow">Latest ranking update</div><a class="t" style="display:block;margin-top:5px;font-weight:700;color:var(--ink);text-decoration:none" href="${esc(latest.url)}" target="_blank" rel="noopener">${esc(latest.title)}</a><div class="muted" style="font-size:12px;margin-top:3px">${new Date(latest.date).toLocaleDateString()} ${latest.end ? '· complete ' + new Date(latest.end).toLocaleDateString() : '· rolling out'}</div></div></div>` : ''}
        <div class="hot">${feeds.hot.length ? feeds.hot.map(h => `<div class="hot-item"><b>${esc(h.name)}</b> <span class="muted" style="font-size:12px">${h.count} stor${h.count === 1 ? 'y' : 'ies'} · ${h.sources} source${h.sources > 1 ? 's' : ''}</span><div class="bar"><i style="width:${Math.min(100, h.count * 18)}%"></i></div>${h.items.map(i => `<a href="${esc(i.url)}" target="_blank" rel="noopener" style="display:block;font-size:12.5px;margin-top:3px">${esc(window.CQ.trimWords(i.title, 12))}</a>`).join('')}</div>`).join('') : '<p class="muted" style="margin:0">No trending Google topics in the last 14 days of the feeds.</p>'}</div>`;
    } else {
      const list = feeds[feedTab] || [];
      body.innerHTML = list.length ? `<ul class="feed">${list.slice(0, 20).map(feedItem).join('')}</ul>` : '<p class="muted" style="padding:0 16px 14px">Nothing to show from this source right now.</p>';
    }
  }
  $$('[data-feed]').forEach(b => b.addEventListener('click', () => { feedTab = b.dataset.feed; store.set('cqc.feedTab', feedTab); renderFeeds(); }));
  // Watch automatically: re-check the official feeds every 30 minutes while the app is open
  setInterval(() => loadFeeds(false), 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && feeds && Date.now() - new Date(feeds.meta.fetchedAt) > 30 * 60 * 1000) loadFeeds(false); });
  $('#btnRefresh').addEventListener('click', () => loadFeeds(true));

  /* ------------------------------ Library ------------------------------ */
  function renderLibrary() {
    const v = $('#view-library'); v.dataset.ready = '1';
    const groups = [...new Set(KB.rankingFactors.map(f => f.group))];
    v.innerHTML = `
      <div class="panel"><div class="panel-h"><div><h2>Policy Library</h2><div class="sub">Everything Content QC checks against, with links to the official source. Reviewed ${esc(KB.reviewed)}.</div></div></div>
        <div class="panel-b">
          <div class="lib-search"><input class="input" id="libQ" placeholder="Search policies, systems, patents, factors..."><select class="input" id="libGroup" style="flex:0 1 220px"><option value="">All policy areas</option>${[...new Set(KB.policies.map(p => p.group))].map(g => `<option>${esc(g)}</option>`).join('')}</select><select class="input" id="libType" style="flex:0 1 220px"><option value="">All content types</option>${Object.entries(KB.typeRules).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('')}</select></div>
          <div class="tabs" role="tablist">${[['pol', 'Google policies (' + KB.policies.length + ')'], ['sys', 'Ranking systems (' + KB.rankingSystems.length + ')'], ['pat', 'Patents (' + KB.patents.length + ')'], ['fac', 'Ranking factors (' + KB.rankingFactors.length + ')'], ['types', 'By content type']].map(([k, l], i) => `<button role="tab" data-lt="${k}" aria-selected="${i === 0}">${l}</button>`).join('')}</div>
          <div id="libBody"></div>
        </div></div>`;
    let lt = 'pol';
    const draw = () => {
      const q = $('#libQ').value.toLowerCase().trim(), ty = $('#libType').value, gr = $('#libGroup').value;
      const match = (...xs) => !q || xs.join(' ').toLowerCase().includes(q);
      const lb = $('#libBody');
      if (lt === 'pol') lb.innerHTML = `<p class="note" style="margin-top:0">Covers Google Search, Google Ads, YouTube, Merchant Center, Business Profile, Google Play, AdSense, Gmail and Bing (which also feeds Yahoo, much of DuckDuckGo and Copilot), plus AI answer engines and email law (CAN-SPAM). Filter by policy area or content type.</p><div class="grid2" style="margin-top:12px">${KB.policies.filter(p => match(p.title, p.summary, p.group) && (!gr || p.group === gr) && (!ty || p.types.includes('all') || p.types.includes(ty) || p.types.includes((KB.typeRules[ty] || {}).fam) || (KB.typeRules[ty] || { policies: [] }).policies.includes(p.id))).map(p => `<div class="pol"><div class="g">${esc(p.group)}</div><h4>${esc(p.title)}</h4><p>${esc(p.summary)}</p>${(() => { const c = feeds && feeds.ruleChanges.find(x => x.policy.id === p.id); return c ? `<p class="note warn" style="margin:0 0 8px">Google changed this page on ${new Date(c.item.date).toLocaleDateString()}: <a href="${esc(c.item.url)}" target="_blank" rel="noopener">${esc(c.item.title)}</a>. Summary may need a refresh.</p>` : ''; })()}${refLinks([{ label: 'Official source', url: p.url }].concat(p.also || []))}</div>`).join('') || '<p class="muted">No match.</p>'}</div>`;
      if (lt === 'sys') lb.innerHTML = `<p class="note" style="margin-top:0">From Google's own guide to Search ranking systems. These are confirmed systems; "helpful content" is now part of the core systems.</p><div class="grid2" style="margin-top:12px">${KB.rankingSystems.filter(s => match(s.name, s.what, s.tip)).map(s => `<div class="pol"><h4>${esc(s.name)}</h4><p>${esc(s.what)}</p><p class="muted">For writers: ${esc(s.tip)}</p>${refLinks([{ label: 'Ranking systems guide', url: s.url }])}</div>`).join('')}</div>`;
      if (lt === 'pat') lb.innerHTML = `<p class="note warn" style="margin-top:0">Patents show what Google has explored, not proof a method is used in ranking today. Content QC uses them as writing principles.</p><div class="grid2" style="margin-top:12px">${KB.patents.filter(p => match(p.title, p.concept, p.apply)).map(p => `<div class="pol"><h4>${esc(p.title)}</h4><p>${esc(p.concept)}</p><p class="muted">Apply it: ${esc(p.apply)}</p>${refLinks([{ label: 'Google Patents', url: p.url }])}</div>`).join('')}</div>`;
      if (lt === 'fac') lb.innerHTML = `<div class="legend"><span><span class="kind c">C</span> Google confirmed or documented</span><span><span class="kind p">P</span> Patent concept</span><span><span class="kind o">O</span> Industry-observed correlation</span><span style="color:var(--accent);font-weight:700">Checked = Content QC tests it from your text</span></div><p class="note">Popular "200+ ranking factors" lists mix confirmed signals with guesses. This index separates them: ${KB.rankingFactors.filter(f => f.checks).length} of ${KB.rankingFactors.length} can be judged from the text you paste; the rest need site-level tools (Search Console, PageSpeed, backlink data).</p>${groups.map(g => { const fs = KB.rankingFactors.filter(f => f.group === g && match(f.name, f.group)); return fs.length ? `<div class="sec"><h3>${esc(g)} <span class="muted num" style="font-weight:500">${fs.length}</span></h3>${fs.map(f => `<div class="factor"><span class="kind ${f.kind}">${f.kind.toUpperCase()}</span><span>${esc(f.name)}</span>${f.checks ? '<span class="ck">Checked</span>' : ''}</div>`).join('')}</div>` : ''; }).join('')}`;
      if (lt === 'types') lb.innerHTML = `<div class="grid2">${Object.entries(KB.typeRules).filter(([k]) => !ty || k === ty).map(([k, t]) => `<div class="pol"><div class="g">${t.idealWords[0]}-${t.idealWords[1]} words typical</div><h4>${esc(t.label)}</h4><p>${t.faq ? 'FAQ section expected.' : 'No FAQ section.'} Main policies:</p><div class="terms">${t.policies.map(id => { const p = KB.policies.find(x => x.id === id); return p ? `<a class="term" style="text-decoration:none" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : ''; }).join('')}</div></div>`).join('')}</div>`;
    };
    $$('[data-lt]', v).forEach(b => b.addEventListener('click', () => { lt = b.dataset.lt; $$('[data-lt]', v).forEach(x => x.setAttribute('aria-selected', x === b)); draw(); }));
    $('#libQ').addEventListener('input', draw); $('#libType').addEventListener('change', draw); $('#libGroup').addEventListener('change', draw);
    draw();
  }

  /* ------------------------------ Live Sources ------------------------------ */
  function renderSources() {
    const v = $('#view-sources');
    const all = feeds ? feeds.updates.concat(feeds.official, feeds.docs, feeds.patents, feeds.industry).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)) : [];
    const lastScan = store.get('cqc.webscan', null);
    v.innerHTML = `
      <div class="panel"><div class="panel-h"><div><h2>Watching Google automatically</h2><div class="sub">Every 30 minutes while Content QC is open, it re-reads Google's official change logs and flags anything new since your last visit.</div></div></div>
        <div class="panel-b">
          <div class="terms" style="margin-bottom:12px">${['Search Status Dashboard (ranking updates)', 'Search Central documentation updates (policy and doc changes)', 'Search Central Blog (announcements)', 'Google patents and research (SEJ)', 'Search Engine Roundtable', 'Search Engine Journal'].map(t => `<span class="term">${esc(t)}</span>`).join('')}</div>
          ${feeds && feeds.ruleChanges.length ? `<div class="sec" style="margin-top:0"><h3>Rule-book pages Google changed since ${esc(KB.reviewed)}</h3>${feeds.ruleChanges.map(c => `<div class="row"><span class="tag partial">Changed</span><div class="grow"><b>${esc(c.policy.title)}</b><div style="font-size:13px"><a href="${esc(c.item.url)}" target="_blank" rel="noopener">${esc(c.item.title)}</a> · ${new Date(c.item.date).toLocaleDateString()}</div></div></div>`).join('')}</div>` : '<p class="note" style="margin:0">No rule-book page has changed at Google since Content QC\'s last review.</p>'}
          <div class="sec"><h3>Latest documentation changes</h3>${feeds && feeds.docs.length ? `<ul class="feed" style="max-height:340px;padding:0">${feeds.docs.slice(0, 12).map(feedItem).join('')}</ul>` : '<p class="muted">Not loaded yet.</p>'}</div>
          <div class="sec"><h3>Search Google for anything the feeds missed</h3>
            <p class="muted" style="margin:0 0 8px;font-size:13.5px">Uses Gemini with Grounding with Google Search (Google's official, allowed way to search; scraping Google results breaks its spam policies). Runs with your own Gemini key or the server proxy. Google includes a monthly allowance of free grounded searches; check your AI Studio quota.</p>
            <div class="actions" style="margin-top:0"><button class="btn primary" id="webScan">Scan Google Search for new policies, updates and patents</button><span class="muted" style="font-size:12.5px">${lastScan ? 'Last scan ' + esc(new Date(lastScan.at).toLocaleString()) : 'Not scanned yet'}</span></div>
            <div id="webScanOut" style="margin-top:12px">${lastScan ? renderScan(lastScan) : ''}</div></div>
        </div></div>
      `;
    v.innerHTML += `
      <div class="panel"><div class="panel-h"><div><h2>Official and industry sources</h2><div class="sub">Live links Content QC follows. Feeds refresh every 30 minutes.</div></div></div>
        <div class="panel-b"><div class="grid2">${KB.sources.map(s => `<a class="pol" style="text-decoration:none;color:inherit" href="${esc(s.url)}" target="_blank" rel="noopener"><div class="g">${s.kind === 'official' ? 'Official Google' : 'Industry news'}</div><h4>${esc(s.name)} &#8599;</h4><p class="muted" style="margin:0">${esc(s.note)}</p></a>`).join('')}</div></div></div>
      <div class="panel"><div class="panel-h"><div><h2>Read and watch a Google doc</h2><div class="sub">Pulls the current text of an official page so you can read it here, and tells you when it changed since your last visit.</div></div></div>
        <div class="panel-b"><div class="actions" style="margin-top:0"><select class="input" id="docSel" style="flex:1 1 260px">${KB.watchDocs.map(d => `<option value="${esc(d.url)}">${esc(d.name)}</option>`).join('')}</select><button class="btn" id="docGo">Fetch latest</button><a class="btn" id="docOpen" href="${esc(KB.watchDocs[0].url)}" target="_blank" rel="noopener">Open original &#8599;</a></div>
        <div id="docOut" style="margin-top:12px"></div></div></div>
      <div class="panel"><div class="panel-h"><div><h2>All recent items</h2><div class="sub">${feeds ? esc(feeds.meta.via) + ' · ' + all.length + ' items' : 'Loading'}</div></div></div><div class="panel-b"><ul class="feed" style="max-height:none;padding:0">${all.slice(0, 60).map(feedItem).join('')}</ul></div></div>`;
    $('#docSel').addEventListener('change', e => { $('#docOpen').href = e.target.value; });
    $('#docGo').addEventListener('click', fetchDoc);
    $('#webScan').addEventListener('click', webScan);
  }
  function renderScan(sc) {
    const items = sc.items || [];
    return `${items.length ? items.map(i => `<div class="row"><span class="tag ${/official/i.test(i.source_type || '') ? 'yes' : 'partial'}">${esc(i.area || 'Update')}</span><div class="grow"><b>${esc(i.title)}</b> <span class="muted" style="font-size:12.5px">${esc(i.date || '')}</span><div style="font-size:13.5px">${esc(i.summary || '')}</div>${i.url && /^https?:\/\//.test(i.url) ? `<a href="${esc(i.url)}" target="_blank" rel="noopener" style="font-size:12.5px">${esc(i.url)}</a>` : ''}</div></div>`).join('') : `<div class="out">${esc(sc.text || 'Nothing new found.')}</div>`}
      ${(sc.sources || []).length ? `<div class="refs" style="margin-top:8px">${sc.sources.slice(0, 12).map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || 'source')} &#8599;</a>`).join('')}</div>` : ''}`;
  }
  async function webScan() {
    const btn = $('#webScan'), out = $('#webScanOut'), old = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Searching Google';
    const since = (store.get('cqc.webscan', null) || {}).at || KB.reviewed;
    const prompt = `Use Google Search to find changes published since ${new Date(since).toISOString().slice(0, 10)} (today is ${new Date().toISOString().slice(0, 10)}) in these areas:
1. Google Search ranking updates (core, spam, Discover) and new or changed Google Search spam policies or Search Central documentation.
2. Google Search features and AI Overviews / AI Mode guidance for site owners.
3. Google Ads, YouTube, Merchant Center, Google Business Profile, Google Play and AdSense policy changes that affect copywriting or content.
4. Bing Webmaster Guidelines changes.
5. Newly published Google patents or Google research papers about search ranking, quality or AI answers.
Prefer official sources (developers.google.com/search, status.search.google.com, support.google.com, blog.google, bing.com/webmasters, patents.google.com). Include an item only if it was published in that window. No speculation.
Reply ONLY with JSON: {"items":[{"title":"...","date":"YYYY-MM-DD","area":"Search|Ads|YouTube|Merchant|Business Profile|Play|AdSense|Bing|Patent","source_type":"official|industry","url":"https://...","summary":"one sentence, own words"}]}`;
    try {
      const res = await window.CQAI.call(prompt, { search: true, withSources: true, temperature: 0.2 });
      const j = window.CQAI.parseJSON(res.text) || {};
      const sc = { at: new Date().toISOString(), items: (j.items || []).slice(0, 25), sources: res.sources || [], text: j.items ? '' : res.text };
      store.set('cqc.webscan', sc); out.innerHTML = renderScan(sc);
      btn.nextElementSibling.textContent = 'Last scan ' + new Date(sc.at).toLocaleString();
    } catch (e) { out.innerHTML = `<p class="note warn">${esc(e.message)}</p>`; }
    btn.disabled = false; btn.innerHTML = old;
  }
  async function hash(s) { try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Array.from(new Uint8Array(b)).slice(0, 8).map(x => x.toString(16).padStart(2, '0')).join(''); } catch (e) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); } }
  async function fetchDoc() {
    const url = $('#docSel').value, out = $('#docOut'), btn = $('#docGo');
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Fetching';
    let data = null;
    try { const r = await fetch('/api/page?url=' + encodeURIComponent(url)); if (r.ok) data = await r.json(); } catch (e) { }
    if (!data) { try { const r = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(url)); if (r.ok) { const html = await r.text(); const d = new DOMParser().parseFromString(html, 'text/html'); const main = d.querySelector('article') || d.querySelector('main') || d.body; main.querySelectorAll('nav,script,style,aside,devsite-toc').forEach(n => n.remove()); data = { title: d.title, updated: ((html.match(/Last updated ([0-9-]+ UTC)/) || [])[1] || ''), text: main.innerText || main.textContent }; } } catch (e) { } }
    btn.disabled = false; btn.textContent = 'Fetch latest';
    if (!data || !data.text) { out.innerHTML = `<p class="note warn">This page could not be fetched from here${PREVIEW ? ' (preview mode blocks network calls; it works once you host Content QC)' : ''}. Use "Open original".</p>`; return; }
    const h = await hash(data.text.replace(/\s+/g, ' ')), key = 'cqc.doc.' + url, prev = store.get(key, null);
    store.set(key, { h, at: new Date().toISOString(), updated: data.updated });
    const changed = prev && prev.h !== h;
    out.innerHTML = `<div class="note ${changed ? 'warn' : ''}">${prev ? (changed ? `Changed since your last check on ${new Date(prev.at).toLocaleDateString()}.` : `No change since ${new Date(prev.at).toLocaleDateString()}.`) : 'First fetch saved; future fetches will tell you if it changes.'}${data.updated ? ' Google lists it as last updated ' + esc(data.updated) + '.' : ''}</div><div class="out" style="margin-top:10px;max-height:520px;overflow:auto">${esc(data.text.slice(0, 60000))}</div>`;
  }

  /* ------------------------------ Settings ------------------------------ */
  const HOUSE = {
    emDash: ['No em dashes', 'Flags every em dash.'],
    list46: ['Lists of 4 or 6 items', 'Web copy bullet lists must have 4 or 6 items.'],
    faq5: ['Exactly 5 FAQs', 'Blog, guest post and landing pages need exactly 5 PAA-style FAQs.'],
    noTables: ['Bullets instead of tables', 'Flags tables in written content.'],
    shortParas: ['Bite-size paragraphs', 'Flags paragraphs over 3 sentences or 70 words.'],
    prNoFaq: ['No FAQ in press releases', 'Digital PR releases have no FAQ section.'],
    prHeadings: ['PR section headings', 'Press releases use keyword-rich, time-relevant section headings.'],
    newsRules: ['SSF market news format', 'US Eastern Time, 3-bullet Summary, "What Should Traders Do Now?" with 4 bullets, no disclaimer or FAQ, plain words.'],
    cryptoTrading: ['Crypto = trading, not investing', 'Flags investing language in crypto content.'],
    proofread: ['Proofreading', 'Repeated words, spacing and punctuation slips.']
  };
  function renderSettings() {
    const v = $('#view-settings'), s = settings;
    v.innerHTML = `
      <div class="panel"><div class="panel-h"><div><h2>AI model (optional, free)</h2><div class="sub">Content QC's checks run locally with no model. A model adds second-opinion AI detection, rewrites in your voice, metadata, FAQs and a policy review.</div></div></div>
        <div class="panel-b">
          <div class="fields">
            <div class="field"><label for="s-prov">Provider</label><select class="input" id="s-prov">
              <option value="none">None: local engine only</option>
              <option value="gemini">Google Gemini (free key from AI Studio)</option>
              <option value="openai">OpenAI-compatible (OpenRouter free models, Groq, LM Studio)</option>
              <option value="server">Server proxy (key stored on Netlify or Render)</option></select></div>
            <div class="field" data-for="none gemini openai"><label for="s-key">Your API key</label><input class="input" id="s-key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your own key (starts with AIza for Gemini)"></div>
            <div class="field" data-for="openai"><label for="s-base">Base URL</label><input class="input" id="s-base"></div>
            <div class="field" data-for="server"><label for="s-code">Access code (if set on the server)</label><input class="input" id="s-code" type="password" autocomplete="off"></div>
            <div class="field" data-for="gemini openai server"><label for="s-model">Model <button class="btn sm" id="s-list" type="button" style="padding:2px 8px">List models</button></label><input class="input" id="s-model" list="s-models"><datalist id="s-models"></datalist></div>
          </div>
          <div data-for="none gemini openai" style="margin-top:12px">
            <label class="switch" style="border-top:0;padding-top:0"><input type="checkbox" id="s-remember"><span><b>Remember my key on this browser</b><small>Off: the key is kept only until you close this tab. On: it stays in this browser's storage until you click "Forget my key".</small></span></label>
            <p class="note" style="margin:6px 0 0"><b>Your key stays private.</b> Requests go straight from your browser to Google (generativelanguage.googleapis.com) or the endpoint you set. The Content QC server never receives, stores or logs your key, and other people using this site cannot see it: each person adds their own key in their own browser. <span id="s-keystate"></span></p>
            <div class="actions"><button class="btn sm" id="s-forget" type="button">Forget my key</button><a class="btn sm" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Get a free Gemini key &#8599;</a></div>
          </div>
          <p class="note" style="margin-top:12px">Free options: Gemini keys come from aistudio.google.com (free tier with daily limits). OpenRouter lists free models with ":free" in the name. "Server proxy" is only for a team key the site owner sets on Netlify or Render; it never uses your personal key.</p>
          <div class="actions"><button class="btn" id="s-test">Test connection</button><span class="muted" id="s-testout" style="font-size:13px"></span></div>
        </div></div>
      <div class="panel"><div class="panel-h"><div><h2>Detection and feeds</h2></div></div><div class="panel-b"><div class="fields">
        <div class="field"><label for="s-sens">AI detector sensitivity</label><select class="input" id="s-sens"><option value="lenient">Lenient (fewer flags)</option><option value="balanced">Balanced</option><option value="strict">Strict (like GPTZero on formal text)</option></select></div>
        <div class="field"><label for="s-feed">Google Pulse source</label><select class="input" id="s-feed"><option value="auto">Auto: own server, then public proxies</option><option value="server">Own server only (/api/feeds)</option><option value="proxy">Public proxies only (GitHub Pages)</option></select></div>
        <div class="field"><label for="s-dom">Default site domain</label><input class="input" id="s-dom"></div>
        <div class="field"><label for="s-auth">Default author</label><input class="input" id="s-auth"></div>
      </div></div></div>
      <div class="panel"><div class="panel-h"><div><h2>Rule set</h2><div class="sub">Google and Bing rules always run. House style adds Doin Tech's own writing rules and the voice match on top.</div></div></div><div class="panel-b">
        <label class="switch" style="border-top:0"><input type="checkbox" id="s-houseOn" ${s.houseOn !== false ? 'checked' : ''}><span><b>Apply Doin Tech house style</b><small>Turn off for search-engine standards only (good for other teams, agencies and clients).</small></span></label>
        <div id="houseRules" ${s.houseOn === false ? 'hidden' : ''}>
        ${Object.entries(HOUSE).map(([k, [t, d]]) => `<label class="switch"><input type="checkbox" id="h-${k}" ${s.house[k] ? 'checked' : ''}><span><b>${esc(t)}</b><small>${esc(d)}</small></span></label>`).join('')}
        </div>
      </div></div>
      <div class="panel"><div class="panel-h"><div><h2>Data</h2><div class="sub">Settings, drafts, history and feed cache live in this browser only.</div></div></div><div class="panel-b"><div class="actions" style="margin-top:0"><button class="btn" id="s-clearcache">Clear feed cache</button><button class="btn" id="s-reset">Reset settings</button></div></div></div>`;
    $('#s-remember').checked = !!s.rememberKey;
    const keyState = () => { const k = settings.apiKey; $('#s-keystate').textContent = k ? `Key saved ${settings.rememberKey ? 'on this browser' : 'for this tab only'} (ending ${k.slice(-4)}).` : 'No key saved.'; };
    $('#s-prov').value = s.provider; $('#s-key').value = s.apiKey; $('#s-base').value = s.baseUrl; $('#s-code').value = s.accessCode; $('#s-model').value = s.model;
    $('#s-sens').value = s.sensitivity; $('#s-feed').value = s.feedMode; $('#s-dom').value = s.domain; $('#s-auth').value = s.author;
    const showFor = () => $$('[data-for]', v).forEach(el => el.hidden = !el.dataset.for.split(' ').includes($('#s-prov').value));
    showFor();
    const save = () => {
      const n = Object.assign({}, settings, { houseOn: $('#s-houseOn').checked, rememberKey: $('#s-remember').checked, provider: $('#s-prov').value, apiKey: $('#s-key').value.trim(), baseUrl: $('#s-base').value.trim(), accessCode: $('#s-code').value, model: $('#s-model').value.trim(), sensitivity: $('#s-sens').value, feedMode: $('#s-feed').value, domain: $('#s-dom').value.trim(), author: $('#s-auth').value.trim(), house: {} });
      Object.keys(HOUSE).forEach(k => n.house[k] = $('#h-' + k).checked);
      if (n.apiKey && n.provider === 'none') { n.provider = /^AIza/.test(n.apiKey) ? 'gemini' : 'openai'; $('#s-prov').value = n.provider; showFor(); }
      $('#houseRules').hidden = !n.houseOn;
      window.CQSettings.save(n); keyState(); toast('Settings saved');
    };
    keyState();
    $('#s-forget').addEventListener('click', () => { $('#s-key').value = ''; $('#s-remember').checked = false; const n = Object.assign({}, settings, { apiKey: '', rememberKey: false }); if (n.provider === 'gemini' || n.provider === 'openai') n.provider = 'none'; window.CQSettings.save(n); renderSettings(); toast('Key removed from this browser'); });
    $$('input,select', v).forEach(el => el.addEventListener('change', () => { if (el.id === 's-prov') { const p = el.value; if (p === 'gemini' && !/gemini/.test($('#s-model').value)) $('#s-model').value = 'gemini-2.5-flash'; if (p === 'openai' && /gemini/.test($('#s-model').value)) $('#s-model').value = 'meta-llama/llama-3.3-70b-instruct:free'; showFor(); } save(); }));
    $('#s-list').addEventListener('click', async () => { save(); try { const ms = await window.CQAI.listModels(); $('#s-models').innerHTML = ms.map(m => `<option value="${esc(m)}">`).join(''); toast(ms.length + ' models found; pick one in the Model box'); } catch (e) { toast(e.message); } });
    $('#s-test').addEventListener('click', async () => { save(); $('#s-testout').textContent = 'Testing...'; try { const t = await window.CQAI.call('Reply with exactly: Content QC connected'); $('#s-testout').textContent = 'Model replied: ' + t.trim().slice(0, 80); } catch (e) { $('#s-testout').textContent = e.message; } });
    $('#s-clearcache').addEventListener('click', () => { store.del('cqc.feeds.v1'); toast('Feed cache cleared'); loadFeeds(true); });
    $('#s-reset').addEventListener('click', () => { window.CQSettings.save(Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), { apiKey: '', accessCode: '', rememberKey: false })); renderSettings(); toast('Settings reset'); });
  }

  /* ------------------------------ boot ------------------------------ */
  $('#kbDate').textContent = new Date(KB.reviewed).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  // Start clean. Only restore the user's own unfinished draft, never the sample article
  // (older versions could have saved the sample as a draft, so it is detected and dropped).
  const draft = store.get('cqc.draft', null);
  const plain = h => { const d = document.createElement('div'); d.innerHTML = String(h || '').replace(/<\/(p|h\d|li)>/g, ' $&'); return d.textContent.replace(/\s+/g, ' '); };
  const isSample = h => { const t = plain(h); const ss = window.CQ.splitSentences(plain(window.CQ.mdToHTML(SAMPLE))).filter(x => x.length > 40); return ss.length > 0 && ss.filter(x => t.includes(x.trim())).length / ss.length > 0.5; };
  if (draft && draft.html && window.CQ.wordsOf(draft.html.replace(/<[^>]+>/g, ' ')).length > 10 && !isSample(draft.html)) { ed.innerHTML = draft.html; writeFields(draft.fields || {}); }
  else { ed.innerHTML = ''; if (draft) store.del('cqc.draft'); }
  if (!$('#f-dom').value) $('#f-dom').value = settings.domain;
  if (!$('#f-auth').value) $('#f-auth').value = settings.author;
  syncPlaceholder(); renderRoles(); counters(); updateWC(); renderHistory();
  go((location.hash || '#check').slice(1), false);
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS.includes(v) && $('#view-' + v).hidden) go(v, false); });
  loadFeeds(false);
})();
