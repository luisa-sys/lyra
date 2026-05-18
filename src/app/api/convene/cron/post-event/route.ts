/**
 * /api/convene/cron/post-event — KAN-212 P8.
 *
 * Daily cron. Marks completed gatherings, auto-attendance, refreshes the
 * relationship_signals view. Schedule: `0 4 * * *` (04:00 UTC daily,
 * outside the user-facing peak; well after any UK / Europe gathering).
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`.
 * Gate: `CONVENE_ENABLED=true` or 404.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isConveneEnabled } from '@/lib/convene/flags';
import { runPostEventSweep } from '@/lib/convene/post-event';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isConveneEnabled()) {
    return NextResponse.json({ ok: false, error: 'convene_disabled' }, { status: 404 });
  }
  const expected = process.env.CRON_SECRET;
  if (!expected || req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: 'unauthorised' }, { status: 401 });
  }

  try {
    const summary = await runPostEventSweep();
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
