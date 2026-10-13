// Vercel Function: GET /api/site?domain=example.com  (domain fit check)
import { siteProfile } from '../lib/core.mjs';

export async function GET(request) {
  try {
    const data = await siteProfile(new URL(request.url).searchParams.get('domain'));
    return Response.json(data, { headers: { 'cache-control': 'public, max-age=3600, s-maxage=21600' } });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}
