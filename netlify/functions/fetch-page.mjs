import { fetchPage } from '../../lib/core.mjs';

export default async (req) => {
  const url = new URL(req.url).searchParams.get('url');
  try {
    const data = await fetchPage(url, { allowAny: process.env.ALLOW_ANY_URL === '1', extraHosts: process.env.EXTRA_HOSTS });
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
};
export const config = { path: '/api/page' };
