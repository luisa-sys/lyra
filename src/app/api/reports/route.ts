/**
 * KAN-141: POST /api/reports
 *
 * User-side endpoint for filing a report against a profile or item.
 * Auth-only (anonymous abuse is too easy otherwise). The reporter is
 * always set to the authenticated user — we explicitly do NOT trust a
 * `reporter_user_id` in the body. Rate-limited per-profile-per-day to
 * stop a single user from mass-flagging the same target.
 *
 * Body shape:
 *   {
 *     "profileSlug": "luisa",                    // required — target profile
 *     "profileItemId": "uuid"                    // optional — narrows to one item
 *     "reason": "spam" | "harassment" | "impersonation" | "inappropriate" | "other",
 *     "note": "free text"                        // optional, ≤500 chars
 *   }
 *
 * Responses:
 *   201 { "id": "uuid", "status": "pending" } — report filed
 *   400 invalid body
 *   401 not signed in
 *   404 profile not found / not visible
 *   429 already reported this profile in the last 24h
 *   500 server error
 */

import { NextResponse } from 'next/server';
import { createClient as createSupabaseServerClient } from '@/lib/supabase-server';
import { getAdminServiceClient } from '@/lib/admin';

const VALID_REASONS = ['spam', 'harassment', 'impersonation', 'inappropriate', 'other'] as const;
type Reason = typeof VALID_REASONS[number];

interface ReportBody {
  profileSlug?: unknown;
  profileItemId?: unknown;
  reason?: unknown;
  note?: unknown;
}

function parseBody(input: unknown): { ok: true; value: { profileSlug: string; profileItemId: string | null; reason: Reason; note: string | null } } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'body must be an object' };
  const body = input as ReportBody;

  if (typeof body.profileSlug !== 'string' || body.profileSlug.length === 0) {
    return { ok: false, error: 'profileSlug is required' };
  }
  if (typeof body.reason !== 'string' || !VALID_REASONS.includes(body.reason as Reason)) {
    return { ok: false, error: `reason must be one of: ${VALID_REASONS.join(', ')}` };
  }
  const profileItemId =
    body.profileItemId == null ? null
    : typeof body.profileItemId === 'string' && /^[0-9a-f-]{36}$/i.test(body.profileItemId) ? body.profileItemId
    : 'INVALID';
  if (profileItemId === 'INVALID') {
    return { ok: false, error: 'profileItemId must be a uuid' };
  }
  if (body.note != null && (typeof body.note !== 'string' || body.note.length > 500)) {
    return { ok: false, error: 'note must be a string ≤500 chars' };
  }

  return {
    ok: true,
    value: {
      profileSlug: body.profileSlug,
      profileItemId,
      reason: body.reason as Reason,
      note: (body.note as string | null) ?? null,
    },
  };
}

export async function POST(request: Request) {
  // 1. Auth check
  const cookieClient = await createSupabaseServerClient();
  const { data: { user } } = await cookieClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 2. Parse + validate body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = parseBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: 'invalid_body', detail: parsed.error }, { status: 400 });
  }
  const { profileSlug, profileItemId, reason, note } = parsed.value;

  // 3. Resolve target profile. Use service-role because we want to allow
  // reporting suspended / unpublished profiles too (an admin viewing
  // them might find a problem). If it's literally not there, 404.
  const supabase = getAdminServiceClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, user_id')
    .eq('slug', profileSlug)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
  }

  // Defensive: prevent self-reports. Users will work around this by
  // creating sock-puppet accounts; we're not trying to be airtight, just
  // to keep the queue sane.
  if (profile.user_id === user.id) {
    return NextResponse.json({ error: 'cannot_report_self' }, { status: 400 });
  }

  // 4. Rate-limit: one report per (reporter, target profile) per 24h.
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from('reports')
    .select('id', { count: 'exact', head: true })
    .eq('reporter_user_id', user.id)
    .eq('profile_id', profile.id)
    .gte('created_at', twentyFourHoursAgo);

  if ((recentCount ?? 0) > 0) {
    return NextResponse.json({ error: 'already_reported' }, { status: 429 });
  }

  // 5. Insert
  const { data: inserted, error: insertError } = await supabase
    .from('reports')
    .insert({
      profile_id: profile.id,
      profile_item_id: profileItemId,
      reporter_user_id: user.id,
      reason,
      note,
      status: 'pending',
    })
    .select('id, status')
    .single();

  if (insertError || !inserted) {
    return NextResponse.json({ error: 'insert_failed', detail: insertError?.message }, { status: 500 });
  }

  return NextResponse.json({ id: inserted.id, status: inserted.status }, { status: 201 });
}
