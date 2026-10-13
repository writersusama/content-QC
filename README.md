# Content QC

**content quality checker**

Content QC checks hand-written content (blogs, market news, press releases, guest posts, landing pages, reviews and social posts) against Google's spam policies, helpful content guidance, Search Quality Rater Guidelines (E-E-A-T and YMYL), Google's documented ranking systems and related Google patents. Every finding explains the conflict, gives a fix and links to the official source.

It costs nothing to run. All checks happen in the browser. The optional backend is three tiny serverless functions that fit inside Netlify's or Render's free tier.

## Who it is for

Pick a role on the Check page to jump to the right copy types (61 in total):

- **Writers and SEOs:** blogs, pillar pages, how-tos, listicles, comparisons, reviews, glossary and FAQ pages, guest posts, title tags and meta descriptions
- **Website owners and developers:** full page HTML source (technical SEO), landing, home, service, product, category, pricing, About and local pages, help articles
- **Advertisers (PPC):** Search ads, Performance Max and Demand Gen assets, responsive display ads, social ads, YouTube ad scripts, Merchant Center product titles and descriptions
- **YouTube and video teams:** titles and descriptions, Shorts, scripts, show notes
- **Email marketers:** newsletters, promotional, welcome, transactional and cold emails
- **Social, PR and app teams:** LinkedIn, X, captions, forum answers, Business Profile text, press releases, news, sponsored posts, Google Play and marketplace listings

## Policy sources covered

Google Search (spam policies, helpful content, AI features, ranking systems, Quality Rater Guidelines), Google Ads (editorial, misrepresentation, restricted content, destination requirements, financial services, healthcare), YouTube (spam and scams, advertiser-friendly, reused and inauthentic content, paid promotion and AI disclosure), Merchant Center, Google Business Profile, Google Play metadata, Google Publisher Policies (AdSense), Gmail sender guidelines, CAN-SPAM, Bing Webmaster Guidelines (including GEO and prompt injection) and FTC disclosure rules.

The Doin Tech house style (no em dashes, lists of 4 or 6, exactly 5 FAQs, SSF news format, voice match) is a separate rule set. Switch it off in Settings for search-engine standards only.

## Domain fit (is this content right for that website?)

