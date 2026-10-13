// Vercel Function: POST /api/llm  (optional shared team key; never receives a visitor's personal key)
import { llm } from '../lib/core.mjs';

export async function POST(request) {
  try {
    const out = await llm(await request.json(), process.env);
    return Response.json(out, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}
