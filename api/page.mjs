// Vercel Function: GET /api/page?url=...  (URL import and Live Sources reader)
import { fetchPage } from '../lib/core.mjs';

export async function GET(request) {
  const url = new URL(request.url).searchParams.get('url');
  try {
    const data = await fetchPage(url, { allowAny: process.env.ALLOW_ANY_URL === '1', extraHosts: process.env.EXTRA_HOSTS });
    return Response.json(data, { headers: { 'cache-control': 'public, max-age=600' } });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 400 });
  }
}
