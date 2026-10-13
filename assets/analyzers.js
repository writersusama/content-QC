/* =========================================================================
   Content QC analysis engine
   Parses pasted content (HTML from Google Docs/Word, Markdown or plain text)
   into a document model, runs every check, and returns a scored report.
   Every finding carries: category, severity, title, reason, fix, refs[].
   ========================================================================= */
(function () {
  const KB = window.KB;
  const L = KB.lists;
  const U = KB.U;
  const ref = KB.ref;
  const STOP = new Set(L.stop);
  const YEAR = new Date().getFullYear();

  /* ------------------------------ utilities ------------------------------ */
  const an = w => (/^[aeiou]/i.test(w) && !/^(one|uni|use)/i.test(w) ? 'an ' : 'a ') + w;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/ /g, ' ');
  const lc = s => norm(s).toLowerCase();
  const wordsOf = s => (lc(s).match(/[a-z0-9][a-z0-9'\/&.-]*[a-z0-9]|[a-z0-9]/g) || []).map(w => w.replace(/[.]+$/, ''));
  const contentWords = s => wordsOf(s).filter(w => !STOP.has(w) && w.length > 2 && !/^\d+$/.test(w));
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
  const cv = a => { const m = mean(a); return m ? sd(a) / m : 0; };
  const trimWords = (s, n) => { const w = String(s).split(/\s+/); return w.length <= n ? s : w.slice(0, n).join(' ') + '...'; };
  const titleCase = s => String(s).replace(/\w\S*/g, (w, i) => (i > 0 && /^(a|an|and|as|at|but|by|for|in|of|on|or|the|to|vs|with)$/i.test(w)) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1));
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function countPhrase(text, phrase) {
    if (!phrase) return 0;
    const re = new RegExp('(^|[^a-z0-9])' + reEsc(lc(phrase)) + '(?=$|[^a-z0-9])', 'g');
    return (lc(text).match(re) || []).length;
  }
  function hitList(text, list) {
    const t = ' ' + lc(text) + ' ';
    const hits = [];
    for (const p of list) {
      const re = new RegExp('(^|[^a-z0-9])' + reEsc(p.toLowerCase()) + '(?=$|[^a-z0-9])', 'g');
      const m = t.match(re);
      if (m) hits.push({ phrase: p, count: m.length });
    }
    return hits;
  }
  function syllables(w) {
    w = w.toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 0;
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    const m = w.match(/[aeiouy]{1,2}/g);
    return Math.max(1, m ? m.length : 1);
  }
  function splitSentences(text) {
    const t = norm(text).replace(/\s+/g, ' ').trim();
    if (!t) return [];
    const protectedT = t
      .replace(/\b(e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Inc|Ltd|Co|St|U\.S|U\.K|No|approx|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\./g, '$1\u0001')
      .replace(/(\d)\.(\d)/g, '$1\u0001$2');
    return protectedT.split(/(?<=[.!?])\s+(?=["'(\[]?[A-Z0-9])/).map(s => s.replace(/\u0001/g, '.').trim()).filter(s => s.length > 1);
  }

  /* ------------------------------ parsing ------------------------------ */
  // Markdown or plain text -> HTML (headings, lists, bold, links, tables, quotes)
  function mdToHTML(md) {
    const lines = norm(md).replace(/\r/g, '').split('\n');
    const out = [];
    let list = null, para = [], table = null;
    const inline = s => esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, '$1<em>$2</em>')
      .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '<img alt="$1" src="$2">')
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '<a href="$2">$1</a>');
    const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
    const flushList = () => { if (list) { out.push('<' + list.tag + '>' + list.items.map(i => '<li>' + inline(i) + '</li>').join('') + '</' + list.tag + '>'); list = null; } };
    const flushTable = () => { if (table) { out.push('<table>' + table.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</table>'); table = null; } };
    for (let raw of lines) {
      const line = raw.trimEnd();
      if (/^\s*\|.*\|\s*$/.test(line)) {
        flushPara(); flushList();
        if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
        table = table || [];
        table.push(line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
        continue;
      } else flushTable();
      let m;
      if (!line.trim()) { flushPara(); flushList(); continue; }
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { flushPara(); flushList(); out.push(`<h${m[1].length}>${inline(m[2].replace(/#+\s*$/, ''))}</h${m[1].length}>`); continue; }
      if ((m = line.match(/^\s*[-*+•]\s+(.*)$/))) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); continue; }
      if ((m = line.match(/^>\s?(.*)$/))) { flushPara(); flushList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
      flushList();
      para.push(line.trim());
      // plain text: a single line followed by blank line is its own paragraph
    }
    flushPara(); flushList(); flushTable();
    return out.join('\n');
  }
  // Plain text with no markdown: treat short title-like lines as headings
  function plainToHTML(txt) {
    const blocks = norm(txt).replace(/\r/g, '').split(/\n\s*\n|\n(?=\S)/).map(b => b.trim()).filter(Boolean);
    let first = true;
    return blocks.map(b => {
      const single = !/\n/.test(b);
      const looksHeading = single && b.length < 110 && !/[.:;,]$/.test(b) && /^[A-Z0-9"']/.test(b) && b.split(/\s+/).length <= 16;
      if (looksHeading) { const tag = first ? 'h1' : (/\?$/.test(b) ? 'h2' : 'h2'); first = false; return `<${tag}>${esc(b)}</${tag}>`; }
      first = false;
      if (/^[-*•]\s/.test(b)) return '<ul>' + b.split('\n').map(l => '<li>' + esc(l.replace(/^[-*•]\s*/, '')) + '</li>').join('') + '</ul>';
      return '<p>' + esc(b.replace(/\n/g, ' ')) + '</p>';
    }).join('\n');
  }
  function toHTML(input) {
    const s = String(input || '');
    if (/<\s*(p|h[1-6]|ul|ol|li|div|table|br|strong|a)\b/i.test(s)) return s;
    if (/^\s{0,3}#{1,6}\s|^\s*[-*]\s|\*\*.+\*\*|\[.+\]\(.+\)/m.test(s)) return mdToHTML(s);
    return plainToHTML(s);
  }

  function buildModel(html) {
    const doc = new DOMParser().parseFromString('<div id="root">' + html + '</div>', 'text/html');
    const root = doc.getElementById('root');
    // Remove scripts/styles, unwrap Google Docs wrapper spans
    root.querySelectorAll('script,style,meta,link,noscript').forEach(n => n.remove());
    const blocks = [];
    const links = [];
    const images = [];
    let boldCount = 0, hiddenCount = 0, tableCount = 0;

    const hiddenStyle = el => {
      const st = (el.getAttribute && el.getAttribute('style') || '').toLowerCase();
      return /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(px|pt|em)?\s*(;|$)|opacity\s*:\s*0(\.0+)?\s*(;|$)|text-indent\s*:\s*-\d{3,}/.test(st);
    };
    const isBold = el => /^(STRONG|B)$/.test(el.tagName) || /font-weight\s*:\s*(700|bold|[6-9]00)/i.test(el.getAttribute('style') || '');
    const BLOCK = /^(P|DIV|H[1-6]|UL|OL|LI|TABLE|BLOCKQUOTE|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|FIGURE|PRE|TR|TD|TH|TBODY|THEAD)$/;

    function inlineStats(el) {
      el.querySelectorAll('a[href]').forEach(a => links.push({ href: a.getAttribute('href') || '', text: norm(a.textContent).trim(), rel: (a.getAttribute('rel') || '').toLowerCase(), block: blocks.length }));
      el.querySelectorAll('img').forEach(i => images.push({ alt: i.getAttribute('alt') || '', src: i.getAttribute('src') || '' }));
      el.querySelectorAll('*').forEach(n => { if (isBold(n) && norm(n.textContent).trim().length > 1) boldCount++; if (hiddenStyle(n)) hiddenCount++; });
    }
    function textOf(el) { return norm(el.textContent).replace(/\s+/g, ' ').trim(); }
    function walk(el) {
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === 3) {
          const t = norm(node.textContent).replace(/\s+/g, ' ').trim();
          if (t) blocks.push({ type: 'p', text: t });
          continue;
        }
        if (node.nodeType !== 1) continue;
        const tag = node.tagName;
        if (hiddenStyle(node)) { hiddenCount++; }
        if (/^H[1-6]$/.test(tag)) { const t = textOf(node); if (t) { inlineStats(node); blocks.push({ type: 'h', level: +tag[1], text: t }); } continue; }
        if (tag === 'UL' || tag === 'OL') {
          const items = Array.from(node.children).filter(c => c.tagName === 'LI').map(li => { inlineStats(li); return textOf(li); }).filter(Boolean);
          if (items.length) blocks.push({ type: 'list', ordered: tag === 'OL', items, text: items.join(' ') });
          continue;
        }
        if (tag === 'TABLE') {
          tableCount++;
          inlineStats(node);
          const rows = Array.from(node.querySelectorAll('tr')).map(r => Array.from(r.children).map(textOf));
          blocks.push({ type: 'table', rows, text: rows.map(r => r.join(' | ')).join(' . ') });
          continue;
        }
        if (tag === 'BLOCKQUOTE') { inlineStats(node); const t = textOf(node); if (t) blocks.push({ type: 'quote', text: t }); continue; }
        if (tag === 'IMG') { images.push({ alt: node.getAttribute('alt') || '', src: node.getAttribute('src') || '' }); continue; }
        if (tag === 'HR' || tag === 'BR') continue;
        const hasBlockChild = Array.from(node.children).some(c => BLOCK.test(c.tagName) || c.tagName === 'IMG' && false);
        if (hasBlockChild) { walk(node); continue; }
        // Paragraph-level element
        const t = textOf(node);
        if (!t) { node.querySelectorAll && node.querySelectorAll('img').forEach(i => images.push({ alt: i.getAttribute('alt') || '', src: i.getAttribute('src') || '' })); continue; }
        inlineStats(node);
        // A paragraph that is entirely bold and short behaves like a heading (Google Docs / FAQ style)
        const allBold = node.querySelector && node.querySelector('strong,b') && textOf(node.querySelector('strong,b')) === t;
        blocks.push({ type: 'p', text: t, boldOnly: !!allBold });
      }
    }
    walk(root);

    // Text helpers
    const prose = blocks.filter(b => b.type === 'p' || b.type === 'quote' || b.type === 'list');
    const allText = blocks.map(b => b.text).join('\n');
    const bodyText = blocks.filter(b => b.type !== 'h').map(b => b.text).join('\n');
    const paragraphs = blocks.filter(b => b.type === 'p' && !b.boldOnly);
    const sentences = [];
    blocks.forEach((b, bi) => {
      if (b.type === 'p' || b.type === 'quote') splitSentences(b.text).forEach(s => sentences.push({ text: s, block: bi }));
      else if (b.type === 'list') b.items.forEach(it => splitSentences(it).forEach(s => sentences.push({ text: s, block: bi, list: true })));
    });
    const words = wordsOf(bodyText);

    // Sections by H2
    const sections = [];
    let cur = { heading: null, level: 1, blocks: [], start: 0 };
    blocks.forEach((b, i) => {
      if (b.type === 'h' && b.level <= 2) { sections.push(cur); cur = { heading: b.text, level: b.level, blocks: [], start: i }; }
      else cur.blocks.push(Object.assign({ index: i }, b));
    });
    sections.push(cur);

    return { html, blocks, links, images, boldCount, hiddenCount, tableCount, prose, paragraphs, sentences, words, allText, bodyText, sections: sections.filter(s => s.heading || s.blocks.length) };
  }

  /* ------------------------------ findings ------------------------------ */
  const CATS = {
    policy: { label: 'Search engine policy (Google + Bing)', weight: 1.6 },
    seo: { label: 'SEO & structure', weight: 1.2 },
    serp: { label: 'SERP dominance', weight: 0.9 },
    aeo: { label: 'AEO (answer engines)', weight: 1.0 },
    aio: { label: 'AIO / AI Overviews', weight: 1.0 },
    llm: { label: 'LLM-readiness', weight: 0.9 },
    eeat: { label: 'E-E-A-T & trust', weight: 1.4 },
    orig: { label: 'Originality & spin', weight: 1.2 },
    ai: { label: 'AI-content signals', weight: 0.9 },
    style: { label: 'Voice & house style', weight: 0.8 },
    tech: { label: 'Technical SEO (page source)', weight: 1.1 },
    fit: { label: 'Domain fit', weight: 1.1 }
  };
  const PENALTY = { critical: 24, warning: 9, info: 3, pass: 0 };

  function analyze(input) {
    const opts = Object.assign({ type: 'blog', keyword: '', secondary: '', metaTitle: '', metaDesc: '', domain: '', author: '', slug: '', house: {}, sensitivity: 'balanced' }, input);
    const houseOn = !opts.house || opts.house.enabled !== false;
    const house = houseOn ? Object.assign({ emDash: true, list46: true, faq5: true, noTables: true, shortParas: true, prNoFaq: true, prHeadings: true, newsRules: true, cryptoTrading: true, proofread: true }, opts.house) : { enabled: false };
    const key = KB.typeRules[opts.type] ? opts.type : 'blog';
    const T = KB.typeRules[key];
    const type = T.fam;
    const longForm = ['blog', 'review', 'guest', 'landing', 'news', 'pr'].includes(type);
    let rawInput = String(opts.html || opts.text || '');
    const srcHTML = String(opts.sourceHtml || '');
    if (srcHTML && !window.CQ.wordsOf(rawInput.replace(/<[^>]+>/g, ' ')).length) {
      const d = new DOMParser().parseFromString(srcHTML, 'text/html');
      d.querySelectorAll('script,style,nav,footer,header,aside,form,noscript,iframe,svg').forEach(n => n.remove());
      rawInput = ((d.querySelector('article') || d.querySelector('main') || d.body || {}).innerHTML) || '';
    }
    if (type === 'meta' && !opts.metaTitle && !opts.metaDesc) {
      const lines = norm(rawInput.replace(/<\/(p|h\d|li|div)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).split(/\n+/).map(x => x.trim()).filter(Boolean);
      opts.metaTitle = (lines[0] || '').replace(/^(title( tag)?|seo title)\s*:\s*/i, '');
      opts.metaDesc = (lines[1] || '').replace(/^(meta( description)?|description)\s*:\s*/i, '');
    }
    const APPLIES = { listing: ['policy', 'seo', 'eeat', 'llm', 'ai', 'orig', 'style'], ad: ['policy', 'eeat', 'orig', 'style', 'llm'], meta: ['policy', 'seo', 'style'], email: ['policy', 'serp', 'eeat', 'llm', 'ai', 'orig', 'style'], social: ['policy', 'seo', 'serp', 'eeat', 'llm', 'ai', 'orig', 'style'] };
    const applies = c => c === 'fit' ? !!opts.siteProfile : c === 'tech' ? !!srcHTML : (!APPLIES[type] || APPLIES[type].includes(c));
    const shortCopy = ['ad', 'social', 'email', 'listing'].includes(type) && !/<\s*(p|h[1-6]|ul|ol|li|div|table|br)\b/i.test(rawInput);
    const lineHTML = t => norm(t).replace(/\r/g, '').split(/\n/).map(l => l.trim()).filter(Boolean).map(l => /^\s*[-*\u2022]\s/.test(l) ? '<ul><li>' + esc(l.replace(/^\s*[-*\u2022]\s*/, '')) + '</li></ul>' : '<p>' + esc(l) + '</p>').join('');
    const m = buildModel(type === 'meta' ? '' : shortCopy ? lineHTML(rawInput) : toHTML(rawInput));
    const findings = [];
    const add = (cat, sev, title, reason, fix, refs = [], extra = {}) => findings.push(Object.assign({ cat, sev, title, reason, fix, refs }, extra));
    const P = id => KB.policies.find(p => p.id === id);
    const pref = id => { const p = P(id); return p ? [ref(p.title, p.url)].concat(p.also || []) : []; };

    const wc = m.words.length;
    const headings = m.blocks.filter(b => b.type === 'h');
    const h1s = headings.filter(h => h.level === 1);
    const h2s = headings.filter(h => h.level === 2);
    const title = opts.metaTitle || (h1s[0] && h1s[0].text) || '';
    const isFinance = /forex|trading|trade|crypto|bitcoin|gold|stock|indices|index|invest|broker|signal|pip|profit|leverage|fintech|loan|bank|finance|money/i.test(m.allText);
    const metrics = { words: wc, sentences: m.sentences.length, paragraphs: m.paragraphs.length, headings: headings.length, h2: h2s.length, links: m.links.length, images: m.images.length, readMin: Math.max(1, Math.round(wc / 230)) };

    if (wc === 0 && !wordsOf(m.allText).length && type !== 'meta') return brief(opts, key, T, metrics, m);

    /* ---------- keyword resolution ---------- */
    let kw = lc(opts.keyword).trim();
    let kwInferred = false;
    if (!kw) {
      const grams = {};
      const tw = contentWords(title + ' ' + headings.map(h => h.text).join(' ') + ' ' + m.bodyText);
      for (let i = 0; i < tw.length - 1; i++) { const g = tw[i] + ' ' + tw[i + 1]; grams[g] = (grams[g] || 0) + 1; }
      const top = Object.entries(grams).sort((a, b) => b[1] - a[1])[0];
      kw = top && top[1] >= 3 ? top[0] : (contentWords(title)[0] || '');
      kwInferred = true;
    }
    const kwTokens = contentWords(kw);
    const secondary = String(opts.secondary || '').split(/[,;\n]/).map(s => lc(s).trim()).filter(Boolean);
    const kwCount = countPhrase(m.bodyText + '\n' + headings.map(h => h.text).join('\n'), kw);
    const kwDensity = wc ? (kwCount * Math.max(1, kw.split(/\s+/).length) / wc) * 100 : 0;
    metrics.keyword = kw; metrics.keywordCount = kwCount; metrics.keywordDensity = +kwDensity.toFixed(2); metrics.keywordInferred = kwInferred;

    /* ---------- niche / topical map ---------- */
    const lcAll = lc(m.allText + ' ' + kw);
    let niche = 'generic', nicheHits = 0;
    for (const [k, tm] of Object.entries(KB.topicalMaps)) {
      const h = tm.triggers.reduce((s, t) => s + countPhrase(lcAll, t), 0);
      if (h > nicheHits) { nicheHits = h; niche = k; }
    }
    const TM = KB.topicalMaps[niche];
    metrics.niche = TM.label;

    /* =================== 1. GOOGLE POLICY COMPLIANCE =================== */
    // Keyword stuffing
    if (kw && kwDensity > 3.2 && (wc >= 250 || kwCount >= 6)) add('policy', kwDensity > 4.5 ? 'critical' : 'warning', 'Keyword density looks unnatural',
      `"${kw}" appears ${kwCount} times (${kwDensity.toFixed(1)}% of words). Repeating a phrase this often is the textbook example of keyword stuffing in Google's spam policies, and it makes copy read robotic.`,
      'Keep the exact phrase to the title, H1, first 100 words, one or two H2s and a few natural mentions. Replace the rest with pronouns, synonyms or related terms (Google\'s BERT and neural matching understand them).', pref('stuffing'));
    const hKw = headings.filter(h => kw && countPhrase(h.text, kw) > 0).length;
    if (headings.length >= 5 && kw && hKw / headings.length > 0.6) add('policy', 'warning', 'Exact keyword repeated in most headings',
      `${hKw} of ${headings.length} headings repeat "${kw}". Headings written for the keyword instead of the reader look search-engine-first.`,
      'Keep the keyword in the H1 and one or two H2s. Rewrite the others around the reader\'s question for that section.', pref('stuffing').concat(pref('helpful')));
    // Repeated phrase stuffing (any 3-gram)
    const tri = {}; const bw = m.words;
    for (let i = 0; i < bw.length - 2; i++) { const g = bw.slice(i, i + 3); if (g.filter(w => !STOP.has(w)).length < 2) continue; const k = g.join(' '); tri[k] = (tri[k] || 0) + 1; }
    const stuffedTri = Object.entries(tri).filter(([g, c]) => c >= Math.max(6, wc / 160) && g !== kw).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (stuffedTri.length) add('policy', 'warning', 'Repeated phrases may read as stuffing',
      `These phrases repeat unusually often: ${stuffedTri.map(([g, c]) => `"${g}" (${c}x)`).join(', ')}.`, 'Vary the wording or cut repeats that add nothing new.', pref('stuffing'));

    // Guaranteed returns / misleading claims (YMYL)
    const guar = hitList(m.allText, L.guaranteed);
    if (guar.length) add('policy', 'critical', 'Guaranteed-return or no-risk language',
      `Found: ${guar.map(g => `"${g.phrase}"`).join(', ')}. Finance content is YMYL. Raters treat promises of guaranteed profit or zero risk as misleading and potentially harmful, which destroys trust and can trigger low quality ratings. It also conflicts with ad and regulator rules (FCA, CFTC, ESMA) on financial promotions.`,
      'Remove absolute promises. Use attributed, verifiable statements such as "a 68% win rate over 412 trades from Jan to Jun 2026 (verified on Myfxbook)" plus a risk reminder.', pref('ymyl').concat(pref('misleading')), { locate: guar.map(g => g.phrase) });
    // Clickbait
    const cb = hitList(title + ' ' + headings.map(h => h.text).join(' '), L.clickbait);
    if (cb.length || /[A-Z]{6,}/.test(title.replace(/\b(FOMC|NASDAQ|CFTC|ESMA|USD|EUR|GBP|JPY|XAU|BTC|ETH|AUD|CAD|CHF|NZD)\b/g, ''))) add('policy', 'warning', 'Sensational or clickbait wording in title or headings',
      `Google's Discover and title guidance discourage exaggerated, shocking or bait-style hooks${cb.length ? ': ' + cb.map(c => `"${c.phrase}"`).join(', ') : ' (all-caps words found)'}.`, 'State the real benefit plainly. Curiosity is fine; withholding the key fact or exaggerating is not.', pref('discover').concat(pref('titles')));
    // Hidden text
    if (m.hiddenCount) add('policy', 'critical', 'Hidden text detected in pasted HTML',
      `${m.hiddenCount} element(s) use styles like display:none, zero font size or zero opacity. Text hidden only for search engines violates the hidden text policy.`, 'Remove hidden text, or make sure it is a genuine UI pattern (accordion, tab) that users can open.', pref('hidden'));
    // Link spam patterns
    const host = (opts.domain || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
    const linkHost = h => { try { return new URL(h, 'https://' + (host || 'example.com')).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } };
    const isInternal = l => !/^https?:/i.test(l.href) ? !/^(mailto:|tel:|#)/i.test(l.href) : (host && linkHost(l.href) === host);
    const internal = m.links.filter(isInternal);
    const external = m.links.filter(l => /^https?:/i.test(l.href) && !isInternal(l));
    const kwAnchors = m.links.filter(l => kw && (lc(l.text) === kw || (secondary.includes(lc(l.text))) || (kwTokens.length && contentWords(l.text).length >= 2 && kwTokens.every(t => lc(l.text).includes(t)))));
    metrics.internalLinks = internal.length; metrics.externalLinks = external.length;
    if (type === 'pr' || type === 'guest') {
      const toTarget = host ? m.links.filter(l => linkHost(l.href) === host) : m.links;
      const exactTo = toTarget.filter(l => kwAnchors.includes(l));
      if (exactTo.length) add('policy', 'critical', `Keyword-rich anchor links in ${an(T.short)}`,
        `Anchor(s) ${exactTo.slice(0, 4).map(l => `"${l.text}"`).join(', ')} match your target keywords. Google's link spam policy names "links with optimized anchor text in articles, guest posts, or press releases distributed on other sites" as a violation.`,
        'Use branded or naked-URL anchors ("SureShotFX", "sureshotfx.com") or a descriptive non-commercial phrase, and ask the publisher or wire service to add rel="sponsored" or rel="nofollow".', pref('linkspam'), { locate: exactTo.map(l => l.text) });
      if (toTarget.length > 3) add('policy', 'warning', 'Many links pointing to the promoted site',
        `${toTarget.length} links point to ${host || 'the promoted site'}. Large numbers of promotional links in syndicated content look like a link scheme.`, 'Keep it to 1 to 3 useful links, ideally branded, and qualify them.', pref('linkspam').concat(pref('qualify')));
      const unqualified = m.links.filter(l => /^https?:/i.test(l.href) && !/sponsored|nofollow/.test(l.rel));
      if (unqualified.length && /<a\s/i.test(m.html)) add('policy', 'info', 'Outbound links are not qualified',
        `${unqualified.length} link(s) have no rel="sponsored" or rel="nofollow". If this ${type === 'pr' ? 'release is distributed through a paid wire' : 'guest post is paid or part of a link exchange'}, those links must be qualified.`, 'Add rel="sponsored" (paid placements) or rel="nofollow". Most wire services add nofollow automatically: confirm with the distributor.', pref('qualify'));
      add('policy', 'info', type === 'pr' ? 'Press release distribution and site reputation' : 'Guest post and site reputation policy',
        type === 'pr' ? 'Wire and press release services are explicitly listed as not inconsistent with the site reputation policy, but the same release republished verbatim on many low-quality sites to rank or pass links is still treated as a link scheme.'
          : 'Since the Aug 2026 update, reviewers check whether third-party content matches the host\'s design and quality, has clear authorship and is not duplicated across many sites.',
        type === 'pr' ? 'Distribute through reputable newswires, keep links branded, and publish a canonical version on your own newsroom page.' : 'Write a unique piece for each host, under a real author byline, matched to the host\'s audience. Do not reuse the same article across sites.', pref('siterep'));
    }
    if (m.links.length && wc / m.links.length < 45 && m.links.length > 6) add('policy', 'warning', 'Very high link density',
      `${m.links.length} links in ${wc} words (one every ${Math.round(wc / m.links.length)} words). Pages stuffed with links look like link schemes and distract readers.`, 'Keep links that help the reader; aim for roughly one every 100 to 150 words.', pref('linkspam').concat(pref('links')));
    // Thin affiliation
    const affLinks = m.links.filter(l => L.affiliate.some(a => lc(l.href).includes(a)));
    if (affLinks.length) {
      const exp = hitList(m.allText, L.experience).length;
      add('policy', exp ? 'info' : 'warning', 'Affiliate links present',
        `${affLinks.length} link(s) look like affiliate or tracked links. Affiliate pages are fine when they add original value; copied merchant descriptions are "thin affiliation".${exp ? '' : ' No first-hand testing signals were found.'}`,
        'Add original testing, pricing context, comparisons and pros and cons. Disclose the affiliate relationship and qualify the links with rel="sponsored".', pref('thinaff').concat(pref('qualify')));
    }
    // AI / scaled content note is added later after AI score

    /* =================== 2. SEO & STRUCTURE =================== */
    if (longForm && !h1s.length) add('seo', opts.metaTitle ? 'info' : 'warning', 'No H1 heading found',
      'The H1 is the visible headline. Google uses it (along with the title tag) to understand the page and to build the title link.', 'Add one H1 that states the topic and includes the focus keyword naturally.', pref('titles'));
    if (longForm && h1s.length > 1) add('seo', 'warning', `${h1s.length} H1 headings`,
      'Multiple H1s blur what the main topic is and usually come from styling mistakes in the editor.', 'Keep one H1; turn the others into H2s.', pref('titles'), { locate: h1s.slice(1).map(h => h.text) });
    let prevLevel = 0; const skips = [];
    headings.forEach(h => { if (prevLevel && h.level > prevLevel + 1) skips.push(`H${prevLevel} → H${h.level}: "${trimWords(h.text, 8)}"`); prevLevel = h.level; });
    if (longForm && skips.length) add('seo', 'warning', 'Heading levels skip',
      `The outline jumps levels (${skips.slice(0, 3).join('; ')}). A clean hierarchy helps readers, screen readers and passage ranking understand how sections relate.`, 'Go H1 → H2 → H3 in order. Do not use heading tags just for font size.', [ref('SEO Starter Guide: headings', U.starter)]);
    const dupH = {}; headings.forEach(h => { const k = lc(h.text).replace(/[^a-z0-9 ]/g, ''); if (!/^(pros|cons|best for|why choose it|faqs?|summary)$/.test(k)) dupH[k] = (dupH[k] || 0) + 1; });
    const dupList = Object.entries(dupH).filter(([, c]) => c > 1).map(([k]) => k);
    if (dupList.length) add('seo', 'warning', 'Duplicate headings', `Repeated headings: ${dupList.slice(0, 3).map(d => `"${d}"`).join(', ')}.`, 'Make every heading unique and specific to its section.', [ref('SEO Starter Guide', U.starter)]);
    const longH = headings.filter(h => h.text.length > 75);
    if (longH.length) add('seo', 'info', 'Very long headings', `${longH.length} heading(s) exceed 75 characters, e.g. "${trimWords(longH[0].text, 12)}".`, 'Trim headings to one clear idea (under ~70 characters).', [ref('SEO Starter Guide', U.starter)]);
    if (wc > 600 && h2s.length && wc / h2s.length > 450) add('seo', 'info', 'Long sections between H2s', `About ${Math.round(wc / h2s.length)} words per H2 section on average.`, 'Add an H2 or H3 roughly every 200 to 350 words so readers and passage ranking can find answers.', [ref('Ranking systems: passage ranking', U.rankingGuide)]);
    if (T.minWords && wc < T.minWords && type !== 'meta') add(longForm ? 'seo' : 'style', longForm ? 'warning' : 'info', `Short for ${an(T.short)}`,
      `${wc} words. Google has no word count rule, but ${T.short}s that rank usually need about ${T.idealWords[0]}-${T.idealWords[1]} words to cover the topic fully.`, 'Cover the missing sub-questions listed under AEO and AIO rather than padding.', pref('helpful'));
    // Keyword placement
    if (kw && !kwInferred && wc) {
      const first100 = m.words.slice(0, 110).join(' ');
      if (h1s.length && !countPhrase(h1s[0].text, kw) && !kwTokens.every(t => lc(h1s[0].text).includes(t))) add('seo', 'warning', 'Focus keyword missing from H1', `The H1 "${trimWords(h1s[0].text, 12)}" does not contain "${kw}".`, 'Work the keyword (or a close variant) into the H1 naturally.', pref('titles'));
      if (!countPhrase(first100, kw) && !kwTokens.every(t => first100.includes(t))) add('seo', 'warning', 'Focus keyword not in the first 100 words', 'The intro does not confirm the topic early, which weakens relevance and AI Overview passage matching.', `Mention "${kw}" in the first two sentences, ideally inside the quick answer.`, [ref('SEO Starter Guide', U.starter)]);
      if (h2s.length >= 2 && !h2s.some(h => kwTokens.every(t => lc(h.text).includes(t)))) add('seo', 'info', 'Focus keyword not in any H2', 'At least one subheading usually reinforces the main topic.', `Use "${kw}" (or a variant) in one H2, e.g. "What Is ${titleCase(kw)}?".`, [ref('SEO Starter Guide', U.starter)]);
      if (kwDensity < 0.25 && wc > 400) add('seo', 'info', 'Focus keyword used very rarely', `"${kw}" appears ${kwCount} time(s) (${kwDensity.toFixed(2)}%).`, 'Use it a few more times where it fits naturally (intro, one H2, conclusion).', [ref('SEO Starter Guide', U.starter)]);
      secondary.forEach(s => { if (!countPhrase(m.allText, s)) add('seo', 'info', `Secondary keyword not used: "${s}"`, 'It is in your keyword list but not in the content.', 'Use it once in a relevant H2/H3 or paragraph, or drop it from the plan.', [ref('SEO Starter Guide', U.starter)]); });
    }
    if (kwInferred && kw) add('seo', 'info', 'No focus keyword supplied', `Content QC inferred "${kw}" from your headings. Keyword checks are less precise.`, 'Enter the focus keyword in the form for exact checks.', []);
    // Meta title & description
    const mt = opts.metaTitle.trim(), md = opts.metaDesc.trim();
    if (!longForm && type !== 'meta' && wc > T.idealWords[1] * 1.6) add('style', 'info', `Long for ${an(T.short)}`, `${wc} words. ${T.label} usually works best around ${T.idealWords[0]}-${T.idealWords[1]} words.`, 'Cut to the single message and the one action you want.', []);
    if (longForm || type === 'meta') {
      if (!mt) add('seo', 'info', 'No title tag entered', 'Without a title tag Google builds the title link from the H1 or other text.', 'Use one of the suggested title tags in the Suggestions panel.', pref('titles'));
      else {
        if (mt.length > 60) add('seo', 'warning', 'Title tag may be truncated', `${mt.length} characters. Google has no hard limit, but titles over ~60 characters (about 580 px) are usually cut off on mobile.`, 'Front-load the keyword and benefit; trim to 50-60 characters.', pref('titles'));
        if (mt.length < 30) add('seo', 'info', 'Title tag is short', `${mt.length} characters leaves room for a benefit or qualifier.`, 'Add a qualifier (year, audience, outcome) up to ~60 characters.', pref('titles'));
        if (kw && !kwInferred && !kwTokens.every(t => lc(mt).includes(t))) add('seo', 'warning', 'Title tag lacks the focus keyword', `"${mt}" does not contain "${kw}".`, 'Put the keyword near the start of the title.', pref('titles'));
        const yrs = (mt.match(/\b20\d\d\b/g) || []).map(Number).filter(y => y < YEAR);
        if (yrs.length) add('seo', 'warning', 'Outdated year in title tag', `Title mentions ${yrs.join(', ')} but it is ${YEAR}.`, `Update to ${YEAR} only if the content is genuinely refreshed.`, pref('bylines'));
        if (h1s.length && lc(mt) === lc(h1s[0].text)) add('seo', 'pass', 'Title tag matches H1', 'Consistent signals for the title link.', '', pref('titles'));
      }
      if (!md) add('seo', 'info', 'No meta description entered', 'Google may generate a snippet from page text. A written description often wins the click.', 'Use one of the suggested descriptions.', pref('snippets'));
      else {
        if (md.length > 160) add('seo', 'warning', 'Meta description may be truncated', `${md.length} characters; mobile snippets usually show about 120-160.`, 'Lead with the answer and benefit; keep it within ~155 characters.', pref('snippets'));
        if (md.length < 70) add('seo', 'info', 'Meta description is short', `${md.length} characters.`, 'Expand to 120-155 characters with the answer, benefit and a soft call to action.', pref('snippets'));
        if (kw && !kwInferred && !kwTokens.every(t => lc(md).includes(t))) add('seo', 'info', 'Meta description lacks the keyword', 'Google bolds query words in snippets, which lifts CTR.', `Include "${kw}" naturally.`, pref('snippets'));
      }
    }
    if (opts.slug) {
      const sl = opts.slug.replace(/^https?:\/\/[^/]+/, '');
      if (/[A-Z_ ]|\d{4}/.test(sl) || sl.split(/[-/]/).filter(Boolean).length > 8) add('seo', 'info', 'URL slug could be cleaner', `"${sl}" has capitals, underscores, spaces, a year or is long.`, 'Use short lowercase words joined by hyphens, no year (so it never goes stale).', [ref('URL structure', 'https://developers.google.com/search/docs/crawling-indexing/url-structure')]);
    }
    // Links
    if (longForm && type !== 'pr') {
      if (!internal.length && wc > 500) add('seo', 'warning', 'No internal links', host ? `No links to ${host} were found.` : 'No relative links were found (add your site domain in the form so absolute links are recognised).', 'Add 3 to 8 contextual links to related guides, tools and money pages using descriptive anchors.', pref('links'));
      else if (internal.length && wc / internal.length > 450 && wc > 900) add('seo', 'info', 'Few internal links for the length', `${internal.length} internal link(s) in ${wc} words.`, 'Aim for one contextual internal link per 250-400 words.', pref('links'));
    }
    const generic = m.links.filter(l => L.genericAnchors.includes(lc(l.text).trim()));
    if (generic.length) add('seo', 'info', 'Generic anchor text', `Anchors like ${generic.slice(0, 3).map(l => `"${l.text}"`).join(', ')} tell readers and Google nothing about the target.`, 'Describe the destination in the anchor, e.g. "our pip calculator" instead of "click here".', pref('links'), { locate: generic.map(g => g.text) });
    const longAnchors = m.links.filter(l => l.text.split(/\s+/).length > 9);
    if (longAnchors.length) add('seo', 'info', 'Very long anchor text', `${longAnchors.length} link(s) wrap 10+ words.`, 'Keep anchors to a short descriptive phrase.', pref('links'));
    const naked = (m.bodyText.match(/(^|\s)(https?:\/\/[^\s)]+)/g) || []);
    if (naked.length) add('seo', 'info', 'Unlinked URLs in text', `${naked.length} URL(s) appear as plain text.`, 'Turn them into descriptive links (or remove them).', pref('links'));
    // Images
    if (m.images.length) {
      const noAlt = m.images.filter(i => !i.alt.trim());
      if (noAlt.length) add('seo', 'warning', 'Images missing alt text', `${noAlt.length} of ${m.images.length} image(s) have no alt text.`, 'Describe what each image shows (include the topic where it fits; do not stuff keywords).', pref('images'));
      const badName = m.images.filter(i => /(image|img|screenshot|untitled|dsc|photo)[-_ ]?\d*\.(png|jpe?g|webp|gif)/i.test(i.src));
      if (badName.length) add('seo', 'info', 'Generic image file names', `${badName.length} image(s) use names like "image1.png".`, 'Rename files descriptively, e.g. "scalping-vs-swing-trading-chart.webp".', pref('images'));
    } else if (wc > 900 && ['blog', 'guest', 'review', 'landing'].includes(type)) add('seo', 'info', 'No images detected in the pasted content', 'Google recommends supporting text with relevant images or video; they also help AI features and Discover. (Images inserted later in the CMS are fine.)', 'Plan a featured image plus charts, screenshots or comparison visuals with alt text.', pref('images').concat([ref('Optimizing for generative AI', U.aiGuide)]));

    /* =================== Semantic SEO =================== */
    const present = TM.terms.filter(t => countPhrase(lcAll, t) > 0);
    const missing = TM.terms.filter(t => !present.includes(t));
    const entPresent = TM.entities.filter(e => lcAll.includes(e.toLowerCase()));
    const entMissing = TM.entities.filter(e => !entPresent.includes(e));
    const coverage = TM.terms.length ? present.length / TM.terms.length : 1;
    metrics.topicalCoverage = Math.round(coverage * 100);
    if (TM.terms.length && coverage < 0.5 && wc > 500) add('seo', 'warning', `Thin topical coverage for ${TM.label.toLowerCase()}`,
      `Only ${present.length} of ${TM.terms.length} core concepts appear. Neural matching and phrase-based indexing reward pages that cover the related concepts of a topic.`,
      `Work in the relevant ones: ${missing.slice(0, 10).join(', ')}.`, [ref('Ranking systems: neural matching', U.rankingGuide), ref('Patent: phrase-based indexing', KB.patents[4].url)]);
    else if (TM.terms.length && coverage < 0.75 && wc > 500) add('seo', 'info', 'Topical depth can improve', `${present.length}/${TM.terms.length} core ${TM.label.toLowerCase()} concepts covered.`, `Consider: ${missing.slice(0, 8).join(', ')}.`, [ref('Ranking systems guide', U.rankingGuide)]);
    if (TM.entities.length && entPresent.length < 2 && wc > 600) add('seo', 'info', 'Few named entities', 'Naming regulators, institutions, data sources and instruments helps Google and LLMs connect your page to known entities.', `Relevant entities: ${entMissing.slice(0, 8).join(', ')}.`, [ref('Patent: ranking by entity metrics', KB.patents[8].url)]);

    /* =================== 3. SERP DOMINANCE =================== */
    const lists = m.blocks.filter(b => b.type === 'list');
    const quotes = m.blocks.filter(b => b.type === 'quote');
    if (longForm && !lists.length && wc > 400) add('serp', 'warning', 'No bulleted or numbered lists', 'Lists make steps, features and comparisons scannable and are frequently lifted into featured snippets and AI Overviews.', 'Turn steps, criteria, pros/cons or key points into a list.', pref('featured'));
    if (!m.tableCount && !house.noTables && wc > 900 && ['blog', 'review', 'guest'].includes(type)) add('serp', 'info', 'No comparison table', 'Tables often win comparison and spec queries.', 'Add a compact comparison table where you compare options.', pref('featured'));
    const longParas = m.paragraphs.filter(p => wordsOf(p.text).length > 85);
    if (longParas.length) add('serp', 'warning', `${longParas.length} wall-of-text paragraph(s)`, `Paragraphs over ~85 words are hard to scan on mobile. Example: "${trimWords(longParas[0].text, 14)}"`, 'Split into 1 to 3 sentence paragraphs; move series of items into a list.', [ref('Helpful content: presentation', U.helpful)], { locate: longParas.slice(0, 5).map(p => trimWords(p.text, 8).replace(/\.\.\.$/, '')) });
    if (longForm && m.boldCount < 2 && wc > 500) add('serp', 'info', 'Little emphasis on key facts', 'Bolding the key answer and key numbers helps skim readers (and matches your house voice).', 'Bold the quick answer in the intro and important figures.', []);
    const hasSummary = m.blocks.slice(0, 12).some(b => /^(tl;?dr|summary|key takeaways?|in short|quick answer|at a glance|highlights)/i.test(b.text));
    metrics.hasSummary = hasSummary;
    if (!hasSummary && ['blog', 'guest', 'review', 'news'].includes(type) && wc > 500) add('serp', 'info', 'No TL;DR / Summary near the top', 'A short summary block near the top gives Google and AI Overviews a ready-made answer passage and helps readers decide to stay.', 'Add "TL;DR" or "Summary" with 2 to 4 one-line bullets after the intro.', [ref('Optimizing for generative AI', U.aiGuide)]);
    // Snippet-style section summaries
    const snippetSuggestions = [];
    m.sections.filter(s => s.heading && s.level === 2 && !/\b(faqs?|frequently asked|people also ask|final (wrap|words|thoughts)|bottom line|conclusion|wrapping up)\b/i.test(s.heading)).forEach(s => {
      const firstBlock = s.blocks.find(b => b.type !== 'h');
      if (firstBlock && (firstBlock.type === 'list' || firstBlock.type === 'table')) { snippetSuggestions.push({ heading: s.heading, current: '', suggestion: trimWords(firstBlock.items ? firstBlock.items.join('; ') : firstBlock.text, 40), ok: true, why: 'Opens with a list or table, which list and table snippets can use.' }); return; }
      const firstPara = s.blocks.find(b => b.type === 'p' && !b.boldOnly);
      if (!firstPara) { snippetSuggestions.push({ heading: s.heading, current: '', suggestion: '', ok: false, why: 'Section starts without a paragraph.' }); return; }
      const sents = splitSentences(firstPara.text);
      const lead = sents.slice(0, 2).join(' ');
      const leadWords = wordsOf(lead).length;
      const hTokens = contentWords(s.heading).filter(t => !['best','which','key','guide','work','works','vs'].includes(t));
      const overlap = hTokens.length ? hTokens.filter(t => lc(sents[0] || '').includes(t)).length / hTokens.length : 1;
      const ok = overlap >= 0.34 && leadWords >= 12 && leadWords <= 60 && !/^(so|but|and|also|however|besides|well|now|here|this|that|it|they)\b/i.test(sents[0] || '');
      let suggestion = trimWords(lead, 50);
      if (!ok && sents[0]) suggestion = trimWords((sents.find(x => hTokens.filter(t => lc(x).includes(t)).length >= Math.ceil(hTokens.length / 2)) || sents[0]), 45);
      snippetSuggestions.push({ heading: s.heading, current: trimWords(sents[0] || '', 30), suggestion, ok, why: ok ? 'Opens with a self-contained answer.' : (leadWords > 60 ? 'Opening is too long to lift as a snippet.' : overlap < 0.34 ? 'Opening sentence does not restate the heading\'s subject.' : 'Opening relies on a connector or pronoun, so it does not stand alone.') });
    });
    const weakSnips = snippetSuggestions.filter(s => !s.ok);
    if (snippetSuggestions.length >= 3 && weakSnips.length / snippetSuggestions.length > 0.4) add('serp', 'warning', `${weakSnips.length} section(s) lack a snippet-ready opening`,
      'Featured snippets and AI Overviews usually lift the first 40 to 60 words under a heading. Sections that open with context, a pronoun or a connector are less likely to be chosen.',
      'Start each section with a 1 to 2 sentence answer that names the subject of the heading. See "Snippet summaries" in Suggestions.', pref('featured'), { locate: weakSnips.slice(0, 5).map(s => s.heading) });

    /* =================== 4. AEO =================== */
    const isQ = t => /\?\s*$/.test(t) || /^(what|how|why|when|where|which|who|can|does|do|is|are|should|will|was|has|have)\b/i.test(t);
    const qHeads = headings.filter(h => h.level >= 2 && isQ(h.text));
    metrics.questionHeadings = qHeads.length;
    if (['blog', 'guest', 'review', 'landing'].includes(type) && h2s.length >= 3 && qHeads.length / Math.max(1, headings.filter(h => h.level >= 2).length) < 0.3) add('aeo', 'warning', 'Few question-style headings',
      `${qHeads.length} of ${headings.filter(h => h.level >= 2).length} subheadings are questions. Answer engines match conversational queries to question headings followed by direct answers.`,
      'Rephrase key H2s as the questions people type, e.g. "What Is Scalping?", "Is Swing Trading Better for Beginners?".', pref('featured'));
    // Direct answers under question headings
    const indirect = [];
    m.sections.filter(s => s.heading && s.level === 2 && isQ(s.heading)).forEach(s => {
      const p = s.blocks.find(b => b.type === 'p' && !b.boldOnly);
      if (!p) return;
      const first = splitSentences(p.text)[0] || '';
      const h = s.heading.trim();
      let bad = false, why = '';
      if (/^(is|are|can|does|do|should|will|was|has|have|could|would)\b/i.test(h) && !/^(yes|no|not|it depends|absolutely|definitely|generally|usually|mostly|partly|only)\b/i.test(first)) { bad = true; why = 'yes/no question without a yes/no opener'; }
      else if (/^what (is|are)\b/i.test(h) && !/\b(is|are|refers to|means|describes)\b/i.test(first.split(/\s+/).slice(0, 18).join(' '))) { bad = true; why = 'definition question without an "X is..." definition'; }
      else if (wordsOf(first).length > 40) { bad = true; why = 'first sentence is over 40 words'; }
      if (bad) indirect.push({ heading: h, why, first: trimWords(first, 16) });
    });
    if (indirect.length) add('aeo', indirect.length > 2 ? 'warning' : 'info', `${indirect.length} question(s) not answered directly`,
      'Answer engines and passage ranking prefer the answer in the first sentence after the question. ' + indirect.slice(0, 3).map(i => `"${trimWords(i.heading, 9)}" (${i.why})`).join('; ') + '.',
      'Open with "Yes, ...", "No, ..." or "X is ..." in under 30 words, then explain.', pref('featured').concat([ref('Patent: scoring candidate answer passages', KB.patents[9].url)]), { locate: indirect.slice(0, 5).map(i => i.heading), detail: indirect });
    // FAQ detection
    const faqs = detectFAQs(m);
    metrics.faqs = faqs.length;
    if (T.faq) {
      if (!faqs.length) add('aeo', 'warning', 'No FAQ section', 'A short FAQ captures People Also Ask style queries and long-tail questions that do not deserve a full H2.', `Add ${house.faq5 ? 'exactly 5' : '4 to 6'} PAA-style questions with a direct first-sentence answer. See suggested questions.`, pref('faq'));
      else {
        const longA = faqs.filter(f => wordsOf(f.a).length > 90), noDirect = faqs.filter(f => f.a && !directAnswer(f.q, f.a));
        if (longA.length) add('aeo', 'info', 'Long FAQ answers', `${longA.length} answer(s) exceed 90 words.`, 'Keep FAQ answers to about 40-60 words: answer first, one supporting line.', pref('faq'));
        if (noDirect.length) add('aeo', 'info', 'FAQ answers do not open directly', `${noDirect.length} FAQ answer(s) do not start with the answer, e.g. "${trimWords(noDirect[0].q, 10)}".`, 'Start each answer with Yes/No or the direct fact, then add context.', pref('featured'));
        add('aeo', 'info', 'FAQ rich results no longer show in Google', 'Google stopped showing FAQ rich results in May 2026 and removed the FAQ docs in June 2026. Your FAQ still helps readers, PAA matching and other answer engines; FAQPage markup is optional now.', 'Keep the FAQ for users and AEO. Adding FAQPage JSON-LD will not create a Google rich result.', pref('faq'));
      }
    } else if (faqs.length && (type === 'pr' || type === 'news')) {
      add('style', house.prNoFaq ? 'warning' : 'info', `FAQ section in ${an(T.short)}`, type === 'pr' ? 'Your house rule for digital PR releases is no FAQ section in the body.' : key === 'news' ? 'Your SSF market news format has no FAQ section.' : 'News articles rarely carry FAQ blocks; they read as SEO padding.', 'Remove the FAQ block; fold any essential answer into the body.', []);
    }
    // PAA coverage
    const paa = buildPAA(kw, niche).map(q => ({ q, covered: coverageOf(q, kw, headings, m, faqs) }));
    const paaMissing = paa.filter(p => p.covered === 'no');
    metrics.paaCovered = paa.filter(p => p.covered !== 'no').length; metrics.paaTotal = paa.length;
    if (kw && longForm && type !== 'pr' && type !== 'news' && paaMissing.length >= Math.ceil(paa.length / 2)) add('aeo', 'warning', 'Many People Also Ask questions unanswered',
      `${paaMissing.length} of ${paa.length} common questions around "${kw}" are not clearly answered.`, 'Answer the missing ones as H2/H3s or FAQ entries (see Suggestions).', [ref('Patent: generating related questions', KB.patents[10].url)]);

    /* =================== 5. AIO / AI Overviews =================== */
    const firstChunk = m.words.slice(0, 160).join(' ');
    const defRe = kw ? new RegExp(reEsc(kw.split(/\s+vs\.?\s+/)[0]) + "[^.]{0,40}\\b(is|are|refers to|means|involves)\\b") : null;
    const hasDef = kw && (defRe.test(firstChunk) || /\b(is a|is an|is the|refers to|means)\b/.test(firstChunk));
    if (['blog', 'guest', 'review'].includes(type) && !hasDef) add('aio', 'warning', 'No early definition or direct answer',
      'AI Overviews often quote a clear definition or answer near the top. The first ~150 words do not contain an "X is..." style statement.', `Add one sentence such as "${titleCase(kw || 'Topic')} is ..." in the intro, then expand.`, pref('aifeatures'));
    const factSents = m.sentences.filter(s => /\d/.test(s.text) && (L.attribution.some(a => lc(s.text).includes(a)) || /\b(CFTC|FCA|SEC|BIS|ESMA|Fed|Federal Reserve|BLS|IMF|World Bank|ECB|Bank of)\b/.test(s.text)));
    metrics.factSentences = factSents.length;
    if (['blog', 'guest', 'review', 'landing'].includes(type) && wc > 500 && factSents.length < 3) add('aio', 'info', 'Few attributable fact sentences',
      `${factSents.length} sentence(s) combine a number with a named source. Generative engines prefer citing declarative, attributed facts.`, 'Add 3+ sentences like "According to the BIS, forex volume averaged $9.6 trillion a day in 2025."', pref('aifeatures').concat([ref('Patent: generative summaries', KB.patents[12].url)]));
    const subQs = paaMissing.map(p => p.q);
    if (subQs.length && ['blog', 'guest', 'review'].includes(type)) add('aio', subQs.length > 4 ? 'warning' : 'info', 'Sub-questions to cover for query fan-out',
      'AI Mode breaks a query into related sub-questions and pulls passages for each. Missing sub-topics mean fewer chances to be cited.', 'Cover: ' + subQs.slice(0, 6).join(' | '), pref('aifeatures'));
    add('aio', 'pass', 'No special AI markup needed', 'Google states AI features need no llms.txt, special schema or chunking. Content QC\'s AIO checks focus on clarity, originality and coverage, which is what Google recommends.', '', pref('aifeatures'));

    /* =================== 6. LLM-READINESS & READABILITY =================== */
    const sentLens = m.sentences.map(s => wordsOf(s.text).length).filter(n => n > 0);
    const syl = m.words.reduce((s, w) => s + syllables(w), 0);
    const wps = m.sentences.length ? wc / m.sentences.length : 0;
    const spw = wc ? syl / wc : 0;
    const fre = Math.round(206.835 - 1.015 * wps - 84.6 * spw);
    const grade = Math.max(0, +(0.39 * wps + 11.8 * spw - 15.59).toFixed(1));
    metrics.fre = fre; metrics.grade = grade; metrics.avgSentence = +wps.toFixed(1);
    if (fre < 45) add('llm', 'warning', 'Hard to read for beginners', `Flesch reading ease ${fre} (grade ${grade}). Your audience is complete beginners; aim for 55+.`, 'Shorten sentences, swap jargon for plain words, explain terms on first use.', pref('helpful'));
    else if (fre < 55) add('llm', 'info', 'Readability could be easier', `Flesch reading ease ${fre} (grade ${grade}).`, 'Break long sentences and replace multi-syllable words where simple ones work.', pref('helpful'));
    const longSents = m.sentences.filter(s => wordsOf(s.text).length > 32);
    if (longSents.length) add('llm', longSents.length > 4 ? 'warning' : 'info', `${longSents.length} very long sentence(s)`, `Sentences over 32 words are harder to summarise and quote. Example: "${trimWords(longSents[0].text, 14)}"`, 'Split at the conjunction or move details into a list.', [], { locate: longSents.slice(0, 6).map(s => trimWords(s.text, 7).replace(/\.\.\.$/, '')) });
    const orphan = m.sections.filter(s => s.heading).map(s => ({ s, p: s.blocks.find(b => b.type === 'p' && !b.boldOnly) })).filter(x => x.p && /^(it|this|these|that|they|those|he|she|such)\b/i.test(x.p.text));
    if (orphan.length) add('llm', 'info', 'Sections open with a pronoun', `${orphan.length} section(s) start with "It/This/They...", e.g. under "${trimWords(orphan[0].s.heading, 8)}". When an AI system lifts that passage alone, the subject is lost.`, 'Name the subject again at the start of each section.', pref('aifeatures'), { locate: orphan.slice(0, 5).map(o => trimWords(o.p.text, 6).replace(/\.\.\.$/, '')) });
    const passive = m.sentences.filter(s => /\b(is|are|was|were|be|been|being)\s+(\w+ly\s+)?\w+(ed|en)\b/i.test(s.text)).length;
    metrics.passivePct = m.sentences.length ? Math.round(passive / m.sentences.length * 100) : 0;
    if (metrics.passivePct > 18) add('llm', 'info', 'Heavy passive voice', `About ${metrics.passivePct}% of sentences look passive.`, 'Prefer active voice: "The Fed raised rates" rather than "Rates were raised".', []);
    const hasClose = headings.some(h => /conclusion|final|bottom line|wrap|verdict|takeaway|summary|what should traders do/i.test(h.text));
    if (!hasClose && wc > 700 && ['blog', 'guest', 'review'].includes(type)) add('llm', 'info', 'No closing summary section', 'A closing section restates the answer, which helps summarisation and gives readers a next step.', 'Add "Bottom Line" or "Final Wrap" with the verdict and a soft CTA.', []);
    // Entity continuity
    const lost = m.sections.filter(s => s.heading && s.blocks.length > 2 && kwTokens.length && !kwTokens.some(t => lc(s.heading + ' ' + s.blocks.map(b => b.text).join(' ')).includes(t)));
    if (lost.length > 2) add('llm', 'info', 'Sections drift from the main entity', `${lost.length} sections never mention the main topic words (${kwTokens.join(', ')}).`, 'Tie each section back to the topic in its heading or first sentence so passages stay self-contained.', []);

    /* =================== 7. E-E-A-T & TRUST =================== */
    const exp = hitList(m.allText, L.experience);
    metrics.experienceSignals = exp.reduce((s, e) => s + e.count, 0);
    if (!exp.length && ['blog', 'guest', 'review', 'landing'].includes(type)) add('eeat', 'warning', 'No first-hand experience signals',
      'Google\'s guidance and the rater guidelines give extra weight to content showing it was created by someone who used the product, made the trade or tested the method.',
      'Add concrete experience: "We backtested this on EUR/USD M5 for 3 months", screenshots, trade logs, results your analysts saw.', pref('eeat').concat(pref('helpful')));
    const attrib = hitList(m.allText, L.attribution);
    if (!external.length && !attrib.length && wc > 400 && (longForm || type === 'email')) add('eeat', 'warning', 'No citations or sources',
      'There are no outbound references or attributions. For finance (YMYL) content, claims without sources lower trust.', 'Cite primary sources (regulators, central banks, official reports) with active links.', pref('ymyl').concat(pref('eeat')));
    else if (attrib.length && !external.length && type !== 'news') add('eeat', 'info', 'Sources named but not linked', 'You attribute facts but none link out to the source.', 'Link each attributed statistic to the original report or page.', pref('eeat'));
    // Unsourced stats
    const statRe = /(\d+(?:\.\d+)?\s?%|\$\s?\d[\d,.]*\s?(?:billion|million|trillion|bn|m|k)?|\b\d[\d,.]*\s?(?:billion|million|trillion)\b)/i;
    const unsourced = [];
    m.blocks.forEach((b, bi) => {
      if (b.type !== 'p' && b.type !== 'list') return;
      const blockLinks = m.links.filter(l => l.block === bi && l.text);
      splitSentences(b.text).forEach(s => {
        const linked = blockLinks.some(l => s.includes(l.text));
        if (statRe.test(s) && !L.attribution.some(a => lc(s).includes(a)) && !linked && !/\b(we|our|i)\b/i.test(s) && !/\b(SL|TP|pips?|lot|RAM|GB|SSD|inch|ratio|1:\d)\b/i.test(s)) unsourced.push(s);
      });
    });
    metrics.unsourcedStats = unsourced.length;
    if (unsourced.length) add('eeat', unsourced.length > 3 ? 'warning' : 'info', `${unsourced.length} statistic(s) without a source`,
      `Numbers stated as fact without attribution: "${trimWords(unsourced[0], 16)}"${unsourced.length > 1 ? ' and others' : ''}.`, 'Attribute each one ("According to the CFTC...") and link the source, or remove it if it cannot be verified.', pref('ymyl').concat(pref('eeat')), { locate: unsourced.slice(0, 6).map(s => trimWords(s, 7).replace(/\.\.\.$/, '')) });
    // Accuracy / performance claims
    const perfRe = /\b(\d{2,3}(?:\.\d+)?)\s?%\s?(?:\w+\s){0,2}(accuracy|accurate|win rate|winning rate|success rate|profitable|strike rate)/gi;
    const perf = (m.allText.match(perfRe) || []);
    const verified = perf.length > 0 && perf.every(pc => { const i = m.sentences.findIndex(x => x.text.includes(pc)); const ctx = m.sentences.slice(Math.max(0, i - 1), i + 2).map(x => x.text).join(' '); return /verified|myfxbook|fxblue|track record|audited|according to|independent|over \d+ trades|sample of/i.test(ctx); });
    if (perf.length) add('eeat', verified ? 'info' : 'warning', 'Performance or accuracy claims',
      `Found ${perf.slice(0, 3).map(p => `"${p}"`).join(', ')}. Your YMYL guardrail: performance claims must be attributed and verifiable.${verified ? '' : ' No verification source was found nearby.'}`,
      'State the period, sample size and where it is verified (e.g. Myfxbook link), and pair it with "past performance does not guarantee future results".', pref('ymyl').concat(pref('misleading')), { locate: perf.slice(0, 5) });
    // Risk disclaimer in body
    const riskSent = m.sentences.some(s => /\brisk/i.test(s.text) && /\b(lose|loss|losses|capital|money|not (financial|investment) advice|past performance)\b/i.test(s.text));
    if (isFinance && !riskSent && !(key === 'news' && house.newsRules) && type !== 'meta' && !['microcopy', 'tagline', 'bio', 'about', 'job'].includes(key)) add('eeat', longForm ? 'warning' : 'info', 'No risk statement in the body',
      'Trading content is YMYL. Your guardrail is a risk reminder inside the body, not only in the site footer. Raters look for balanced, safe guidance.', 'Add a line such as "Trading leveraged products carries a high risk of losing money. Only risk capital you can afford to lose."', pref('ymyl'));
    // Author
    if (!opts.author.trim() && ['blog', 'guest', 'review', 'news'].includes(type)) add('eeat', 'info', 'No author byline entered', 'A clear byline linked to a real author page supports E-E-A-T and Google News transparency.', 'Enter the author in the form (real person, real bio, consistent profiles).', pref('eeat').concat(pref('news')));
    else if (opts.author.trim()) add('eeat', 'info', 'Make sure the byline is a real, verifiable person', `Byline: "${opts.author}". Since Oct 2026 Google\'s helpful content guidance says made-up names, AI-generated headshots or false credentials used to look like human experts are deception and a low-quality signal.`, 'Use a real author with a matching LinkedIn/social presence and an author page; or credit an "Editorial Team" honestly.', pref('helpful'));
    // Quotes
    if (!quotes.length && !/"[^"]{20,}"/.test(m.allText) && ['blog', 'guest', 'pr'].includes(type) && wc > 600) add('eeat', 'info', 'No expert or source quotes', 'A short quote from a named expert, spokesperson or report adds authority and quotable lines for AI answers.', type === 'pr' ? 'Add a spokesperson quote with name and title.' : 'Add a blockquote from a named source or your own analyst.', pref('eeat'));
    // Outdated years
    const oldYears = [];
    headings.concat(m.sentences.slice(0, 6).map(s => ({ text: s.text }))).forEach(h => (h.text.match(/\b(20[12]\d)\b/g) || []).forEach(y => { if (+y < YEAR && /\b(in|for|of|best|top|guide|update|202\d\s?(guide|edition))\b/i.test(h.text)) oldYears.push(y + ': "' + trimWords(h.text, 9) + '"'); }));
    if (oldYears.length) add('eeat', 'warning', 'Outdated year references', `It is ${YEAR}, but headings or the intro reference earlier years as current (${oldYears.slice(0, 3).join('; ')}).`, `Refresh the data and update to ${YEAR}, or rephrase so it is not time-bound.`, pref('bylines').concat([ref('Ranking systems: freshness', U.rankingGuide)]));

    /* =================== 8. AI-CONTENT SIGNALS =================== */
    const ai = aiDetect(m, opts.sensitivity);
    metrics.ai = ai.summary;
    const aiShort = wc < 60;
    if (aiShort) { ai.summary.probability = null; ai.summary.verdict = 'Too short to judge'; }
    const aiProb = aiShort ? 0 : ai.summary.probability;
    if (aiShort && applies('ai') && wc) add('ai', 'info', 'Too short for a reliable AI-detection verdict', `${wc} words. Detectors (GPTZero, ZeroGPT and this one) need roughly 60+ words before their scores mean anything. Phrase-level checks still ran.`, 'Judge short copy by clarity, accuracy and policy fit instead.', pref('genai'));
    else if (aiProb >= 65) add('ai', 'warning', `Reads as likely AI-generated (${aiProb}%)`,
      `Signals: ${ai.summary.topSignals.join('; ')}. Google does not penalise AI use itself, but uniform, generic, low-information text is what its scaled content abuse and helpful content systems target, and readers notice it.`,
      'Rewrite highlighted sentences in your voice: vary sentence length, add your own data and examples, cut stock phrases. Use "Humanize" in AI Assist for a draft.', pref('genai').concat(pref('scaled')));
    else if (aiProb >= 40) add('ai', 'info', `Mixed signals (${aiProb}% AI-likeness)`, `Signals: ${ai.summary.topSignals.join('; ') || 'none dominant'}.`, 'Revise the amber/red sentences in the Highlight view.', pref('genai'));
    else add('ai', 'pass', `Reads as human-written (${aiProb}% AI-likeness)`, 'Sentence rhythm, vocabulary and specificity look natural.', '', pref('genai'));
    if (ai.phraseHits.length) add('ai', ai.phraseHits.length > 6 ? 'warning' : 'info', `${ai.phraseHits.reduce((s, h) => s + h.count, 0)} AI-associated phrase(s)`,
      `Common LLM phrases: ${ai.phraseHits.slice(0, 10).map(h => `"${h.phrase}"${h.count > 1 ? ' x' + h.count : ''}`).join(', ')}.`, 'Replace them with plain, specific wording.', [], { locate: ai.phraseHits.map(h => h.phrase) });
    if (aiProb >= 65 && ai.summary.specificity < 1.5) add('policy', 'warning', 'Pattern resembles scaled, low-value content',
      'High AI-likeness combined with low specificity (few numbers, names, experiences) is the pattern Google\'s scaled content abuse policy describes. One page is not a violation, but publishing many like it is risky.', 'Add original data, examples and first-hand insight before publishing.', pref('scaled').concat(pref('genai')));
    const intro = (m.sentences[0] && m.sentences[0].text) || '';
    if (/^(in today'?s|in the (ever|fast)|in the world of|when it comes to|have you ever wondered|are you looking|welcome to|in this (article|blog|post|guide))/i.test(intro)) add('ai', 'info', 'Generic opening line', `"${trimWords(intro, 12)}" is a stock opener that both AI detectors and readers associate with filler.`, 'Open with a statistic, a sharp question or the quick answer, like your published articles do.', pref('helpful'), { locate: [trimWords(intro, 5).replace(/\.\.\.$/, '')] });

    /* =================== 9. ORIGINALITY & SPIN =================== */
    const tort = L.tortured.filter(([bad]) => countPhrase(m.allText, bad) > 0);
    if (tort.length) add('orig', 'critical', 'Spun (tortured) phrases detected',
      `Found ${tort.map(([b, g]) => `"${b}" (should be "${g}")`).join(', ')}. These are the fingerprints of synonym-spinning tools, which Google's scraping and scaled content policies call out.`,
      'Replace with the standard term and rewrite the surrounding passage in your own words.', pref('scraping').concat(pref('scaled')), { locate: tort.map(t => t[0]) });
    const dups = internalDuplicates(m.sentences.map(s => s.text));
    if (dups.length) add('orig', dups.length > 2 ? 'warning' : 'info', `${dups.length} near-duplicate sentence pair(s)`, `Example: "${trimWords(dups[0][0], 12)}" vs "${trimWords(dups[0][1], 12)}".`, 'Merge or rewrite repeated points; repetition reads as padding.', pref('helpful'), { locate: dups.slice(0, 4).map(d => trimWords(d[1], 6).replace(/\.\.\.$/, '')) });
    const specificity = ai.summary.specificity;
    metrics.specificity = specificity;
    if (specificity < 1.2 && wc > 400) add('orig', 'warning', 'Low information gain', `Only ${specificity} specific details (numbers, names, examples, experiences) per 100 words. Google rewards content that adds something beyond what already ranks (see the information gain patent).`, 'Add original data, a worked example, a comparison or a personal observation in each section.', pref('helpful').concat([ref('Patent: information gain', KB.patents[2].url)]));
    else if (specificity >= 2.5) add('orig', 'pass', 'Good density of specific detail', `${specificity} specific details per 100 words.`, '', [ref('Patent: information gain', KB.patents[2].url)]);
    const spot = spotCheck(m.sentences.map(s => s.text));

    /* =================== 10. VOICE & HOUSE STYLE =================== */
    const emd = (m.allText.match(/—/g) || []).length + (m.allText.match(/\s--\s/g) || []).length;
    if (house.emDash && emd) add('style', 'warning', `${emd} em dash(es)`, 'Your house rule: never use em dashes. They are also one of the most cited AI-writing tells.', 'Replace with a comma, colon, parentheses or a new sentence.', [], { locate: ['—'] });
    if (house.list46 && ['blog', 'guest', 'landing', 'review'].includes(type)) {
      const odd = lists.filter(l => l.items.length !== 4 && l.items.length !== 6 && l.items.length > 1);
      if (odd.length) add('style', 'info', `${odd.length} list(s) not 4 or 6 items`, `House rule for web copy: bullet lists have 4 or 6 items. Found lists with ${[...new Set(odd.map(l => l.items.length))].join(', ')} items.`, 'Merge or split points so each list has 4 or 6 items (numbered lists of real steps can be exceptions).', [], { locate: odd.slice(0, 4).map(l => trimWords(l.items[0], 5).replace(/\.\.\.$/, '')) });
    }
    if (house.faq5 && T.faq && faqs.length && faqs.length !== 5) add('style', 'warning', `FAQ has ${faqs.length} questions (house rule: exactly 5)`, 'Every page gets exactly 5 PAA-style FAQs with a direct first-sentence answer.', faqs.length > 5 ? 'Keep the 5 strongest and move the rest into the body or drop them.' : 'Add questions from the PAA suggestions until there are 5.', []);
    if (house.noTables && m.tableCount && type !== 'social') add('style', 'info', `${m.tableCount} table(s) in the content`, 'Your house rule for written content is bullet points instead of tables.', 'Convert the table to a 4 or 6 item bullet list (e.g. "Time frame: seconds to minutes").', []);
    if (house.shortParas) {
      const p3 = m.paragraphs.filter(p => splitSentences(p.text).length > 3 || wordsOf(p.text).length > 70);
      if (p3.length) add('style', p3.length > 4 ? 'warning' : 'info', `${p3.length} paragraph(s) longer than bite-size`, 'Your voice uses 1 to 3 short sentences per paragraph.', 'Split them.', [], { locate: p3.slice(0, 5).map(p => trimWords(p.text, 6).replace(/\.\.\.$/, '')) });
    }
    if (type === 'pr') {
      if (house.prHeadings && h2s.length + headings.filter(h => h.level === 3).length < 2) add('style', 'warning', 'Press release has no section headings', 'Your digital PR format uses section headings with natural, time-relevant keywords rather than paragraph-only text.', 'Add 3 to 5 headings, e.g. "Halloween 2026 Trading Deals Go Live", "What Traders Get", "Availability".', []);
      if (!/media contact|press contact|contact:|e-?mail:|@[a-z0-9-]+\.[a-z]{2,}/i.test(m.allText)) add('style', 'warning', 'No media contact block', 'Releases need a media contact for journalists and Google News transparency.', 'Add the media contact exactly as supplied.', pref('news'));
      if (!/\babout\s+[A-Z][\w.&-]+/.test(m.allText)) add('style', 'info', 'No "About [Company]" section', 'Boilerplate helps journalists and entity understanding.', 'Add a fresh About section (new angle each release).', []);
    }
    if (key === 'news' && house.newsRules) {
      if (/\b(GMT|UTC|BST|IST|BDT)\b/.test(m.allText)) add('style', 'warning', 'Times not in US Eastern Time', 'House rule for market news: write times and dates in ET, never GMT/UTC.', 'Convert to ET (e.g. "8:30 a.m. ET").', [], { locate: (m.allText.match(/\b\d{1,2}(:\d\d)?\s?(am|pm|a\.m\.|p\.m\.)?\s?(GMT|UTC|BST)\b|\b(GMT|UTC|BST)\b/gi) || []).slice(0, 4) });
      const jar = hitList(m.allText, L.newsJargon);
      if (jar.length) add('style', 'info', 'Market jargon for a beginner audience', `Found ${jar.map(j => `"${j.phrase}"`).join(', ')}.`, 'Use plain words ("investors bought riskier assets", "the Fed signalled cuts").', []);
      if (/asian session|tokyo session|asia session/i.test(m.allText)) add('style', 'info', 'Asian session focus', 'SSF news targets US, UK, UAE and Israel readers, not the Asian session.', 'Reframe around the London or New York session.', []);
      const summaryIdx = m.blocks.findIndex(b => /^summary$/i.test(b.text.trim()));
      if (summaryIdx >= 0) { const nl = m.blocks.slice(summaryIdx + 1).find(b => b.type === 'list'); if (nl && (nl.items.length !== 3 || nl.items.some(i => wordsOf(i).length > 12))) add('style', 'warning', 'Summary bullets off-format', 'SSF news: exactly 3 one-line bullets, max 12 words each.', 'Trim to 3 short bullets.', []); }
      const wsIdx = m.blocks.findIndex(b => b.type === 'h' && /what should traders do/i.test(b.text));
      if (wsIdx < 0) add('style', 'info', 'Missing "What Should Traders Do Now?"', 'The SSF news closing H2 gives 4 actionable bullets.', 'Add the H2 with exactly 4 bullets.', []);
      else { const nl = m.blocks.slice(wsIdx + 1).find(b => b.type === 'list'); if (nl && nl.items.length !== 4) add('style', 'warning', '"What Should Traders Do Now?" needs 4 bullets', `It has ${nl.items.length}.`, 'Use exactly 4 bullets.', []); }
    }
    const ph = L.placeholders.filter(p => m.allText.includes(p));
    if (ph.length) add('style', 'critical', 'Placeholders or editing marks left in', `Found ${ph.map(p => `"${p}"`).join(', ')}.`, 'Remove them; omit any figure you cannot verify.', [], { locate: ph });
    if (house.cryptoTrading && niche === 'crypto' && /\b(invest(ing|ment|or|ors)?|hodl|long-term holding)\b/i.test(m.allText)) {
      const n = (m.allText.match(/\binvest(ing|ment|or|ors)?\b/gi) || []).length;
      if (n >= 2) add('style', 'info', 'Crypto investing language', `${n} "invest..." words. SSF crypto content is framed as crypto trading, not investing.`, 'Reframe as trading (entries, exits, risk per trade, timeframes).', [], { locate: ['invest'] });
    }
    // Expert precision upgrades
    const upgrades = L.expertUpgrades.filter(([v]) => countPhrase(m.allText, v) > 0);
    if (upgrades.length && isFinance) add('style', 'info', 'Sound more like a finance expert', upgrades.slice(0, 6).map(([v, e]) => `"${v}" → ${e}`).join('; ') + '.', 'Precise numbers, formats and named regulators read as expertise.', pref('eeat'), { locate: upgrades.map(u => u[0]) });
    // Proofreading
    if (house.proofread) {
      const pr = proofread(m.allText);
      if (pr.length) add('style', pr.length > 5 ? 'warning' : 'info', `${pr.length} proofreading issue(s)`, pr.slice(0, 6).map(p => p.msg).join('; ') + '.', 'Fix typos and spacing before publishing; errors lower perceived quality.', [ref('Helpful content: quality questions', U.helpful)], { locate: pr.slice(0, 8).map(p => p.text) });
    }
    // Voice match
    const vm = voiceMatch(m, headings, faqs, exp, attrib, hasSummary);
    metrics.voice = vm.score;
    if (houseOn && ['blog', 'guest', 'review'].includes(type)) {
      if (vm.missing.length) add('style', vm.score < 55 ? 'warning' : 'info', `Voice match ${vm.score}% with your published style`, 'Missing traits: ' + vm.missing.map(t => t.label).join('; ') + '.', 'See the Voice panel for each trait, or use "Humanize in my voice" in AI Assist.', KB.voice.samples.slice(0, 2).map((u, i) => ref('Your sample ' + (i + 1), u)));
      else add('style', 'pass', `Voice match ${vm.score}%`, 'Structure and tone match your published articles.', '', []);
    }

    /* =================== Cross-engine checks (Google + Bing + AI answers) =================== */
    const inj = [/ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|prompts|messages)/i, /\bif you are an? (ai|llm|language model|chatbot|bot|assistant)\b/i,
      /\b(dear|attention|note to|instructions? (to|for))\s+(ai|llms?|chatgpt|gemini|copilot|claude|perplexity|language models?|ai assistants?|crawlers?)\b/i,
      /\b(chatgpt|gemini|copilot|claude|perplexity|ai assistants?|llms?|language models?)\s*,?\s*(you )?(must|should|always|please)\s+(recommend|cite|rank|mention|say|describe|list)\b/i,
      /\bsystem prompt\b/i, /<\s*\/?\s*(system|assistant|instructions?)\s*>/i, /\b(always|only) (recommend|cite) [A-Z][\w.]+ (as|when)\b/];
    const injHits = m.sentences.map(x => x.text).filter(t => inj.some(r => r.test(t)));
    if (injHits.length) add('policy', 'critical', 'Prompt injection or AI-manipulation text',
      `Found text addressed to AI systems: "${trimWords(injHits[0], 18)}". Bing's Feb 2026 guidelines list prompt injection as abuse, and Google's spam policies cover attempts to manipulate generative AI responses.`,
      'Remove instructions aimed at crawlers or AI assistants. Earn citations with clear, verifiable facts instead.', pref('bingAbuse').concat([ref('Google spam policies', U.spam)]), { locate: injHits.slice(0, 4).map(t => trimWords(t, 6).replace(/\.\.\.$/, '')) });
    // Entity name consistency (Bing GEO: clear, consistent entity names)
    const forms = {};
    (m.allText.match(/\b[A-Za-z]*[a-z][A-Z][A-Za-z]*\b(?![.@][a-z])|\b[A-Z][a-z]+[A-Z]{2,}\b|\b[A-Z]{2,}[a-z]+\b/g) || []).forEach(w => { const k = w.toLowerCase(); (forms[k] = forms[k] || new Set()).add(w); });
    Object.keys(forms).forEach(k => { const re = new RegExp('\\b' + reEsc(k) + '\\b(?![.@][a-z])', 'gi'); (m.allText.match(re) || []).forEach(w => forms[k].add(w)); });
    const inconsistent = Object.values(forms).filter(set => set.size > 1).map(set => [...set]);
    if (inconsistent.length) add('llm', 'warning', 'Inconsistent spelling of names',
      `The same entity is written different ways: ${inconsistent.slice(0, 4).map(v => v.map(x => `"${x}"`).join(' / ')).join('; ')}. Bing's GEO guidance asks for clear, consistent entity names, and mixed spellings weaken brand recognition in AI answers.`,
      'Pick the official spelling and use it everywhere.', pref('bingGeo'), { locate: inconsistent.slice(0, 4).flatMap(v => v.slice(1)) });
    // Disclosure for sponsored or affiliate content
    const disclosed = /\b(sponsored|paid partnership|in partnership with|advertorial|affiliate (link|disclosure)|we may earn|#ad\b|#sponsored|ad:)/i.test(m.allText);
    if ((T.needsDisclosure || (affLinks.length && ['social', 'review', 'blog'].includes(type))) && !disclosed) add('policy', 'warning', 'No sponsorship or affiliate disclosure',
      'Paid or affiliate content needs a clear disclosure readers can see (FTC and UK/EU rules), and search engines expect such links to be qualified.', 'Add a line such as "Sponsored by X" or "We may earn a commission from links on this page", and use rel="sponsored".', pref('disclosure'));

    /* =================== Family-specific checks =================== */
    const plainLines = m.blocks.flatMap(b => b.items || [b.text]).map(x => x.trim()).filter(Boolean);
    const capsWords = (m.allText.match(/\b[A-Z]{4,}\b/g) || []).filter(w => !/^(FOMC|NASDAQ|CFTC|ESMA|SSF|USD|EUR|GBP|JPY|XAU|BTC|ETH|AUD|CAD|CHF|NZD|HTML|SEO|API|URL|FAQ|NYSE|FINRA|ASIC|CYSEC|NFP|ECB|IMF|RSA|GDPR)$/.test(w));
    if (type === 'email') {
      const subj = (plainLines.find(l => /^subject\s*:/i.test(l)) || '').replace(/^subject\s*:\s*/i, '');
      if (subj) {
        metrics.subject = subj;
        if (subj.length > 60) add('serp', 'info', 'Subject line may be cut off', `${subj.length} characters. Mobile inboxes show about 35 to 50.`, 'Front-load the benefit in the first 40 characters.', pref('gmail'));
        if (/[!?]{2,}|\b[A-Z]{5,}\b/.test(subj)) add('policy', 'warning', 'Spammy subject formatting', 'All-caps words or repeated punctuation in subject lines trigger spam filters and complaints.', 'Use sentence case and one punctuation mark at most.', pref('gmail'));
      } else if (key !== 'pitch') add('serp', 'info', 'No subject line found', 'Start the email with "Subject: ..." so Content QC can check it.', 'Add a subject line (and preheader) at the top.', pref('gmail'));
      const spamWords = hitList(m.allText, ['free money', 'act now', '100% free', 'risk-free', 'risk free', 'winner', 'urgent', 'limited time only', 'click below', 'cash bonus', '$$$', 'double your', 'no cost', 'earn extra cash', 'once in a lifetime', 'congratulations', 'you have been selected', 'no strings attached', 'make money fast']);
      if (spamWords.length) add('policy', 'warning', 'Spam-trigger wording', `Found ${spamWords.map(w => `"${w.phrase}"`).join(', ')}.`, 'Replace with specific, honest wording.', pref('gmail'), { locate: spamWords.map(w => w.phrase) });
      if (['newsletter', 'promo'].includes(key) && !/unsubscribe|opt[ -]out|manage (your )?preferences/i.test(m.allText)) add('policy', 'warning', 'No unsubscribe line', 'Gmail and Yahoo require bulk marketing mail to offer an easy (one-click) unsubscribe. If your email platform adds it automatically, you can ignore this.', 'Add or confirm the unsubscribe footer.', pref('gmail'));
      if (!m.links.length && !/\b(reply|book|join|start|claim|download|read|register|sign up|get)\b/i.test(m.allText)) add('serp', 'info', 'No clear call to action', 'Every email should ask for one specific action.', 'Add one clear CTA link or reply request.', []);
      if (key === 'cold' || key === 'pitch') { if (wc > 200) add('style', 'info', 'Long for a cold email', `${wc} words.`, 'Keep pitches under ~150 words with one ask.', []); if (m.links.length > 2) add('policy', 'info', 'Several links in a cold email', 'Multiple links in first-contact emails raise spam scores.', 'Keep to one link or none.', pref('gmail')); }
      if ((m.allText.match(/!/g) || []).length > 3) add('style', 'info', 'Many exclamation marks', 'They lower trust and can trip spam filters.', 'Keep one at most.', pref('gmail'));
    }
    if (type === 'ad') {
      if (key === 'searchad') {
        const heads = plainLines.filter(l => l.length <= 30), descs = plainLines.filter(l => l.length > 30 && l.length <= 90), over = plainLines.filter(l => l.length > 90);
        metrics.adLines = { headlines: heads.length, descriptions: descs.length };
        if (over.length) add('policy', 'warning', `${over.length} line(s) over the 90-character limit`, 'Responsive search ads allow 30-character headlines and 90-character descriptions (Google and Microsoft).', 'Shorten or split those lines.', pref('adsEditorial'), { locate: over.map(l => trimWords(l, 6).replace(/\.\.\.$/, '')) });
        if (heads.length < 3 || descs.length < 2) add('style', 'info', 'Not enough ad assets', `${heads.length} headline(s) and ${descs.length} description(s). Responsive search ads need at least 3 headlines and 2 descriptions; up to 15 and 4 perform best.`, 'Write more variations, one per line.', pref('adsEditorial'));
        if (heads.some(h => /!/.test(h))) add('policy', 'warning', 'Exclamation mark in a headline', 'Google Ads does not allow exclamation marks in headlines.', 'Remove it.', pref('adsEditorial'));
      }
      if (capsWords.length) add('policy', 'warning', 'Excessive capitalization', `Words in all caps: ${[...new Set(capsWords)].slice(0, 5).join(', ')}.`, 'Use normal capitalization; ad editorial policies reject caps for emphasis.', pref('adsEditorial'), { locate: capsWords.slice(0, 5) });
      if (/([!?.])\1|[\u2605\u2606\u2714\u2713\u27a4\u2192]{1,}|[\u{1F300}-\u{1FAFF}]/u.test(m.allText)) add('policy', 'warning', 'Gimmicky punctuation or symbols', 'Repeated punctuation, arrows, stars or emoji used for emphasis break ad editorial rules.', 'Remove them.', pref('adsEditorial'));
      const sup = hitList(m.allText, ['#1', 'number one', 'best', 'top-rated', 'cheapest', 'lowest', 'guarantee', 'guaranteed', 'fastest', 'most accurate']);
      if (sup.length) add('policy', 'info', 'Superlative claims need proof', `Found ${sup.map(x => `"${x.phrase}"`).join(', ')}. Ad platforms require third-party verification on the landing page for comparative claims.`, 'Back the claim with a cited source on the landing page or soften it.', pref('adsEditorial'));
      if (isFinance && key !== 'microcopy' && key !== 'tagline') add('policy', 'info', 'Financial services ad rules apply', 'Trading, crypto and signal ads need advertiser verification in many countries and cannot imply guaranteed returns; include a risk warning where required (for example UK CFD risk percentages).', 'Check the platform\'s financial services policy for each target country before launch.', pref('adsFinance'));
      if (/\b(are you|do you have|you'?re|struggling with)\b.{0,30}\b(in debt|broke|poor|bankrupt|losing money|depressed|overweight|unemployed)\b/i.test(m.allText)) add('policy', 'warning', 'Implies personal attributes', 'Meta and other platforms reject ads that assert or imply a person\'s financial status or other personal attributes.', 'Talk about the product benefit instead ("Learn risk management step by step").', pref('adsFinance'));
      if (key === 'push' && m.allText.length > 120) add('style', 'warning', 'Message will be truncated', `${m.allText.length} characters. Push notifications show about 40-110 characters; SMS segments are 160.`, 'Lead with the key point in the first 40 characters.', []);
      if (key === 'microcopy' && hitList(m.allText, ['click here', 'submit', 'learn more', 'read more']).length) add('style', 'info', 'Generic button text', 'Specific verbs ("Get my free pip calculator") convert better and help accessibility.', 'Say what happens next.', pref('links'));
    }
    if (type === 'social') {
      const pf = T.platform;
      const tags = (m.allText.match(/#[\w]+/g) || []);
      const chars = m.allText.length;
      if (pf === 'x') {
        const posts = m.blocks.filter(b => b.type !== 'h').flatMap(b => b.items || [b.text]);
        const long = posts.filter(x => x.length > 280);
        if (long.length) add('style', 'warning', `${long.length} post(s) over 280 characters`, 'Standard X posts are limited to 280 characters.', 'Split them into thread posts.', [], { locate: long.map(x => trimWords(x, 6).replace(/\.\.\.$/, '')) });
        if (tags.length > posts.length * 2) add('style', 'info', 'Too many hashtags', 'More than 1 or 2 hashtags per post reduces reach and looks spammy.', 'Keep 1 or 2.', pref('social'));
      }
      if (pf === 'linkedin') {
        const first = plainLines[0] || '';
        if (first.length > 150) add('serp', 'info', 'Hook is buried', 'LinkedIn shows about the first 210 characters before "see more". Your first line is long.', 'Open with a one-line hook: a number, a bold claim you can prove, or a question.', pref('social'));
        if (chars > 3000) add('style', 'warning', 'Over LinkedIn\'s 3,000-character limit', `${chars} characters.`, 'Trim or move detail into a linked article.', []);
        if (tags.length > 5) add('style', 'info', 'Too many hashtags', `${tags.length} hashtags. 3 to 5 is typical.`, 'Keep the 3 most relevant.', []);
      }
      if (pf === 'instagram') {
        if (chars > 2200) add('style', 'warning', 'Over the 2,200-character caption limit', `${chars} characters.`, 'Trim it.', []);
        if (tags.length > 30) add('style', 'warning', 'Over 30 hashtags', 'Instagram rejects captions with more than 30 hashtags.', 'Use 3 to 8 focused ones.', []);
        else if (tags.length > 10) add('style', 'info', 'Many hashtags', `${tags.length} hashtags.`, 'Use 3 to 8 focused ones.', []);
        if ((plainLines[0] || '').length > 125) add('serp', 'info', 'First line is long', 'Only about 125 characters show before "more".', 'Put the hook first.', []);
      }
      if (pf === 'youtube') {
        const yt = opts.metaTitle || plainLines[0] || '';
        if (yt.length > 100) add('seo', 'warning', 'YouTube title over 100 characters', 'YouTube rejects titles longer than 100 characters.', 'Shorten it.', []);
        else if (yt.length > 70) add('seo', 'info', 'YouTube title may be truncated', `${yt.length} characters; search and suggested videos cut around 70.`, 'Front-load the keyword.', []);
        if (kw && !lc(m.allText.slice(0, 160)).includes(kwTokens[0] || kw)) add('seo', 'info', 'Keyword not in the first lines of the description', 'The first ~150 characters show in search and above "Show more".', `Mention "${kw}" early.`, []);
        if (chars > 5000) add('style', 'warning', 'Over YouTube\'s 5,000-character description limit', `${chars} characters.`, 'Trim it.', []);
        if (wc > 250 && !/\b\d{1,2}:\d{2}\b/.test(m.allText)) add('serp', 'info', 'No timestamps', 'Chapters (timestamps starting at 0:00) can appear as key moments in Google.', 'Add chapter timestamps.', [ref('Video SEO', KB.U.docsHome.replace('/docs', '/docs/appearance/video'))]);
      }
      if (pf === 'forum') {
        if (m.links.length && !/\b(i work (at|for)|disclosure|i'?m (the|a) (founder|co-?founder|employee)|full disclosure|our (company|product|team))\b/i.test(m.allText)) add('policy', 'warning', 'Undisclosed self-promotion risk', 'Forum answers with links but no stated affiliation are treated as spam by communities and as user-generated link spam by search engines.', 'State your affiliation, lead with genuine help, and link only if it adds value.', pref('linkspam').concat(pref('disclosure')));
      }
    }
    /* ---------- restricted and sensitive claims (Google Ads, Merchant, YouTube, QRG) ---------- */
    const isAdLike = ['ad', 'email', 'landing', 'social'].includes(type);
    const claimSev = isAdLike ? 'warning' : 'info';
    const CLAIMS = [
      ['Health or medical claims', /\b(cures?|heals?|treats? (?:diabetes|cancer|anxiety|depression|covid)|prevents? (?:cancer|disease|covid)|miracle (?:cure|pill)|detox(?:es|ify)?|lose \d+\s?(?:lbs?|pounds|kg)|weight[- ]loss guarantee|fda[- ]approved|clinically proven)\b/i, 'adsRestricted', 'Healthcare and medicine claims are restricted in ads and are YMYL for Search. Unproven claims count as "unreliable claims".', 'Remove cure or guaranteed-result language and cite the evidence (study, regulator approval) for any health claim.'],
      ['Gambling or betting content', /\b(casino|sports ?betting|bet now|sportsbook|slots?|poker|jackpot|betting tips)\b/i, 'adsRestricted', 'Gambling ads need Google certification and are allowed only in some countries.', 'Confirm certification and target countries, and add responsible-gambling wording.'],
      ['Alcohol, tobacco or vaping', /\b(beer|wine|vodka|whisk(?:e)?y|liquor|cigarettes?|vape|vaping|e-?cig)\b/i, 'adsRestricted', 'Alcohol is restricted and tobacco or vaping ads are prohibited on Google Ads.', 'Check the platform rules for your target countries before running ads.'],
      ['Political or election content', /\b(vote for|election|candidate|ballot|campaign donation|political party)\b/i, 'adsRestricted', 'Election ads require advertiser verification and "paid for by" disclosures in many countries.', 'Complete election-ads verification or remove political messaging.'],
      ['Counterfeit or replica goods', /\b(replica|1:1 copy|knock-?off|fake designer|counterfeit)\b/i, 'adsRestricted', 'Counterfeit goods are prohibited across Google Ads, Shopping and Search.', 'Remove the product or the claim.'],
      ['Fake urgency or pressure', /\b(only \d+ (?:left|spots?|seats?)|expires? in \d+ ?(?:min|minutes|hours?)|last chance|act now|before it'?s too late|ends tonight)\b/i, 'adsMisrep', 'Pressure tactics are fine only when true. Google Ads treats false urgency and fear-based pressure as clickbait under Misrepresentation.', 'Use a real deadline the landing page confirms, or drop the pressure line.'],
      ['"Free" with conditions', /\bfree\b[^.]{0,40}(\*|conditions apply|terms apply|with purchase|trial)/i, 'adsMisrep', 'Offers must not hide costs. Dishonest pricing practices are prohibited.', 'State the conditions clearly next to the offer and on the landing page.'],
      ['Implied Google or official endorsement', /\b(google[- ](?:approved|certified|partner|endorsed|recommended)|endorsed by google|official (?:google|youtube) partner|government[- ](?:approved|backed|endorsed))\b/i, 'adsMisrep', 'False affiliation is misrepresentation. Only verified partners may use Google partner badges.', 'Remove the claim unless you hold the verified badge, and link to proof.'],
      ['Requests for sensitive personal data', /\b(send (?:us )?your (?:password|pin|otp|social security|ssn|card number|seed phrase|private key)|verify your (?:password|account) by)\b/i, 'gmail', 'Asking for passwords, card numbers or seed phrases looks like phishing to Gmail and Google Safe Browsing.', 'Never ask for credentials in copy; link to your secure site login instead.']
    ];
    const claimHits = [];
    CLAIMS.forEach(([title, re, pol, why, fix]) => { const mm = m.allText.match(re); if (mm) { claimHits.push(title); add('policy', /Counterfeit|personal data/.test(title) ? 'critical' : claimSev, title, `Found "${mm[0]}". ${why}`, fix, pref(pol), { locate: [mm[0]] }); } });
    // SEO service claims (Google: no one can guarantee #1)
    const seoClaim = m.allText.match(/\b(guarantee(?:d)? (?:#?1|number one|first page|top (?:3|three|10|ten)|page one|rankings?)|#1 on google|rank (?:#?1|first) on google|first page of google guaranteed|special relationship with google|priority submission)\b/i);
    if (seoClaim) add('policy', 'warning', 'Guaranteed-ranking claim', `Found "${seoClaim[0]}". Google states that no one can guarantee a #1 ranking and lists this promise as a warning sign of bad SEO providers.`, 'Promise process and measurable work (audits, content, reporting), not rankings.', pref('seoClaims'), { locate: [seoClaim[0]] });

    /* ---------- extra platform checks ---------- */
    if (type === 'ad' && (T.platform === 'pmax' || T.platform === 'display')) {
      const heads = plainLines.filter(l => l.length <= 30), longs = plainLines.filter(l => l.length > 30 && l.length <= 90), over = plainLines.filter(l => l.length > 90);
      metrics.adLines = { headlines: heads.length, longHeadlines: longs.length };
      if (over.length) add('policy', 'warning', `${over.length} line(s) over 90 characters`, 'Long headlines and descriptions are limited to 90 characters.', 'Shorten or split them.', pref('adsEditorial'));
      if (heads.length < 3) add('style', 'info', 'Add more short headlines', `${heads.length} line(s) of 30 characters or less. ${T.platform === 'pmax' ? 'Performance Max takes 3 to 15 headlines' : 'Responsive display ads take up to 5 short headlines'}.`, 'Write more 30-character headlines, one per line.', pref('adsEditorial'));
      if (!longs.length) add('style', 'info', 'No long headline or description', 'Add at least one 31-90 character long headline and two descriptions.', 'Write them on separate lines.', pref('adsEditorial'));
    }
    if (type === 'ad' && T.platform === 'ytad') {
      const first12 = m.words.slice(0, 12).join(' ');
      const brand = (opts.domain || '').split('.')[0];
      if (wc > 85) add('style', 'info', 'Long for a short-form video ad', `${wc} words is roughly ${Math.round(wc / 2.5)} seconds of voiceover. Bumpers are 6 seconds (about 15 words); most skippable ads win in 15 to 30 seconds (40 to 75 words).`, 'Cut to one message and one call to action.', pref('ytAdFriendly'));
      if (brand && !first12.includes(brand.toLowerCase())) add('serp', 'info', 'Brand not in the first 5 seconds', 'Viewers can skip after 5 seconds; brand mention early lifts recall.', 'Name the brand or product in the first sentence.', []);
      if (!/\b(visit|download|sign up|join|try|start|get|book|subscribe|shop|learn more)\b/i.test(m.allText)) add('serp', 'info', 'No call to action', 'Video ads need one clear spoken and on-screen CTA.', 'End with one action.', []);
    }
    if (type === 'ad' && T.platform === 'shopping') {
      const ttl = opts.metaTitle || plainLines[0] || '', desc = opts.metaDesc || plainLines.slice(1).join(' ');
      if (ttl.length > 150) add('policy', 'warning', 'Product title over 150 characters', `${ttl.length} characters. Merchant Center limits titles to 150 and shows about the first 70.`, 'Put brand, product type and key attribute (size, colour) first.', pref('merchant'));
      else if (ttl.length > 70) add('seo', 'info', 'Key details after character 70 may be hidden', 'Shopping shows roughly the first 70 characters of the title.', 'Front-load the most important attributes.', pref('merchant'));
      const promo = (ttl + ' ' + desc).match(/\b(free shipping|sale|% off|discount|best price|cheapest|buy now|limited offer|lowest price)\b/i);
      if (promo) add('policy', 'warning', 'Promotional text in product data', `Found "${promo[0]}". Product titles and descriptions must describe the product only.`, 'Move offers to Merchant promotions or sale price fields.', pref('merchant'), { locate: [promo[0]] });
      if (/https?:\/\/|www\./i.test(desc)) add('policy', 'warning', 'Link in product description', 'Descriptions must not contain links to your store.', 'Remove the link.', pref('merchant'));
      if (desc.length > 5000) add('policy', 'warning', 'Description over 5,000 characters', '', 'Trim it.', pref('merchant'));
    }
    if (T.platform === 'gbp') {
      if (/https?:\/\/|www\./i.test(m.allText)) add('policy', 'warning', 'Link in Business Profile text', 'Business descriptions must not include links.', 'Remove URLs; use the website field instead.', pref('gbp'));
      if (/\b(sale|% off|discount|price|\$\d|offer|deal|coupon)\b/i.test(m.allText)) add('policy', 'warning', 'Promotions or prices in the description', 'The business description must not mention promotions, prices or sales (use Offer posts instead).', 'Move offers to a Google Business Profile post.', pref('gbp'));
      if (m.allText.length > 750) add('style', 'info', 'Longer than the 750-character description', `${m.allText.length} characters. Posts can run to 1,500.`, 'Trim if this is the business description.', pref('gbp'));
    }
    if (T.platform === 'play') {
      const ttl = opts.metaTitle || plainLines[0] || '';
      if (ttl.length > 30) add('policy', 'warning', 'App title over 30 characters', `"${ttl}" is ${ttl.length} characters.`, 'Shorten to 30 or fewer.', pref('play'));
      if (/#\s?1|\b(best|top|popular|no\.? ?1|free|sale|discount)\b/i.test(ttl)) add('policy', 'warning', 'Ranking, price or promo words in the title', 'Play titles cannot include store-performance claims ("#1", "Popular") or price and promotion text.', 'Describe what the app does instead.', pref('play'));
      if (/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]|([!*~#])\1/u.test(ttl)) add('policy', 'warning', 'Emoji or repeated symbols in the title', 'Not allowed in Play titles.', 'Remove them.', pref('play'));
      if (/"[^"]{10,}"\s*(?:-|,)?\s*(?:a |an )?(user|customer|reviewer)\b/i.test(m.allText) || /\b(users say|one user said|a customer said)\b/i.test(m.allText)) add('policy', 'warning', 'Unattributed testimonial', 'Anonymous user testimonials are not allowed in Play descriptions.', 'Attribute it to a named source or remove it.', pref('play'));
      const sCount = stuffedTri.length; if (sCount) add('policy', 'info', 'Repetitive keywords', 'Play forbids repetitive or unrelated keywords in metadata.', 'Write natural sentences.', pref('play'));
    }
    if (key === 'youtube' || key === 'shorts' || key === 'script') {
      const tags = (m.allText.match(/#[\w]+/g) || []);
      if (tags.length > 15) add('policy', 'warning', 'More than 15 hashtags', `${tags.length} hashtags. YouTube ignores all hashtags on a video that has more than 15, and over-tagging counts as misleading metadata.`, 'Keep 3 to 5 relevant hashtags.', pref('ytSpam'));
      const bait = m.allText.match(/\b(sub(?:scribe)? ?(?:4|for) ?sub|comment ['"]?\w+['"]? (?:to|and) (?:get|win|receive)|like (?:and|&) share (?:to|for) (?:win|a chance)|giveaway.{0,20}comment|free money|double your (?:btc|crypto|money))\b/i);
      if (bait) add('policy', 'warning', 'Engagement bait or scam pattern', `Found "${bait[0]}". YouTube's spam policy removes engagement manipulation, fake giveaways and money-doubling scams.`, 'Ask for genuine engagement without rewards; never promise money for comments.', pref('ytSpam'), { locate: [bait[0]] });
      const ttl = opts.metaTitle || plainLines[0] || '';
      if (/\b(fuck|f\*ck|shit|bitch|porn)\b/i.test(ttl)) add('policy', 'warning', 'Profanity or adult terms in the title', 'Strong profanity or adult references in titles and thumbnails remove or limit ad revenue.', 'Clean up the title; keep strong language out of the first 7 to 8 seconds.', pref('ytAdFriendly'));
      if (/\b(sponsored by|thanks to our sponsor|promo code|use code|affiliate link|paid partnership|brought to you by)\b/i.test(m.allText)) add('policy', 'info', 'Paid promotion: tick the YouTube disclosure box', 'Sponsorships mentioned in the video must also be declared with YouTube\'s paid promotion setting, which adds an on-screen label.', 'Enable "Includes paid promotion" when uploading.', pref('ytDisclose'));
      if (/\b(ai[- ]generated|deepfake|voice clone|synthetic voice|made with ai)\b/i.test(m.allText)) add('policy', 'info', 'Altered or synthetic content may need a disclosure', 'Realistic AI-generated or altered people, places or events must be disclosed on upload.', 'Use the altered content setting in YouTube Studio when it applies.', pref('ytDisclose'));
    }
    if (type === 'email' && ['newsletter', 'promo', 'welcome'].includes(key)) {
      if (!/\b\d{1,5}\s+\w+.{0,40}\b(street|st\.?|road|rd\.?|avenue|ave\.?|suite|floor|lane|blvd|dhaka|london|new york|p\.?o\.? box)\b/i.test(m.allText)) add('policy', 'info', 'No postal address in the email', 'CAN-SPAM requires a valid physical postal address in commercial email. Your email platform footer may already add it.', 'Confirm your footer includes the business address.', pref('canspam'));
    }
    if (key === 'transactional' && /\b(sale|% off|discount|shop now|limited offer|upgrade now)\b/i.test(m.allText)) add('policy', 'info', 'Promotion inside a transactional email', 'Mostly-promotional "transactional" emails lose their transactional status under CAN-SPAM and need opt-out handling.', 'Keep receipts and alerts focused; move promotions to marketing email.', pref('canspam'));

    /* ---------- technical SEO from page source ---------- */
    if (srcHTML) technical(srcHTML, add, pref, metrics);

    if (key === 'local' && !/\+?\d[\d\s().-]{7,}\d/.test(m.allText)) add('eeat', 'info', 'No phone number (NAP)', 'Local pages should show name, address and phone that match your business profiles.', 'Add consistent NAP details.', pref('local'));
    if (key === 'job') { if (!/salary|\$|\u20ac|\u00a3|bdt|per (hour|month|year)|compensation/i.test(m.allText)) add('eeat', 'info', 'No salary information', 'Pay ranges improve job search visibility and are legally required in some regions.', 'Add a salary range.', pref('jobs')); if (!/remote|hybrid|on-?site|location|office/i.test(m.allText)) add('eeat', 'info', 'No location or remote status', 'Job search features need a location or remote eligibility.', 'State the location or remote policy.', pref('jobs')); }
    if (type === 'meta') {
      if (!opts.metaTitle && !opts.metaDesc) add('seo', 'warning', 'No title or description to check', 'Paste the title on the first line and the meta description on the second, or use the Title tag and Meta description fields.', '', pref('titles'));
      if (opts.metaTitle && opts.metaDesc && lc(opts.metaDesc).startsWith(lc(opts.metaTitle).slice(0, 30))) add('seo', 'info', 'Description repeats the title', 'The snippet should add information the title does not.', 'Lead the description with the answer or benefit.', pref('snippets'));
    }

    /* =================== Suggestions =================== */
    const suggestions = {
      titles: suggestTitles(kw, h1s[0] && h1s[0].text, type, exp.length > 0),
      descriptions: suggestDescriptions(kw, m, h2s),
      snippets: snippetSuggestions,
      paa,
      faqs,
      faqSchema: faqSchema(faqs),
      articleSchema: articleSchema(opts, title, kw, wc),
      lsi: { niche: TM.label, present, missing, entPresent, entMissing, topTerms: topTerms(m) },
      internal: internalIdeas(m, headings, kw, host, present.concat(entPresent)),
      spot,
      voice: vm,
      unsourced: unsourced.slice(0, 10),
      indirect
    };

    /* =================== Domain fit =================== */
    let fit = null;
    if (opts.siteProfile && wc) {
      fit = domainFit(m, opts.siteProfile, { kw, kwTokens, h1: (h1s[0] || {}).text || title, type, key, opts, niche, present });
      fit.findings.forEach(f => add('fit', f.sev, f.title, f.reason, f.fix, f.refs || [], f.extra || {}));
      if (fit.links.length) suggestions.internal = fit.links;
      suggestions.fit = fit;
    }

    /* =================== Scores =================== */
    const scores = {};
    for (const c of Object.keys(CATS)) {
      if (!applies(c)) { scores[c] = null; continue; }
      const f = findings.filter(x => x.cat === c);
      let s = 100 - f.reduce((sum, x) => sum + PENALTY[x.sev], 0);
      scores[c] = Math.round(clamp(s, 0, 100));
    }
    if (fit) scores.fit = Math.round(clamp(fit.score - fit.findings.filter(f => f.sev === 'critical').length * 15, 0, 100));
    if (applies('ai')) scores.ai = aiShort ? null : Math.round(clamp(100 - aiProb + (ai.phraseHits.length ? -Math.min(10, ai.phraseHits.length) : 0), 0, 100));
    let tw = 0, ts = 0;
    for (const [c, meta] of Object.entries(CATS)) { if (scores[c] == null) continue; tw += meta.weight; ts += meta.weight * scores[c]; }
    let overall = Math.round(ts / tw);
    if (findings.some(f => f.sev === 'critical' && f.cat === 'policy')) overall = Math.min(overall, 69);
    const order = { critical: 0, warning: 1, info: 2, pass: 3 };
    findings.sort((a, b) => order[a.sev] - order[b.sev] || CATS[b.cat].weight - CATS[a.cat].weight);
    return { overall, scores, findings, suggestions, metrics, ai, model: m, opts, cats: CATS, type, key, typeLabel: T.label, checkedAt: new Date().toISOString() };
  }

  /* ------------------------------ domain fit ------------------------------ */
  const stem = w => { w = w.replace(/[^a-z0-9]/g, ''); if (w.length > 4) w = w.replace(/ies$/, 'y'); if (w.length > 5) w = w.replace(/(ing|ed)$/, ''); if (w.length > 4) w = w.replace(/(es|s)$/, ''); if (w.length > 5) w = w.replace(/er$/, ''); if (w.length > 4) w = w.replace(/e$/, ''); return w; };
  const toks = t => contentWords(String(t || '').replace(/[-_/]+/g, ' ')).map(stem).filter(w => w.length > 2);
  const slugText = u => { try { const p = new URL(u).pathname.replace(/\.(html?|php)$/, ''); return p.split('/').filter(Boolean).slice(-2).join(' ').replace(/[-_]+/g, ' '); } catch (e) { return ''; } };
  function domainFit(m, P, ctx) {
    const out = { findings: [], shared: [], newTopics: [], cannibal: [], links: [], notes: [] };
    const F = (sev, title, reason, fix, refs, extra) => out.findings.push({ sev, title, reason, fix, refs, extra });
    const vocab = new Map();
    const feed = (P.feed || []).filter(f => f.title);
    const pages = [];
    const seenU = new Set();
    const addPage = (url, label) => { if (!url || seenU.has(url)) return; seenU.add(url); pages.push({ url, label, set: new Set(toks(label + ' ' + slugText(url))) }); };
    feed.forEach(f => addPage(f.url, f.title));
    (P.nav || []).forEach(n => addPage(n.url, n.text));
    (P.urls || []).forEach(u => addPage(u.url, slugText(u.url)));
    const feedTerms = (texts, w) => texts.forEach(t => { const ts = toks(t); ts.forEach((x, i) => { vocab.set(x, (vocab.get(x) || 0) + w); if (ts[i + 1]) vocab.set(x + ' ' + ts[i + 1], (vocab.get(x + ' ' + ts[i + 1]) || 0) + w); }); });
    feedTerms([P.title, P.description, P.siteName], 3);
    feedTerms(P.headings || [], 2);
    feedTerms(feed.map(f => f.title), 2);
    feedTerms(pages.map(p => p.label), 1);
    out.site = { domain: P.domain, title: P.title, description: P.description, pages: pages.length, feedCount: feed.length, lastPost: feed.map(f => f.date).filter(Boolean).sort().pop() || null, lang: P.lang, via: P.via || 'server' };
    if (vocab.size < 15) { F('info', 'Very little readable content on ' + P.domain, 'The homepage, sitemap and feed gave almost no text to compare against (the site may block bots or render with JavaScript).', 'Fit results are low-confidence. Try importing one of its articles instead.', []); }
    // topic overlap
    const ctop = [...new Set(topTerms(m).map(t => t.term).concat(ctx.kwTokens, ctx.present || []))].slice(0, 26);
    const has = term => { const ts = toks(term); return ts.length && (ts.length === 1 ? vocab.has(ts[0]) : vocab.has(ts.join(' ')) || ts.every(x => vocab.has(x))); };
    ctop.forEach(t => (has(t) ? out.shared : out.newTopics).push(t));
    const coverage = ctop.length ? out.shared.length / ctop.length : 0;
    const kwT = ctx.kwTokens.map(stem);
    const kwHit = kwT.length ? kwT.filter(x => vocab.has(x)).length / kwT.length : coverage;
    out.score = Math.round(100 * clamp(0.65 * clamp(coverage / 0.8) + 0.35 * kwHit));
    out.verdict = out.score >= 65 ? 'Strong fit' : out.score >= 40 ? 'Partial fit' : 'Off-topic for this site';
    const U = KB.U, pref = id => { const p = KB.policies.find(x => x.id === id); return p ? [ref(p.title, p.url)].concat(p.also || []) : []; };
    if (out.score >= 65) F('pass', `Strong topical fit with ${P.domain} (${out.score}%)`, `${out.shared.length} of the article's ${ctop.length} main topics already appear across the site.`, '', pref('helpful'));
    else if (out.score >= 40) F('warning', `Partial fit with ${P.domain} (${out.score}%)`, `Only ${out.shared.length} of ${ctop.length} main topics match what the site already covers. Topics new to the site: ${out.newTopics.slice(0, 8).join(', ')}.`, 'Connect the piece to the site\'s core topics (and link to those pages), or publish it where that topic is the focus.', pref('helpful').concat(pref('bingGeo')));
    else F('critical', `Off-topic for ${P.domain} (${out.score}%)`, `The article's main topics (${ctop.slice(0, 8).join(', ')}) barely appear on the site. Google evaluates sites as a whole; content far outside a site's focus earns weak signals and, on a host site, can look like content placed only to borrow its reputation.`, 'Re-angle the piece toward the site\'s audience, or publish it on a site where this topic belongs.', pref('helpful').concat(pref('siterep')));
    // niche alignment
    const siteText = [P.title, P.description].concat(P.headings || [], feed.map(f => f.title)).join(' ').toLowerCase();
    let siteNiche = 'generic', best = 0;
    Object.entries(KB.topicalMaps).forEach(([k, tm]) => { const h = tm.triggers.reduce((s, t) => s + (siteText.split(t).length - 1), 0); if (h > best) { best = h; siteNiche = k; } });
    out.siteNiche = KB.topicalMaps[siteNiche].label;
    const fin = ['forex', 'gold', 'crypto', 'indices', 'stocks', 'signals'];
    if (siteNiche !== 'generic' && ctx.niche !== 'generic' && siteNiche !== ctx.niche && !(fin.includes(siteNiche) && fin.includes(ctx.niche))) F('warning', 'Different niche from the site', `The site reads as ${KB.topicalMaps[siteNiche].label.toLowerCase()}, the article as ${KB.topicalMaps[ctx.niche].label.toLowerCase()}.`, 'Bridge the topics explicitly or choose a better-matched site.', pref('helpful'));
    if (fin.includes(siteNiche)) F('info', 'YMYL site: finance trust bar applies', `${P.domain} is a finance site, so raters expect named experts, sourced figures and risk wording on every page.`, 'Check the E-E-A-T findings before publishing.', pref('ymyl'));
    // cannibalization
    const ownPath = (() => { try { return new URL(ctx.opts.slug, 'https://' + P.domain).pathname.replace(/\/$/, ''); } catch (e) { return ''; } })();
    const hT = new Set(toks(ctx.h1));
    pages.forEach(p => {
      if (!p.set.size) return;
      const kwOv = kwT.length ? kwT.filter(x => p.set.has(x)).length / kwT.length : 0;
      const inter = [...hT].filter(x => p.set.has(x)).length; const jac = hT.size ? inter / (hT.size + p.set.size - inter) : 0;
      if ((kwT.length >= 2 && kwOv === 1) || jac >= 0.55) {
        let path = ''; try { path = new URL(p.url).pathname.replace(/\/$/, ''); } catch (e) { }
        out.cannibal.push({ url: p.url, label: p.label, same: !!ownPath && path === ownPath, strength: Math.max(kwOv, jac) });
      }
    });
    out.cannibal.sort((a, b) => b.strength - a.strength); out.cannibal = out.cannibal.slice(0, 6);
    const same = out.cannibal.find(c => c.same), comp = out.cannibal.filter(c => !c.same);
    if (same) F('info', 'This updates an existing page', `${same.url} already exists with this slug. Treat this as a refresh.`, 'Keep the URL, update the visible date only if the changes are meaningful.', pref('bylines'));
    if (comp.length) F('warning', `Possible keyword cannibalization (${comp.length} page${comp.length > 1 ? 's' : ''})`, `${P.domain} already has page(s) targeting the same topic: ${comp.slice(0, 3).map(c => c.url).join(', ')}. Two pages competing for one query split signals and Google may pick the weaker one.`, 'Differentiate the angle and keyword, merge into the existing page (with a 301), or link the new page to it as a supporting piece.', [ref('Consolidate duplicate URLs', U.canonical), ref('Ranking systems: site diversity', U.rankingGuide)], { locate: [] });
    // duplicate title
    const nh = String(ctx.h1).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const dupT = feed.concat((P.nav || []).map(n => ({ title: n.text, url: n.url }))).find(f => nh && String(f.title).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim() === nh);
    if (dupT) F('warning', 'Same headline already on the site', `"${dupT.title}" is already used at ${dupT.url}.`, 'Write a distinct headline and title tag.', pref('titles'));
    // internal link suggestions with real URLs
    const phrases = [...new Set([ctx.kw].concat(topTerms(m).filter(t => t.term.includes(' ')).map(t => t.term), (ctx.present || []).filter(t => t.includes(' ')), topTerms(m).map(t => t.term)))].filter(Boolean);
    const textL = lc(m.bodyText);
    const used = new Set();
    phrases.forEach(ph => {
      if (out.links.length >= 8 || !textL.includes(lc(ph))) return;
      const pt = toks(ph); if (!pt.length) return;
      if (pt.length < 2 && !(ctx.present || []).some(t => lc(t) === lc(ph))) return;
      const cand = pages.filter(p => !used.has(p.url) && !comp.some(c => c.url === p.url) && pt.every(x => p.set.has(x)) && !/\/(tag|category|author|page)\//.test(p.url)).sort((a, b) => a.set.size - b.set.size)[0];
      if (cand) { used.add(cand.url); out.links.push({ anchor: ph, where: cand.label, target: cand.url, url: cand.url }); }
    });
    if (!out.links.length && pages.length > 5) F('info', 'No obvious internal link targets', `None of ${P.domain}'s ${pages.length} known pages matched the article's main phrases.`, 'Add a short section that connects to an existing guide, tool or service page.', pref('links'));
    else if (out.links.length) F('pass', `${out.links.length} internal link target(s) found on ${P.domain}`, 'Real URLs from the site\'s sitemap and feed that match phrases in your text (see Suggestions).', '', pref('links'));
    // language, freshness, brand, host fit
    const en = (m.allText.match(/\b(the|and|of|to|is)\b/gi) || []).length / Math.max(1, m.words.length);
    if (P.lang && !/^en/.test(P.lang) && en > 0.05) F('warning', 'Language mismatch', `${P.domain} declares lang="${P.lang}" but the article is in English.`, 'Publish in the site\'s language or on an English section with hreflang.', pref('metaTags'));
    if (out.site.lastPost && Date.now() - new Date(out.site.lastPost) > 180 * 864e5) F('info', 'The site has not published recently', `Latest feed item: ${new Date(out.site.lastPost).toLocaleDateString()}.`, 'Fresh, regular publishing helps new pages get crawled sooner.', []);
    const brand = (P.siteName || (P.title || '').split(/[|\-:\u2013\u2014]/)[0] || '').trim();
    if (brand && brand.length < 40 && ['pr', 'landing'].includes(ctx.type) && !lc(m.allText).includes(lc(brand))) F('info', `Brand "${brand}" not mentioned`, 'Pages on a brand\'s own site (and its releases) should name the brand clearly.', 'Mention the brand naturally in the intro.', pref('bingGeo'));
    if (['guest'].includes(ctx.type) && out.score < 45) F('critical', 'Weak fit for a guest post on this host', 'Since the Aug 2026 site reputation update, third-party content that does not match the host\'s focus and quality is a manual-action risk, and links from it carry little value.', 'Pitch a topic that matches the host, or choose a host in your niche.', pref('siterep'));
    return out;
  }

  /* ------------------------------ technical SEO (page source) ------------------------------ */
  function technical(src, add, pref, metrics) {
    const d = new DOMParser().parseFromString(src, 'text/html');
    const q = s => d.querySelector(s), qa = s => Array.from(d.querySelectorAll(s));
    const meta = n => (q(`meta[name="${n}" i]`) || { getAttribute: () => null }).getAttribute('content');
    const title = (q('title') || {}).textContent || '';
    const desc = meta('description');
    const robots = [meta('robots'), meta('googlebot'), meta('bingbot')].filter(Boolean).join(',').toLowerCase();
    const T = {};
    T.title = title.trim(); T.description = desc;
    if (!T.title) add('tech', 'critical', 'No <title> tag', 'Every indexable page needs a unique title; Google otherwise invents a title link.', 'Add a descriptive <title> in the <head>.', pref('titles'));
    else if (T.title.length > 65) add('tech', 'info', '<title> may be truncated', `${T.title.length} characters.`, 'Keep the key words in the first 60 characters.', pref('titles'));
    if (!desc) add('tech', 'warning', 'No meta description tag', 'Google and Bing will generate a snippet from page text.', 'Add <meta name="description" content="...">.', pref('snippets'));
    if (/noindex/.test(robots)) add('tech', 'critical', 'Page is set to noindex', `Robots meta: "${robots}". This page will be dropped from Google and Bing results.`, 'Remove noindex if the page should rank.', pref('robots'));
    if (/nosnippet|max-snippet\s*:\s*0/.test(robots)) add('tech', 'warning', 'Snippets are blocked', 'nosnippet or max-snippet:0 also stops the page being quoted in AI Overviews, AI Mode and Copilot answers.', 'Remove it unless you deliberately want no snippets.', pref('robots'));
    if (/noarchive|nocache/.test(robots)) add('tech', 'info', 'noarchive / nocache set', 'Bing uses these to limit how content is used in AI answers.', 'Keep only if intended.', pref('robots'));
    if (qa('[data-nosnippet]').length) add('tech', 'info', 'data-nosnippet in use', `${qa('[data-nosnippet]').length} element(s) are excluded from snippets and AI features.`, 'Check that key answers are not inside them.', pref('robots'));
    const canon = qa('link[rel="canonical" i]');
    if (!canon.length) add('tech', 'warning', 'No canonical tag', 'Without a canonical, duplicate URLs (parameters, http/https, trailing slash) can split signals.', 'Add <link rel="canonical" href="https://...">.', pref('canonical'));
    else if (canon.length > 1) add('tech', 'warning', 'Multiple canonical tags', 'Google ignores conflicting canonicals.', 'Keep exactly one.', pref('canonical'));
    else if (!/^https?:\/\//.test(canon[0].getAttribute('href') || '')) add('tech', 'info', 'Relative canonical URL', 'Absolute URLs are safer.', 'Use the full https:// URL.', pref('canonical'));
    if (!q('meta[name="viewport" i]')) add('tech', 'warning', 'No viewport meta tag', 'Google indexes the mobile version; without a viewport the page renders as desktop on phones.', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.', pref('mobile'));
    if (!(d.documentElement.getAttribute('lang') || '').trim()) add('tech', 'info', 'No lang attribute on <html>', 'Helps search engines and screen readers pick the language.', 'Add <html lang="en">.', pref('metaTags'));
    if (meta('keywords')) add('tech', 'info', 'Meta keywords tag present', 'Google ignores it, and it reveals your keyword list to competitors.', 'Remove it.', pref('metaTags'));
    const h1 = qa('h1'); if (h1.length !== 1) add('tech', 'warning', h1.length ? `${h1.length} <h1> elements` : 'No <h1> element', 'One clear H1 states the page topic.', 'Use exactly one H1.', pref('titles'));
    // Structured data
    const ld = qa('script[type="application/ld+json"]'); const types = [];
    ld.forEach((sc, i) => {
      let j; try { j = JSON.parse(sc.textContent); } catch (e) { add('tech', 'warning', `JSON-LD block ${i + 1} is invalid JSON`, e.message, 'Fix the syntax; test it in the Rich Results Test.', pref('sd')); return; }
      const nodes = [].concat(j['@graph'] || j); nodes.forEach(n => { const t = [].concat(n['@type'] || []); types.push(...t);
        if (t.includes('FAQPage')) add('tech', 'info', 'FAQPage markup no longer earns Google rich results', 'Google stopped showing FAQ rich results in May 2026. The markup is harmless and other engines may read it.', 'Keep or remove; do not expect FAQ snippets.', pref('faq'));
        if (t.includes('HowTo')) add('tech', 'info', 'HowTo markup has no Google rich result', 'Google removed HowTo rich results in 2023.', 'Optional to keep.', pref('faq'));
        if (t.some(x => /Article|BlogPosting|NewsArticle/.test(x)) && (!n.headline || !n.author || !n.datePublished)) add('tech', 'info', 'Article markup missing recommended fields', 'headline, author and datePublished help Google show bylines and dates correctly.', 'Add the missing properties.', [ref('Article structured data', KB.U.article)]);
        if ((n.aggregateRating || n.review) && t.some(x => /Organization|LocalBusiness/.test(x))) add('tech', 'warning', 'Self-serving review markup', 'Google does not show review stars for reviews a business publishes about itself, and fake or unseen ratings break structured data policy.', 'Remove rating markup unless it describes visible, genuine third-party reviews.', pref('sd'));
      });
    });
    metrics.schemaTypes = [...new Set(types)];
    if (!ld.length) add('tech', 'info', 'No structured data', 'Article, Organization, BreadcrumbList or Product markup helps search engines understand the page and unlocks rich results.', 'Add JSON-LD that matches visible content (see Suggestions for an Article template).', pref('sd'));
    // Social cards
    if (!q('meta[property="og:title"]') || !q('meta[property="og:image"]')) add('tech', 'info', 'Open Graph tags incomplete', 'og:title and og:image control how the page looks when shared on LinkedIn, Facebook and messaging apps.', 'Add og:title, og:description and og:image (1200x630).', []);
    // hreflang
    const hl = qa('link[rel="alternate" i][hreflang]'); if (hl.length && !hl.some(l => /x-default/i.test(l.getAttribute('hreflang')))) add('tech', 'info', 'hreflang without x-default', 'An x-default tells Google which version to show other languages.', 'Add hreflang="x-default".', pref('metaTags'));
    // Images
    const imgs = qa('img'); const noDim = imgs.filter(i => !i.getAttribute('width') || !i.getAttribute('height')); const noAlt = imgs.filter(i => !(i.getAttribute('alt') || '').trim() && i.getAttribute('role') !== 'presentation');
    if (noAlt.length) add('tech', 'warning', `${noAlt.length} image(s) without alt text`, 'Alt text helps image search, accessibility and AI understanding.', 'Describe each meaningful image.', pref('images'));
    if (noDim.length > 2) add('tech', 'info', `${noDim.length} image(s) without width and height`, 'Missing dimensions cause layout shift (CLS), a Core Web Vitals metric.', 'Add width and height attributes or CSS aspect-ratio.', pref('mobile'));
    if (imgs[0] && /lazy/i.test(imgs[0].getAttribute('loading') || '')) add('tech', 'info', 'First image is lazy-loaded', 'Lazy-loading the hero image delays Largest Contentful Paint.', 'Load the first image eagerly (fetchpriority="high").', pref('mobile'));
    // Links
    const badLinks = qa('a').filter(a => !a.getAttribute('href') || /^javascript:/i.test(a.getAttribute('href')));
    if (badLinks.length) add('tech', 'warning', `${badLinks.length} link(s) Google cannot follow`, 'Anchors without href or with javascript: URLs are not crawled.', 'Use <a href="real-url">.', pref('jsSeo'));
    const httpLinks = qa('a[href^="http:"], img[src^="http:"], script[src^="http:"]'); if (httpLinks.length) add('tech', 'info', `${httpLinks.length} insecure http:// reference(s)`, 'Mixed or insecure links can trigger browser warnings.', 'Switch to https://.', pref('mobile'));
    // Monetized-site hints (AdSense)
    if (/adsbygoogle|googlesyndication/.test(src)) { const words = window.CQ.wordsOf(d.body ? d.body.textContent : '').length; if (words < 300) add('tech', 'warning', 'Ads on a thin page', `Ad code found on a page with about ${words} words. AdSense requires valuable inventory, not pages built mainly for ads.`, 'Add substantial original content or remove ads from this page.', pref('adsense')); }
    if (/(popup|modal|interstitial|newsletter-overlay)/i.test(src) && /(display\s*:\s*block|show|open)/i.test(src)) add('tech', 'info', 'Possible pop-up or interstitial', 'Pop-ups that cover main content on load hurt page experience.', 'Delay them or keep them small.', [ref('Intrusive interstitials', KB.U.interstitials)]);
    const scripts = qa('script[src]').length; if (scripts > 25) add('tech', 'info', `${scripts} external scripts`, 'Heavy scripts slow Interaction to Next Paint.', 'Defer or remove unused scripts.', [ref('Core Web Vitals', KB.U.cwv)]);
    metrics.tech = T;
  }

  /* ------------------------------ brief mode (no body text yet) ------------------------------ */
  function brief(opts, key, T, metrics, m) {
    const kw = lc(opts.keyword).trim();
    let niche = 'generic', best = 0;
    for (const [k, tm] of Object.entries(KB.topicalMaps)) { const h = tm.triggers.filter(t => kw.includes(t)).length; if (h > best) { best = h; niche = k; } }
    const TM = KB.topicalMaps[niche];
    const policies = T.policies.map(id => KB.policies.find(p => p.id === id)).filter(Boolean);
    const outline = [];
    if (kw) {
      const K = titleCase(kw);
      if (T.fam === 'blog' || T.fam === 'review' || T.fam === 'guest') outline.push(`H1: ${K} (${YEAR} guide)`, 'Intro: hook (stat or question), quick answer in bold, one-line roadmap', 'TL;DR / Summary: 3 bullets', ...buildPAA(kw, niche).slice(0, 6).map(q => 'H2: ' + q), T.faq ? 'FAQs: exactly 5 PAA-style questions, direct first-sentence answers' : '', 'Closing: Bottom Line with a soft CTA and a risk reminder');
      else if (T.fam === 'news') outline.push(`H1: Will ${K} rise today?`, 'TL;DR', 'Summary: 3 one-line bullets, max 12 words', 'H2 (question) with bold driver mini-headings and sourced data', 'Technical Indicators: bold resistance and support', 'H2: What Should Traders Do Now? (4 bullets)');
      else if (T.fam === 'pr') outline.push(`Headline with a time-relevant keyword about ${kw}`, 'Dateline and lead: who, what, when, why it matters', '3-5 section headings with natural, time-relevant keywords', 'Spokesperson quote with name and title', 'About section (fresh angle)', 'Media contact exactly as supplied');
      else outline.push(`Lead with the main benefit of ${kw}`, 'One proof point (number with a source)', 'One clear call to action');
    }
    return {
      brief: true, overall: null, scores: {}, findings: [], metrics, model: m, opts, key, type: T.fam, typeLabel: T.label, cats: CATS, checkedAt: new Date().toISOString(),
      ai: { summary: { probability: null }, perSentence: [], phraseHits: [], signals: {}, labels: {} },
      suggestions: { titles: suggestTitles(kw, '', T.fam, false), descriptions: [], snippets: [], paa: kw ? buildPAA(kw, niche).map(q => ({ q, covered: 'no' })) : [], faqs: [], faqSchema: '', articleSchema: '', lsi: { niche: TM.label, present: [], missing: TM.terms, entPresent: [], entMissing: TM.entities.filter(e => !TM.terms.includes(e)), topTerms: [] }, internal: [], spot: [], voice: { score: 0, traits: KB.voice.traits.map(t => Object.assign({ ok: false }, t)), missing: [] }, unsourced: [], indirect: [] },
      plan: { outline: outline.filter(Boolean), policies, words: T.idealWords }
    };
  }

  /* ------------------------------ FAQ detection ------------------------------ */
  function detectFAQs(m) {
    const out = [];
    const idx = m.blocks.findIndex(b => /\b(faqs?|frequently asked|common questions|people also ask)\b/i.test(b.text) && (b.type === 'h' || b.boldOnly || b.text.length < 40));
    if (idx < 0) return out;
    const startLevel = m.blocks[idx].type === 'h' ? m.blocks[idx].level : 2;
    for (let i = idx + 1; i < m.blocks.length; i++) {
      const b = m.blocks[i];
      if (b.type === 'h' && b.level <= startLevel && !/\?\s*$/.test(b.text) && !/frequently asked|faq/i.test(b.text)) break;
      const isQ = (b.type === 'h' || b.boldOnly || (b.type === 'p' && b.text.length < 160)) && /\?\s*$/.test(b.text);
      if (isQ) {
        const ans = [];
        for (let j = i + 1; j < m.blocks.length; j++) {
          const n = m.blocks[j];
          if (n.type === 'h' || n.boldOnly || ((n.type === 'p') && /\?\s*$/.test(n.text) && n.text.length < 160)) break;
          ans.push(n.text);
        }
        out.push({ q: b.text.trim(), a: ans.join(' ').trim() });
      }
    }
    return out;
  }
  function directAnswer(q, a) {
    const first = splitSentences(a)[0] || '';
    if (/^(is|are|can|does|do|should|will|was|has|have|could|would)\b/i.test(q)) return /^(yes|no|not|it depends|absolutely|definitely|generally|usually|only)\b/i.test(first);
    return wordsOf(first).length <= 35;
  }

  /* ------------------------------ PAA ------------------------------ */
  const coreOf = kw => kw.trim().replace(/\s+(for (complete )?beginners|for dummies|guide|explained|tutorial|in 20\d\d|20\d\d)$/i, '').trim() || kw.trim();
  function buildPAA(kw, niche) {
    if (!kw) return [];
    const K = coreOf(kw);
    const vs = K.split(/\s+(?:vs\.?|versus|or)\s+/i);
    if (vs.length === 2) {
      const [a, b] = vs.map(s => s.trim());
      return [`What is the difference between ${a} and ${b}?`, `Which is better, ${a} or ${b}?`, `Is ${a} more profitable than ${b}?`, `Which is better for beginners, ${a} or ${b}?`, `Can you combine ${a} and ${b}?`, `What are the risks of ${a} vs ${b}?`, `How much money do you need for ${a}?`, `What is the success rate of ${a}?`];
    }
    if (/^best\s+/i.test(K)) {
      const x = K.replace(/^best\s+/i, '');
      return [`What is the best ${x}?`, `How do you choose the right ${x}?`, `Are cheap ${x} good enough?`, `What ${x} do professionals use?`, `What features matter most in ${x}?`, `Is it worth paying more for ${x}?`, `What are common mistakes when choosing ${x}?`];
    }
    if (/^how to\s+/i.test(K)) {
      const x = K.replace(/^how to\s+/i, '');
      return [`How do you ${x} step by step?`, `What do you need to ${x}?`, `How long does it take to ${x}?`, `Can beginners ${x}?`, `What are common mistakes when you ${x}?`, `Is it risky to ${x}?`];
    }
    const base = [`What is ${K}?`, `How does ${K} work?`, `Is ${K} profitable?`, `Is ${K} good for beginners?`, `What are the risks of ${K}?`, `How do you start with ${K}?`, `What is the best ${K} strategy?`, `How much money do you need for ${K}?`];
    if (niche === 'signals') base.push(`Are ${K} legit?`, `Are free ${K} worth it?`);
    if (niche === 'crypto') base.push(`Is ${K} legal?`);
    return base;
  }
  function coverageOf(q, kw, headings, m, faqs) {
    const qt = contentWords(q).filter(t => !['best', 'good', 'need', 'work', 'start'].includes(t));
    const score = text => { const l = lc(text); return qt.length ? qt.filter(t => l.includes(t.replace(/s$/, ''))).length / qt.length : 0; };
    const hs = headings.map(h => score(h.text)).concat(faqs.map(f => score(f.q)));
    const best = Math.max(0, ...hs);
    if (best >= 0.75) return 'yes';
    if (best >= 0.5) return 'partial';
    return 'no';
  }

  /* ------------------------------ AI detection ------------------------------ */
  function aiDetect(m, sensitivity) {
    const sents = m.sentences.map(s => s.text).filter(s => wordsOf(s).length > 2);
    const lens = sents.map(s => wordsOf(s).length);
    const wc = Math.max(1, m.words.length);
    const per1k = n => n / wc * 1000;
    const text = m.allText;
    const phraseHits = hitList(text, L.aiPhrases).sort((a, b) => b.count - a.count);
    const vocabHits = hitList(text, L.llmVocab);
    const phraseN = phraseHits.reduce((s, h) => s + h.count, 0);
    const vocabN = vocabHits.reduce((s, h) => s + h.count, 0);
    const trStarts = sents.filter(s => L.transitions.some(t => lc(s).startsWith(t))).length;
    const contractions = (norm(text).match(/\b\w+'(s|re|ve|ll|d|t|m)\b/gi) || []).length;
    const emd = (text.match(/—/g) || []).length;
    const triads = (text.match(/\b\w+(?:\s\w+)?,\s\w+(?:\s\w+)?,?\s(?:and|or)\s\w+/g) || []).length;
    const notJust = (lc(text).match(/\bnot (just|only|merely)\b|\bit'?s not\b[^.]{0,40}\bit'?s\b|\bmore than just\b/g) || []).length;
    const paraLens = m.paragraphs.map(p => wordsOf(p.text).length).filter(n => n > 5);
    const nums = (text.match(/\b\d[\d,.]*%?/g) || []).length;
    const named = (text.match(/(?<![.!?]\s)(?<!^)\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\b/g) || []).length;
    const expN = hitList(text, L.experience).reduce((s, h) => s + h.count, 0);
    const qmarks = (text.match(/\?/g) || []).length, excl = (text.match(/!/g) || []).length;
    const starters = {}; sents.forEach(s => { const w = (wordsOf(s)[0] || ''); starters[w] = (starters[w] || 0) + 1; });
    const topStarterShare = sents.length ? Math.max(0, ...Object.values(starters)) / sents.length : 0;

    const sig = {
      burstiness: clamp((0.62 - cv(lens)) / 0.34),
      phrases: clamp(per1k(phraseN) / 9),
      vocab: clamp((per1k(vocabN) - 3) / 14),
      transitions: clamp((sents.length ? trStarts / sents.length : 0) / 0.14),
      contractions: clamp((1.0 - contractions / wc * 100) / 1.0) * 0.8,
      emdash: clamp(per1k(emd) / 5),
      triads: clamp(per1k(triads) / 7),
      frames: clamp(per1k(notJust) / 3),
      uniformity: paraLens.length > 3 ? clamp((0.5 - cv(paraLens)) / 0.32) : 0.3,
      starters: clamp((topStarterShare - 0.12) / 0.2)
    };
    const W = { burstiness: 1.3, phrases: 1.6, vocab: 1.0, transitions: 0.9, contractions: 0.6, emdash: 0.7, triads: 0.6, frames: 0.6, uniformity: 0.7, starters: 0.4 };
    let num = 0, den = 0; for (const k in W) { num += sig[k] * W[k]; den += W[k]; }
    const specificity = +(((nums + expN * 2 + Math.min(named, wc / 12)) / wc) * 100 / 1.6).toFixed(1);
    const human = clamp(specificity / 4) * 0.22 + clamp((qmarks + excl) / Math.max(1, sents.length) / 0.12) * 0.08 + clamp(expN / 4) * 0.1;
    const shift = sensitivity === 'strict' ? 0.08 : sensitivity === 'lenient' ? -0.08 : 0;
    const raw = clamp(num / den - human + 0.12 + shift);
    const probability = Math.round(clamp(1 / (1 + Math.exp(-9 * (raw - 0.42)))) * 100);

    // Per-sentence scores
    const perSentence = m.sentences.map(s => {
      const t = s.text, l = lc(t), n = wordsOf(t).length;
      let sc = 0.18;
      const ph = L.aiPhrases.filter(p => (' ' + l + ' ').match(new RegExp('(^|[^a-z0-9])' + reEsc(p) + '(?=$|[^a-z0-9])'))).length;
      sc += ph * 0.22;
      sc += L.llmVocab.filter(p => l.includes(p)).length * 0.07;
      if (L.transitions.some(x => l.startsWith(x))) sc += 0.15;
      if (/—/.test(t)) sc += 0.12;
      if (/\bnot (just|only)\b|more than just/.test(l)) sc += 0.12;
      if (/\b\w+,\s\w+,?\s(and|or)\s\w+/.test(t)) sc += 0.06;
      if (n >= 17 && n <= 30 && !/\d/.test(t)) sc += 0.1;
      if (/\d/.test(t)) sc -= 0.12;
      if (/[?!]$/.test(t)) sc -= 0.08;
      if (/\b\w+'(s|re|ve|ll|d|t|m)\b/i.test(t)) sc -= 0.08;
      if (L.experience.some(x => l.includes(x))) sc -= 0.15;
      if (n < 7) sc -= 0.08;
      if (sensitivity === 'strict') sc += 0.05; if (sensitivity === 'lenient') sc -= 0.05;
      return { text: t, block: s.block, score: +clamp(sc).toFixed(2) };
    });
    const flagged = perSentence.filter(s => s.score >= 0.55).length;
    const labels = { burstiness: 'uniform sentence lengths (low burstiness)', phrases: 'stock LLM phrases', vocab: 'LLM-favoured vocabulary', transitions: 'sentences opening with formal transitions', contractions: 'few contractions', emdash: 'em dashes', triads: 'rule-of-three lists', frames: '"not just X, but Y" frames', uniformity: 'uniform paragraph sizes', starters: 'repetitive sentence starts' };
    const topSignals = Object.entries(sig).filter(([, v]) => v >= 0.5).sort((a, b) => b[1] * W[b[0]] - a[1] * W[a[0]]).slice(0, 4).map(([k]) => labels[k]);
    return {
      phraseHits, vocabHits, perSentence, signals: sig, weights: W, labels,
      summary: { probability, verdict: probability >= 65 ? 'Likely AI' : probability >= 40 ? 'Mixed' : 'Likely human', flaggedSentences: flagged, totalSentences: perSentence.length, burstinessCV: +cv(lens).toFixed(2), contractionsPer100: +(contractions / wc * 100).toFixed(2), specificity, topSignals }
    };
  }

  /* ------------------------------ originality helpers ------------------------------ */
  function shingles(s, k = 3) { const w = contentWords(s); const out = new Set(); for (let i = 0; i <= w.length - k; i++) out.add(w.slice(i, i + k).join(' ')); return out; }
  function internalDuplicates(sents) {
    const sh = sents.map(s => shingles(s));
    const pairs = [];
    for (let i = 0; i < sents.length; i++) for (let j = i + 1; j < sents.length; j++) {
      const a = sh[i], b = sh[j]; if (a.size < 3 || b.size < 3) continue;
      let inter = 0; a.forEach(x => { if (b.has(x)) inter++; });
      const jac = inter / (a.size + b.size - inter);
      if (jac >= 0.5) pairs.push([sents[i], sents[j], +jac.toFixed(2)]);
      if (pairs.length > 12) return pairs;
    }
    return pairs;
  }
  function spotCheck(sents) {
    return sents.map(s => ({ s, w: s.split(/\s+/), cw: contentWords(s).length }))
      .filter(x => x.w.length >= 14 && x.w.length <= 40 && x.cw >= 6 && !/https?:/.test(x.s))
      .sort((a, b) => b.cw / b.w.length - a.cw / a.w.length).slice(0, 6)
      .map(x => { const start = Math.max(0, Math.floor(x.w.length / 2) - 5); const frag = x.w.slice(start, start + 10).join(' ').replace(/["“”]/g, '').replace(/[,.;:!?]+$/, ''); return { sentence: x.s, fragment: frag, url: 'https://www.google.com/search?q=' + encodeURIComponent('"' + frag + '"') }; });
  }
  function proofread(text) {
    const out = [];
    const t = norm(text);
    (t.match(/\b(\w+)\s+\1\b/gi) || []).filter(x => !/^(that that|had had|is is)$/i.test(x) || true).filter(x => !/\d/.test(x)).slice(0, 5).forEach(x => out.push({ text: x, msg: `repeated word "${x}"` }));
    (t.match(/\w[,;:](?=[A-Za-z])/g) || []).filter(x => !/\d/.test(x)).slice(0, 4).forEach(x => out.push({ text: x, msg: `missing space after punctuation "${x}"` }));
    (t.match(/[a-z]\.(?=[A-Z][a-z])/g) || []).slice(0, 4).forEach(x => out.push({ text: x, msg: `missing space after period "${x}"` }));
    (t.match(/\w\s+[,.;:!?](?!\d)/g) || []).slice(0, 4).forEach(x => out.push({ text: x, msg: `space before punctuation "${x}"` }));
    (t.match(/[a-z]\[[a-z]|[a-z]\][a-z]/gi) || []).slice(0, 3).forEach(x => out.push({ text: x, msg: `stray bracket "${x}"` }));
    (t.match(/  +/g) || []).length > 3 && out.push({ text: '  ', msg: 'double spaces' });
    (t.match(/(?:^|[.!?]\s+)([a-z][a-z]+)\b/g) || []).filter(x => !/^\W*(e\.g|i\.e|etc|vs|iphone|ebay)/i.test(x.trim())).slice(0, 3).forEach(x => out.push({ text: x.trim(), msg: `sentence starts lowercase "${x.trim()}"` }));
    (t.match(/\s[i]\s/g) || []).length && out.push({ text: ' i ', msg: 'lowercase "i"' });
    return out;
  }

  /* ------------------------------ voice match ------------------------------ */
  function voiceMatch(m, headings, faqs, exp, attrib, hasSummary) {
    const V = KB.voice; const res = [];
    const firstParas = m.blocks.filter(b => b.type === 'p').slice(0, 4).map(b => b.text).join(' ');
    const h2 = headings.filter(h => h.level === 2);
    const qShare = h2.length ? h2.filter(h => /\?\s*$|^(what|how|why|can|is|are|does|which|should)\b/i.test(h.text)).length / h2.length : 0;
    const directOK = m.sections.filter(s => s.heading).map(s => (s.blocks.find(b => b.type === 'p') || {}).text || '').filter(Boolean);
    const directShare = directOK.length ? directOK.filter(t => wordsOf(splitSentences(t)[0] || '').length <= 32 && !/^(so|and|but|also|well)\b/i.test(t)).length / directOK.length : 0;
    const youN = (lc(m.allText).match(/\byou(r)?\b/g) || []).length;
    const conn = V.connectors.filter(c => lc(m.allText).includes(c)).length;
    const paraS = m.paragraphs.map(p => splitSentences(p.text).length);
    const t = {
      summaryTop: hasSummary,
      hook: /\d|\?/.test((m.sentences[0] || {}).text || '') || /\b(like|imagine|assume|think of)\b/i.test((m.sentences[0] || {}).text || ''),
      quickAnswer: /\b(the (key|main|quick|short) (difference|answer)|the answer is|simply put|in short|the quick answer|yes,|no,)\b/i.test(firstParas) || m.boldCount > 0 && /\b(is|are)\b/.test(firstParas),
      roadmap: /\b(in this (guide|blog|article|post)|we('| wi)ll (break|walk|cover|show)|let'?s (dive|see|learn|find)|here'?s (what|how))\b/i.test(firstParas),
      questionH2: qShare >= 0.4,
      directAnswers: directShare >= 0.6,
      namedSources: attrib.length >= 2,
      examples: /\bfor example\b|\bfor instance\b|\be\.g\./i.test(m.allText),
      secondPerson: youN / Math.max(1, m.words.length) > 0.008,
      connectors: conn >= 3,
      bold: m.boldCount >= 3,
      shortParas: paraS.length ? paraS.filter(n => n <= 3).length / paraS.length >= 0.8 : false,
      closing: headings.some(h => V.closings.some(c => lc(h.text).includes(c))),
      faqDirect: faqs.length ? faqs.filter(f => directAnswer(f.q, f.a)).length / faqs.length >= 0.6 : false
    };
    V.traits.forEach(tr => res.push(Object.assign({}, tr, { ok: !!t[tr.test] })));
    const score = Math.round(res.filter(r => r.ok).length / res.length * 100);
    return { score, traits: res, missing: res.filter(r => !r.ok) };
  }

  /* ------------------------------ suggestions ------------------------------ */
  function suggestTitles(kw, h1, type, hasExp) {
    if (!kw) return [];
    const K = titleCase(kw), C = titleCase(coreOf(kw));
    const out = [];
    const vs = kw.split(/\s+(?:vs\.?|versus)\s+/i);
    if (vs.length === 2) { const [a, b] = vs.map(titleCase); out.push(`${a} vs ${b}: Key Differences and Which to Pick`, `${a} vs ${b} in ${YEAR}: Which Suits You?`, `${a} or ${b}? Pros, Cons and Best Uses`); }
    else if (/^best /i.test(kw)) out.push(`${K} in ${YEAR}: ${hasExp ? 'Tested' : 'Compared'} for Every Budget`, `${K}: ${YEAR} Buying Guide for Traders`, `How to Pick the ${K} (${YEAR})`);
    else if (/^how to /i.test(kw)) out.push(`${K}: Step-by-Step Guide (${YEAR})`, `${K} for Beginners: A Simple ${YEAR} Guide`, `${K} Without Costly Mistakes`);
    else if (type === 'news') out.push(`Will ${K} Rise Today? What Traders Should Watch`, `${K} Today: Key Drivers and Levels to Watch`);
    else if (type === 'pr') out.push(`[Brand] Launches ${K} for Traders in ${YEAR}`, `[Brand] Unveils ${K}: What It Means for Traders`);
    else out.push(`What Is ${C}? A Beginner's Guide (${YEAR})`, `${C} Explained: How It Works, Risks and Tips`, `${C} for Beginners: ${YEAR} Guide with Examples`);
    if (h1 && h1.length <= 62) out.unshift(h1);
    return [...new Set(out)].map(t => ({ text: t, len: t.length, ok: t.length >= 30 && t.length <= 60 }));
  }
  function suggestDescriptions(kw, m, h2s) {
    if (!kw) return [];
    const first = (m.sentences.find(s => countPhrase(s.text, kw) || contentWords(kw).every(t => lc(s.text).includes(t))) || m.sentences[0] || { text: '' }).text;
    const topics = h2s.slice(0, 3).map(h => lc(h.text).replace(/[?:]/g, '').replace(/^(what is|what are|how to|how does|is|can|why)\s+/, '').trim()).filter(Boolean);
    const clip = (s, n = 155) => s.length <= n ? s : s.slice(0, s.lastIndexOf(' ', n - 1)).replace(/[,;:]$/, '') + '.';
    const a = clip(first.replace(/\*\*/g, ''));
    const b = clip(`Learn ${kw}: ${topics.slice(0, 2).join(', ')}${topics.length ? ' and more' : ''}. Clear examples, risks and tips for beginners.`);
    const c = clip(`${titleCase(kw)} explained in plain English. See how it works, the risks to watch and practical steps to start in ${YEAR}.`);
    return [a, b, c].filter(x => x.length > 40).map(t => ({ text: t, len: t.length, ok: t.length >= 120 && t.length <= 160 }));
  }
  function faqSchema(faqs) {
    if (!faqs.length) return '';
    return JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.filter(f => f.a).map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }, null, 2);
  }
  function articleSchema(opts, title, kw, wc) {
    const today = new Date().toISOString().slice(0, 10);
    const o = { '@context': 'https://schema.org', '@type': /news/.test(opts.type) ? 'NewsArticle' : 'Article', headline: title || titleCase(kw), description: opts.metaDesc || undefined, author: opts.author ? { '@type': 'Person', name: opts.author } : undefined, datePublished: today, dateModified: today, wordCount: wc };
    if (opts.domain) o.publisher = { '@type': 'Organization', name: opts.domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('.')[0], url: 'https://' + opts.domain.replace(/^https?:\/\//, '').replace(/\/$/, '') };
    return JSON.stringify(o, null, 2);
  }
  const GENERIC = new Set('day,days,time,times,way,ways,thing,things,lot,lots,people,part,year,years,week,weeks,month,months,minute,minutes,second,seconds,hour,hours,style,styles,move,moves,suit,suits,last,want,wants,hold,holds,catch,fit,fits,decide,keep,make,makes,made,get,gets,got,take,takes,need,needs,help,helps,work,works,start,starts,use,uses,good,better,best,great,new,many,much,more,most,less,also,well,just,like,each,every,other,others,first,one,two,three,example,guide,today,mean,means,based'.split(','));
  function topTerms(m) {
    const f = {};
    const ok = w => w && !STOP.has(w) && !GENERIC.has(w) && w.length > 2 && !/^\d/.test(w);
    m.blocks.filter(b => b.type !== 'h').forEach(b => {
      (b.items || [b.text]).forEach(t => splitSentences(t).forEach(sn => {
        sn.split(/[,;:()]/).forEach(part => {
          const w = wordsOf(part);
          for (let i = 0; i < w.length; i++) { if (ok(w[i])) f[w[i]] = (f[w[i]] || 0) + 1; if (i < w.length - 1 && ok(w[i]) && ok(w[i + 1])) { const g = w[i] + ' ' + w[i + 1]; f[g] = (f[g] || 0) + 1.6; } }
        });
      }));
    });
    return Object.entries(f).filter(([k, v]) => v >= 3).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => ({ term: k, count: Math.round(v / (k.includes(' ') ? 1.6 : 1)) }));
  }
  function internalIdeas(m, headings, kw, host, topical) {
    const ideas = [], seen = new Set([lc(kw)]);
    const linked = new Set(m.links.map(l => lc(l.text)));
    const kwT = contentWords(kw);
    const target = p => host ? `${host} page about "${p}"` : `your page about "${p}"`;
    headings.filter(h => h.level >= 2 && !/\b(faqs?|frequently asked|final|bottom line|conclusion|wrap|pros and cons|summary|tl;?dr|key takeaways?)\b/i.test(h.text)).forEach(h => {
      const phrase = lc(h.text).replace(/[?:!.]/g, '').replace(/^(what is|what are|how to|how does|is|are|can|why|which is|the|best)\s+/g, '').replace(/\s+(work|works|for beginners|in \d{4}|explained)$/g, '').trim();
      const w = phrase.split(/\s+/);
      const meaningful = kwT.some(t => phrase.includes(t)) || topical.some(t => phrase.includes(t.toLowerCase()));
      if (meaningful && w.length >= 2 && w.length <= 5 && !seen.has(phrase) && !linked.has(phrase)) { seen.add(phrase); ideas.push({ anchor: phrase, where: h.text, target: target(phrase) }); }
    });
    topical.forEach(t => {
      const tl = t.toLowerCase();
      if (ideas.length >= 10 || seen.has(tl) || linked.has(tl)) return;
      const sent = m.sentences.find(s => countPhrase(s.text, tl));
      if (sent) { seen.add(tl); ideas.push({ anchor: tl, where: trimWords(sent.text, 8), target: target(tl) }); }
    });
    return ideas.slice(0, 10);
  }

  window.CQ = { analyze, buildModel, toHTML, mdToHTML, splitSentences, wordsOf, CATS, esc, trimWords, titleCase, aiDetect };
})();
