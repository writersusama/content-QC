import { llm } from '../../lib/core.mjs';

export default async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  try {
    const out = await llm(await req.json(), process.env);
    return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: e.status || 500, headers: { 'content-type': 'application/json' } });
  }
};
export const config = { path: '/api/llm' };
