import { getFeeds } from '../../lib/core.mjs';

export default async () => {
  try {
    const data = await getFeeds();
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300', 'netlify-cdn-cache-control': 'public, durable, max-age=900, stale-while-revalidate=3600' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
};
export const config = { path: '/api/feeds' };