Type a domain in "Target website" on the Check page (for example your own site, a client's site or a guest-post host). Content QC reads the site's homepage, navigation, robots.txt, sitemaps and RSS feed, then shows:

- a fit score and verdict (strong, partial or off-topic) with the topics the site already covers and the ones that are new to it
- keyword cannibalization: existing pages on the same topic, with their URLs
- internal links to add, using real URLs from the site
- niche and YMYL alignment, language mismatch, publishing freshness, duplicate headlines, brand mentions
- for guest posts, a site reputation policy warning when the topic does not match the host

Site reads go through `/api/site` on Netlify, Vercel or Render (only that domain's homepage, robots.txt, sitemaps and feed are fetched) and are cached in the browser for 24 hours. On GitHub Pages they fall back to public proxies.

## Automatic Google watch

While Content QC is open it re-reads Google's official change logs every 30 minutes: the Search Status Dashboard, the Search Central documentation updates feed (where new and changed policies appear), the Search Central Blog, plus Google patent and research coverage. New items since your last visit get a green dot, and if Google changes a page that Content QC's rule book relies on, the Pulse panel, Live Sources and the Policy Library flag it.

"Scan Google Search" in Live Sources asks Gemini with Grounding with Google Search to look for anything the feeds missed (policy changes across Search, Ads, YouTube, Merchant Center, Business Profile, Play, AdSense and Bing, and new Google patents), with source links. This is Google's official way to search; scraping Google result pages is against its spam policies. It uses your own Gemini key or the server proxy, within Google's grounding quota.

## What it checks

- **Google policy compliance:** keyword stuffing, link spam (optimized anchors in guest posts and press releases), unqualified paid links, site reputation policy, thin affiliation, hidden text, clickbait, guaranteed-return claims, scaled-content patterns
- **SEO and structure:** H1 and heading hierarchy, keyword placement and density, title tag and meta description, internal and external links, anchor text, image alt text, slug, semantic coverage (related concepts and entities for forex, gold, crypto, indices, stocks and signals)
- **SERP dominance:** lists, scannability, wall-of-text paragraphs, TL;DR, snippet-ready section openings, plus a 2 to 3 line snippet summary for every H2
- **AEO:** question headings, direct answers, FAQ detection and quality, People Also Ask coverage
- **AIO / AI Overviews and LLM-readiness:** early definitions, attributable fact sentences, sub-question coverage, readability, pronoun-led sections, entity continuity
- **E-E-A-T and trust:** first-hand experience, citations, unsourced statistics, performance claims, risk statement, byline (including Google's Oct 2026 warning about fake author profiles), outdated years
- **AI-content signals:** a local detector modelled on how GPTZero, ZeroGPT, Originality, Copyleaks and QuillBot work (burstiness, LLM phrases and vocabulary, transitions, contractions, em dashes, rule-of-three, uniformity), with per-sentence highlighting
- **Originality and spin:** tortured (spun) phrases, near-duplicate sentences, information-gain density, and Copyscape-style exact-match Google spot-check links
- **Ads, YouTube, Merchant, Play and email rules:** character limits per format, capitalization and symbols, unverified superlatives, health, gambling, alcohol, political and counterfeit claims, fake urgency, hidden "free" conditions, false Google endorsements, guaranteed-ranking claims, hashtag limits, engagement bait, paid promotion and AI disclosure, CAN-SPAM address and opt-out
- **Technical SEO (paste page HTML or import a URL):** title and meta tags, noindex and snippet blocking (including AI Overviews), canonical, viewport, lang, H1, JSON-LD validity and deprecated or self-serving markup, Open Graph, hreflang, image alt and dimensions, uncrawlable links, insecure references, ads on thin pages, pop-ups and script weight
- **Voice and house style:** match against your published articles plus your rules (no em dashes, lists of 4 or 6, exactly 5 FAQs, no tables, bite-size paragraphs, PR and SSF news formats)

The **Google Pulse** panel shows ranking updates from the Search Status Dashboard, the Search Central Blog, Search Engine Roundtable and Search Engine Journal, and a "Most discussed" view of topics covered across several outlets. **Live Sources** reads official Google docs in-app and tells you when a page changed since your last visit.

## Deploy for free

### Option 1: Netlify (recommended)

1. Create a free account at netlify.com.
2. Easiest: drag the whole `content-qc` folder onto the Netlify "Deploy manually" area. Better: push the folder to a GitHub repo, then "Add new site, Import from Git". With Git, every push redeploys.
3. Netlify detects `netlify.toml` and deploys the site plus the functions `/api/feeds`, `/api/page` and `/api/llm`.
4. Optional environment variables (Site configuration, Environment variables):
   - `GEMINI_API_KEY`: optional shared team key for the "Server proxy" mode (visitors can always use their own key instead)
   - `ACCESS_CODE`: required whenever `GEMINI_API_KEY` is set; the proxy stays locked without it
   - `EXTRA_HOSTS`: extra domains the URL importer may read, comma separated
   - `GEMINI_MODEL`: override the default model

Note: drag-and-drop deploys include the functions only if you use the Netlify CLI (`npx netlify deploy --prod`). For drag-and-drop without the CLI, the app still works: feeds fall back to public proxies.

### Option 1b: Vercel (Hobby plan, free for personal, non-commercial use)

1. Push the folder to a GitHub repo (same as Netlify Step 1).
2. In Vercel, Add New, Project, import the repo. Framework Preset: **Other**. Leave build and output settings empty (`vercel.json` handles them).
3. Deploy. The functions in `api/` give you `/api/feeds`, `/api/page` and `/api/llm`, and `vercel.json` adds the same security headers.
4. Optional environment variables (Settings, Environment Variables): `GEMINI_API_KEY` with `ACCESS_CODE`, `EXTRA_HOSTS`. Redeploy after adding them.

Vercel's Hobby plan is limited to non-commercial personal use. For client or agency work, use Netlify or Render (free tiers allow it) or Vercel Pro.

### Option 2: Render (free web service)

1. Push the folder to GitHub.
2. In Render, New, Blueprint, pick the repo. `render.yaml` sets up a free Node web service running `node server.js`.
3. Add the same optional environment variables. Free Render services sleep after inactivity, so the first load can take about 30 seconds.

### Option 3: GitHub Pages (static only)

1. Push the folder to a GitHub repo, then Settings, Pages, deploy from the main branch root.
2. There are no functions on Pages, so Google Pulse and the URL importer use free public CORS proxies (set "Google Pulse source" to "Public proxies only" in Settings). If those proxies are down, the app shows its built-in update snapshot.

### Run locally

```
node server.js
```
Then open http://localhost:8080. Needs Node 18 or newer, no `npm install`.

## Each user brings their own Gemini key (kept private)

Anyone who opens your Content QC site can use AI Assist with **their own** free Gemini key:

1. Get a free key at aistudio.google.com/app/apikey.
2. In Content QC, open Settings, choose "Google Gemini" and paste the key.
3. Optional: tick "Remember my key on this browser". Leave it off and the key is forgotten when the tab closes.

How the key is protected:

- The key is sent only from the user's browser straight to Google (generativelanguage.googleapis.com) in a request header. It is never sent to your Netlify or Render server, so it cannot appear in your function logs or storage.
- Each person's key lives only in their own browser (tab storage by default). Other users of the site cannot see it, and neither can you as the site owner.
- The key is kept separate from other settings, is never put in a URL, and "Forget my key" deletes it.
- The site sends strict security headers (Content-Security-Policy, no-referrer, no framing): scripts load only from the site itself and one pinned library on jsDelivr, so third-party scripts cannot read a saved key.
- The optional "Server proxy" is only for a shared team key that you set as `GEMINI_API_KEY`. It is locked unless you also set `ACCESS_CODE`, so strangers cannot spend your quota, and it never accepts a visitor's personal key.

## Free AI extras (optional)

Content QC works fully without any model. A model adds a second-opinion AI detection, "Humanize in my voice" rewrites, title and meta sets, snippet summaries, 5 PAA-style FAQs, a policy review and a list of claims to verify.

- **Gemini:** get a free key at aistudio.google.com, then Settings, Provider "Google Gemini", paste the key, click "List models" and pick one.
- **OpenAI-compatible:** OpenRouter models ending in `:free`, Groq's free tier, or a local LM Studio server.
- **Server proxy:** put `GEMINI_API_KEY` on Netlify or Render and choose "Server proxy". The key never reaches the browser.

Personal keys stay in the user's own browser (tab storage unless they choose "Remember") and go only to the AI provider.

## Updating the rule book

All policies, ranking systems, patents, factors, phrase lists and your voice profile live in `assets/kb.js`. Each entry links to its source. When Google changes a doc (Live Sources will tell you), edit the summary there and redeploy.

## Files

- `index.html`, `assets/styles.css`: interface
- `assets/kb.js`: Google knowledge base and your voice profile
- `assets/analyzers.js`: all checks and scoring
- `assets/ai.js`: optional model providers and prompts
- `assets/feeds.js`, `assets/app.js`: Google Pulse and UI logic
- `lib/core.mjs`: shared server code (feeds, page reader, Gemini proxy)
- `netlify/functions/*`: Netlify functions
- `server.js`, `render.yaml`, `package.json`: Render or any Node host

Findings are guidance based on Google's published documentation; no tool can guarantee rankings.
