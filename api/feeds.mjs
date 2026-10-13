// Vercel Function: GET /api/feeds  (Google Pulse feeds)
import { getFeeds } from '../lib/core.mjs';

export async function GET() {
  try {
    const data = await getFeeds();
    return Response.json(data, { headers: { 'cache-control': 'public, max-age=300, s-maxage=900' } });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
