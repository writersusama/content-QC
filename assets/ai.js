/* =========================================================================
   Content QC: optional AI models (all free-tier friendly)
   Providers: none (local engine only), Gemini (free key from Google AI Studio),
   any OpenAI-compatible endpoint (OpenRouter free models, Groq, local LM Studio),
   or the server proxy (/api/llm) that keeps a Gemini key in an env variable.
   ========================================================================= */
(function () {
  const S = () => window.CQSettings.get();

  // Privacy: a personal key (Gemini or OpenAI-compatible) is sent ONLY from this browser to that provider.
  // It is never included in requests to this site's own /api endpoints.
  async function call(prompt, { json = false, temperature = 0.4, search = false, withSources = false } = {}) {
    const s = S();
    if (s.provider === 'none') throw new Error('No AI model connected. Open Settings to add a free Gemini key (or use the server proxy).');
    if (s.provider === 'server') {
      const r = await fetch('/api/llm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, json, search, model: s.model || undefined, accessCode: s.accessCode || undefined }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Server AI proxy failed (' + r.status + ')');
      return withSources ? { text: j.text, sources: j.sources || [] } : j.text;
    }
    if (!s.apiKey) throw new Error('Add your API key in Settings.');
    if (s.provider === 'gemini') {
      const model = s.model || 'gemini-2.5-flash';
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': s.apiKey },
        body: JSON.stringify(Object.assign({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: Object.assign({ temperature }, json && !search ? { responseMimeType: 'application/json' } : {}) }, search ? { tools: [{ google_search: {} }] } : {}))
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && j.error.message) || 'Gemini request failed (' + r.status + ')');
      const cand = (j.candidates || [])[0] || {};
      const text = (cand.content || {}).parts?.map(p => p.text).join('') || '';
      if (!withSources) return text;
      return { text, sources: ((cand.groundingMetadata || {}).groundingChunks || []).map(c => c.web).filter(Boolean).map(w => ({ title: w.title, url: w.uri })) };
    }
    // OpenAI-compatible
    if (search) throw new Error('Google Search grounding needs a Gemini key (or the server proxy). Switch the provider to Gemini in Settings.');
    const base = (s.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    const r = await fetch(base + '/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + s.apiKey },
      body: JSON.stringify(Object.assign({ model: s.model, temperature, messages: [{ role: 'user', content: prompt }] }, json ? { response_format: { type: 'json_object' } } : {}))
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || 'Request failed (' + r.status + ')');
    return ((j.choices || [])[0] || {}).message?.content || '';
  }

  async function listModels() {
    const s = S();
    if (s.provider === 'gemini') {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': s.apiKey } });
      const j = await r.json();
      if (!r.ok) throw new Error((j.error && j.error.message) || 'Could not list models');
      return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''));
    }
    if (s.provider === 'openai') {
      const base = (s.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
      const r = await fetch(base + '/models', { headers: s.apiKey ? { authorization: 'Bearer ' + s.apiKey } : {} });
      const j = await r.json();
      const ids = (j.data || []).map(m => m.id);
      const free = ids.filter(id => /:free$/.test(id));
      return free.length ? free.concat(ids.filter(i => !free.includes(i))) : ids;
    }
    return [];
  }

  function parseJSON(t) {
    const s = String(t || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    try { return JSON.parse(s); } catch (e) { const m = s.match(/\{[\s\S]*\}/); if (m) try { return JSON.parse(m[0]); } catch (e2) { } }
    return null;
  }

  const RULES = 'Rules: never use em dashes (use commas, colons, parentheses or new sentences). Keep the article\'s spelling variant. Do not invent statistics, sources, quotes, or results; if a number needs a source, say "[needs source]" in your notes, not in the copy. No guaranteed-profit language. Write for complete beginners while sounding like a finance expert.';

  function policyDigest(type) {
    const K = window.KB;
    const ids = (K.typeRules[type] || K.typeRules.blog).policies;
    return K.policies.filter(p => ids.includes(p.id) || ['helpful', 'scaled', 'ymyl'].includes(p.id)).map(p => `- ${p.title}: ${p.summary} (${p.url})`).join('\n');
  }

  const tasks = {
    detect: {
      label: 'Second-opinion AI detection', json: true,
      prompt: (r) => `You are an AI-text forensic reviewer that works like GPTZero, Originality.ai and Copyleaks combined: judge perplexity (predictability), burstiness (variation in sentence length and structure), stock LLM phrasing, generic claims and lack of specifics. Analyse the article below.
Return JSON only: {"ai_probability": 0-100, "verdict": "Likely human|Mixed|Likely AI", "reasons": ["..."], "sentences_to_revise": [{"sentence": "exact sentence", "why": "..."}] } with at most 8 sentences.
ARTICLE:
"""${r.model.allText.slice(0, 24000)}"""`
    },
    humanize: {
      label: 'Humanize in my voice', json: false,
      prompt: (r, sel) => `Rewrite the text below in the author's voice. ${window.KB.voice.llmPrompt}
${RULES}
Keep every fact, number, link target and heading meaning. Keep it about the same length. Return only the rewritten text in Markdown.
TEXT:
"""${(sel || r.ai.perSentence.filter(s => s.score >= 0.5).map(s => s.text).join('\n') || r.model.allText).slice(0, 16000)}"""`
    },
    meta: {
      label: 'Title tags and meta descriptions', json: true,
      prompt: (r) => `Write SEO metadata for this ${r.typeLabel.toLowerCase()} targeting "${r.metrics.keyword}". Google title link and snippet guidance: unique, descriptive, front-load the topic, no clickbait, titles about 50-60 characters, descriptions about 140-155 characters that answer the query and invite the click. ${RULES}
Return JSON: {"titles": ["...","...","..."], "descriptions": ["...","...","..."], "slug": "..."}.
ARTICLE START:
"""${r.model.allText.slice(0, 9000)}"""`
    },
    snippets: {
      label: 'Snippet summaries per heading', json: true,
      prompt: (r) => `For each H2/H3 below, write a 2-3 line snippet-style summary (35-55 words) that directly answers the heading in its first sentence, names the subject (no leading pronoun), and could be lifted into a featured snippet or AI Overview. Base it only on the article. ${RULES}
Return JSON: {"items":[{"heading":"...","summary":"..."}]}.
HEADINGS: ${r.model.blocks.filter(b => b.type === 'h' && b.level >= 2).map(b => b.text).slice(0, 30).join(' | ')}
ARTICLE:
"""${r.model.allText.slice(0, 22000)}"""`
    },
    faq: {
      label: '5 PAA-style FAQs with answers', json: true,
      prompt: (r) => `Write exactly 5 FAQs for this article targeting "${r.metrics.keyword}". Questions must read like Google People Also Ask queries, Title Case. Each answer: direct answer in the first sentence (Yes/No for yes-no questions), then 1-2 supporting sentences, 40-60 words, consistent with the article. Prefer questions the article does not already answer. ${RULES}
Return JSON: {"faqs":[{"q":"...","a":"..."}]}.
ARTICLE:
"""${r.model.allText.slice(0, 20000)}"""`
    },
    policy: {
      label: 'Policy and E-E-A-T review', json: true,
      prompt: (r) => `You are a Google Search quality reviewer. Review this ${r.typeLabel.toLowerCase()} against the policies below and the Search Quality Rater Guidelines (YMYL finance). Flag only real conflicts. For each issue give the exact quote, the policy it conflicts with, a logical reason, a concrete fix and the reference URL from the list.
POLICIES:
${policyDigest(r.key || r.type)}
Return JSON: {"issues":[{"quote":"...","policy":"...","reason":"...","fix":"...","url":"..."}],"strengths":["..."]}.
ARTICLE:
"""${r.model.allText.slice(0, 24000)}"""`
    },
    facts: {
      label: 'Claims that need a source', json: true,
      prompt: (r) => `List factual claims in this article that a careful finance editor would need to verify or source (statistics, performance numbers, regulatory statements, dates, product specs). For each, suggest the type of primary source to cite (for example CFTC, BIS Triennial Survey, the company\'s own filing). Do not invent URLs.
Return JSON: {"claims":[{"claim":"...","risk":"high|medium|low","source_to_find":"..."}]}.
ARTICLE:
"""${r.model.allText.slice(0, 24000)}"""`
    }
  };

  window.CQAI = { call, listModels, parseJSON, tasks };
})();
