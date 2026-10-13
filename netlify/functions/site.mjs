import { siteProfile } from '../../lib/core.mjs';

export default async (req) => {
  const domain = new URL(req.url).searchParams.get('domain');
  try {
    return new Response(JSON.stringify(await siteProfile(domain)), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600, s-maxage=21600' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: e.status || 500, headers: { 'content-type': 'application/json' } });
  }
};
export const config = { path: '/api/site' };
