/**
 * /api/retention/cron/sweep — SEC-74 data-retention purge (UK-GDPR Art. 5(1)(e)).
 *
 * Scheduled sweep that enforces the deletion windows published in the privacy
 * policy / RETENTION_SCHEDULE.md. Schedule: `0 3 * * 0` (Sundays 03:00 UTC,
 * quiet window; see vercel.json). Vercel Cron only fires on the Production
 * deployment.
 *
 * Gate: `RETENTION_ENABLED=true` or 404 — default OFF, so the purge jobs never
 * run (and delete nothing) until Luisa confirms the retention windows and
 * enables them per environment. Mirrors the Convene `CONVENE_ENABLED` gate.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`; compared in
 * constant time (reuses the Convene cron-auth helper).
 *
 * Honesty: if any retention job errored, the route returns 500 with the errors
 * surfaced — a partial failure is never reported as a clean success.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isRetentionEnabled } from '@/lib/retention/flags';
import { runRetentionSweep } from '@/lib/retention/sweep';
import { timingSafeStrEqual } from '@/lib/convene/cron-auth';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isRetentionEnabled()) {
    return NextResponse.json({ ok: false, error: 'retention_disabled' }, { status: 404 });
  }

  const expected = process.env.CRON_SECRET;
  const expectedHeader = `Bearer ${expected}`;
  if (!expected || !timingSafeStrEqual(req.headers.get('authorization'), expectedHeader)) {
    return NextResponse.json({ ok: false, error: 'unauthorised' }, { status: 401 });
  }

  try {
    const summary = await runRetentionSweep();
    if (summary.errors.length > 0) {
      return NextResponse.json({ ok: false, summary }, { status: 500 });
    }
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
