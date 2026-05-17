/**
 * /api/convene/cron/send-invites — KAN-209 Phase 5 part 2.
 *
 * Vercel Cron route. Drains the gathering_invite_messages queue and sends
 * each one via Resend (gated by CONVENE_INVITE_ALLOWLIST). Schedule lives
 * in vercel.json (`/api/convene/cron/send-invites` every 10 minutes).
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` header.
 * Gate: `CONVENE_ENABLED` must be 'true' or the route 404s — keeps it dark
 * on every environment except develop until launch.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isConveneEnabled } from '@/lib/convene/flags';
import { dispatchQueuedInvites } from '@/lib/convene/invites/dispatch';

export const maxDuration = 60; // seconds

export async function GET(req: NextRequest) {
  if (!isConveneEnabled()) {
    return NextResponse.json({ ok: false, error: 'convene_disabled' }, { status: 404 });
  }

  const authHeader = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: 'unauthorised' }, { status: 401 });
  }

  try {
    const summary = await dispatchQueuedInvites();
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
