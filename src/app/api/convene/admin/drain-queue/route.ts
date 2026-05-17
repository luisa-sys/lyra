/**
 * /api/convene/admin/drain-queue — KAN-209 P5 part 2 follow-up.
 *
 * Manual, user-scoped drain trigger. The Vercel cron at
 * /api/convene/cron/send-invites only fires on production deployments —
 * to drive the dispatcher on dev (or to manually flush after queueing),
 * this route lets the lyra_drain_invite_queue MCP tool call it on
 * behalf of an authenticated user.
 *
 * Auth: `Authorization: Bearer lyra_…` (a user-owned API key, same
 * format as every other MCP-callable). The drain is filtered to that
 * user's gatherings only — one user cannot drain another's queue.
 *
 * Gate: `CONVENE_ENABLED` must be 'true' or the route 404s.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isConveneEnabled } from '@/lib/convene/flags';
import { authenticateBearerApiKey } from '@/lib/convene/auth-bearer';
import { dispatchQueuedInvites } from '@/lib/convene/invites/dispatch';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isConveneEnabled()) {
    return NextResponse.json({ ok: false, error: 'convene_disabled' }, { status: 404 });
  }

  const auth = await authenticateBearerApiKey(req.headers.get('authorization'));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  try {
    const summary = await dispatchQueuedInvites({ hostUserId: auth.userId });
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
