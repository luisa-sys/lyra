/**
 * /api/convene/admin/drain-queue — KAN-209 P5 part 2 follow-up.
 *
 * Manual, user-scoped drain trigger. The Vercel cron at
 * /api/convene/cron/send-invites only fires on production deployments —
 * to drive the dispatcher on dev (or to manually flush after queueing),
 * this route lets the lyra_drain_invite_queue MCP tool call it on
 * behalf of an authenticated user.
 *
 * Auth accepts two equivalent forms (KAN-240 symmetry with the MCP
 * server's middleware):
 *
 *   1. `Authorization: Bearer lyra_…` header — preferred.
 *   2. `{ "api_key": "lyra_…" }` in the JSON body — fallback for clients
 *      that cannot set custom headers (form posts, simple curl, etc).
 *
 * The drain is filtered to the calling user's gatherings only — one
 * user cannot drain another's queue.
 *
 * Gate: `CONVENE_ENABLED` must be 'true' or the route 404s.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isConveneEnabled } from '@/lib/convene/flags';
import {
  authenticateBearerApiKey,
  type BearerAuthResult,
  type BearerAuthError,
} from '@/lib/convene/auth-bearer';
import { dispatchQueuedInvites } from '@/lib/convene/invites/dispatch';

export const maxDuration = 60;

async function resolveAuth(
  req: NextRequest
): Promise<BearerAuthResult | BearerAuthError> {
  // Header path — preferred (matches MCP-server middleware).
  const headerAuth = await authenticateBearerApiKey(req.headers.get('authorization'));
  if (headerAuth.ok) return headerAuth;

  // Body fallback — for clients that can't set headers. Reading the
  // body here consumes the stream, but the route doesn't read the body
  // elsewhere, so this is safe.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return headerAuth;
  }
  const apiKey = (body as { api_key?: unknown } | null)?.api_key;
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    return authenticateBearerApiKey(`Bearer ${apiKey}`);
  }
  return headerAuth;
}

export async function POST(req: NextRequest) {
  if (!isConveneEnabled()) {
    return NextResponse.json({ ok: false, error: 'convene_disabled' }, { status: 404 });
  }

  const auth = await resolveAuth(req);
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
