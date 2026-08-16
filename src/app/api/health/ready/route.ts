import { NextResponse } from 'next/server';
import { checkReadiness } from '@/modules/observability/readiness';

/**
 * SEC-96 instance 3 — the readiness endpoint the public `/status` page needs
 * so its Website row can stop being a literal `ok: true`.
 *
 * Liveness vs readiness, and why this is a sibling of `/api/health` rather
 * than a change to it: `/api/health` answers "is a Next.js server responding
 * and how is it configured" — it echoes three public env values and returns a
 * hardcoded `ok: true`. That is green during exactly the outage a status page
 * exists to report. This route answers "can the site actually serve a
 * request that needs the database", which is the question behind the word
 * "operational".
 *
 * Contract, so callers can rely on it:
 *   200 + { ok: true,  detail }  — dependency reachable
 *   503 + { ok: false, detail }  — dependency degraded or timed out
 *
 * The non-200 status is the load-bearing half: it means an uptime monitor
 * pointed here alarms without parsing a body, and a `fetch(...).ok` check —
 * which is how `src/app/status/page.tsx` already evaluates its MCP probe —
 * reads degraded correctly with no new client logic.
 *
 * `detail` is one of a fixed set of tokens from the readiness module; no
 * exception text, hostname or key fragment ever reaches this response (SEC-96
 * §4 — a public probe returns ok/degraded only).
 *
 * Unauthenticated by design and safe to be so: it returns no data, only a
 * boolean, and its underlying query runs on the anon key with `head: true`.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const { ok, detail } = await checkReadiness();

  return NextResponse.json(
    { ok, detail },
    {
      status: ok ? 200 : 503,
      headers: {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    }
  );
}
