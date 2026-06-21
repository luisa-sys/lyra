'use server';

/**
 * KAN-305 — Organise-event wizard server actions.
 *
 *   createGatheringDraft — ports the lyra_create_gathering insert sequence
 *     (gatherings → proposed_slots → invitees → events_log) into the web app.
 *     Uses the service-role client (like gatherings/[id]/actions.ts) because it
 *     appends to the append-only audit log; every write is host-scoped with an
 *     `// ownership-ok:` comment (the static CI guard requires it).
 *   getHostBusyTimes — the host's own Google free/busy for a window, so the
 *     wizard can suggest a free slot. Multi-attendee shared availability is the
 *     consent-gated MCP path (lyra_get_shared_availability, SEC-18).
 *   suggestVenues — ranks the shared `venues` catalogue with the existing
 *     scoreVenue engine.
 *
 * MCP parity (KAN-222): the agent equivalents already exist —
 * lyra_create_gathering, lyra_get_shared_availability, lyra_suggest_venues,
 * lyra_propose_attendees, lyra_finalise_gathering. No new MCP tools needed.
 */

import { createClient } from '@/lib/supabase-server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { moderateAndAudit } from '@/lib/moderation-audit';
import { scoreVenue } from '@/lib/recommend/convene/score-venue';
import type { VenueCandidate, VenueContext } from '@/lib/recommend/convene/types';
import { adapterFor } from '@/lib/convene/calendar';
import { getConnectionForUser } from '@/lib/convene/oauth-connections';
import {
  MAX_PROPOSED_SLOTS,
  MAX_ATTENDEES,
  MAX_AVAILABILITY_WINDOW_DAYS,
  DRAFT_LIMITS,
  isGatheringType,
  toNum,
  type CreateDraftInput,
  type BusyBlockView,
  type VenueSuggestion,
  type VenueSuggestContext,
} from './organise-fields';

function admin() {
  return createSupabaseAdmin(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function createGatheringDraft(
  input: CreateDraftInput
): Promise<{ ok: true; gatheringId: string } | { ok: false; error: string }> {
  const { supabase, user } = await authed();
  if (!user) return { ok: false, error: 'Not authenticated' };
  const userId = user.id;

  const title = (input.title ?? '').trim();
  if (!title) return { ok: false, error: 'Give your gathering a title' };
  if (title.length > DRAFT_LIMITS.title) return { ok: false, error: 'That title is too long' };
  if (!isGatheringType(input.gathering_type)) return { ok: false, error: 'Pick a gathering type' };
  if (input.capacity_min != null && input.capacity_max != null && input.capacity_max < input.capacity_min) {
    return { ok: false, error: 'Maximum capacity must be at least the minimum' };
  }

  const slots = (input.proposed_slots ?? []).slice(0, MAX_PROPOSED_SLOTS);
  for (const s of slots) {
    const a = new Date(s.slot_start_iso);
    const b = new Date(s.slot_end_iso);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return { ok: false, error: 'A proposed time is invalid' };
    if (b <= a) return { ok: false, error: 'Each proposed time must end after it starts' };
  }

  const contactIds = Array.from(new Set(input.invitee_contact_ids ?? [])).slice(0, MAX_ATTENDEES);
  if (contactIds.length > 0) {
    // Service-role bypasses RLS, so confirm the host owns every invitee contact.
    // ownership-ok: verifying owner_user_id ownership of each invitee contact (KAN-305)
    const { data: owned } = await supabase
      .from('contacts')
      .select('id')
      .in('id', contactIds)
      .is('deleted_at', null);
    const ownedIds = new Set((owned ?? []).map((c) => c.id));
    if (contactIds.some((id) => !ownedIds.has(id))) {
      return { ok: false, error: 'One or more selected contacts could not be found' };
    }
  }

  // Content moderation on free text (public: title/description/dietary; private: notes).
  const modFields: Array<[string | null | undefined, 'public' | 'private', string]> = [
    [title, 'public', 'gatherings.title'],
    [input.description, 'public', 'gatherings.description'],
    [input.dietary_summary, 'public', 'gatherings.dietary_summary'],
    [input.notes, 'private', 'gatherings.notes'],
  ];
  for (const [text, fieldType, field] of modFields) {
    if (text == null || text === '') continue;
    const mod = await moderateAndAudit(supabase, { text, fieldType, field, profileId: null, source: 'web_app' });
    if (!mod.ok) return { ok: false, error: mod.error };
  }

  const sb = admin();
  // ownership-ok: insert stamps host_user_id = authed user (KAN-305)
  const { data: gathering, error: insErr } = await sb
    .from('gatherings')
    .insert({
      host_user_id: userId,
      title,
      description: (input.description ?? '').trim() || null,
      gathering_type: input.gathering_type,
      status: 'draft',
      target_window_start: input.target_window_start_iso ?? null,
      target_window_end: input.target_window_end_iso ?? null,
      capacity_min: input.capacity_min ?? null,
      capacity_max: input.capacity_max ?? null,
      dietary_summary: (input.dietary_summary ?? '').trim() || null,
      notes: (input.notes ?? '').trim() || null,
    })
    .select('id')
    .single();
  if (insErr || !gathering) return { ok: false, error: 'Could not create the gathering' };

  if (slots.length > 0) {
    // ownership-ok: slots attach to the gathering just created for this host (KAN-305)
    const { error } = await sb.from('gathering_proposed_slots').insert(
      slots.map((s) => ({ gathering_id: gathering.id, slot_start: s.slot_start_iso, slot_end: s.slot_end_iso }))
    );
    if (error) return { ok: false, error: 'Saved the gathering, but adding the times failed' };
  }

  if (contactIds.length > 0) {
    // ownership-ok: gathering owned by host; DB trigger enforces host owns each contact (KAN-305)
    const { error } = await sb.from('gathering_invitees').insert(
      contactIds.map((cid) => ({ gathering_id: gathering.id, contact_id: cid, status: 'invited' }))
    );
    if (error) return { ok: false, error: 'Saved the gathering, but adding the people failed' };
  }

  // ownership-ok: audit row for the gathering this host just created (KAN-305)
  await sb.from('gathering_events_log').insert({
    gathering_id: gathering.id,
    actor_user_id: userId,
    event_type: 'gathering_created',
    subject_kind: 'gathering',
    subject_id: gathering.id,
    metadata: {
      title,
      type: input.gathering_type,
      proposed_slot_count: slots.length,
      invitee_count: contactIds.length,
      source: 'web_organise_wizard',
    },
  });

  return { ok: true, gatheringId: gathering.id };
}

export async function getHostBusyTimes(
  windowStartISO: string,
  windowEndISO: string
): Promise<{ ok: true; connected: boolean; busy: BusyBlockView[]; note?: string } | { ok: false; error: string }> {
  const { user } = await authed();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const start = new Date(windowStartISO);
  const end = new Date(windowEndISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { ok: false, error: 'Pick a valid date range' };
  }
  if (end.getTime() - start.getTime() > MAX_AVAILABILITY_WINDOW_DAYS * 86_400_000) {
    return { ok: false, error: `Pick a window of ${MAX_AVAILABILITY_WINDOW_DAYS} days or less` };
  }

  const connection = await getConnectionForUser(user.id, 'google');
  if (!connection) {
    return {
      ok: true,
      connected: false,
      busy: [],
      note: 'Connect a Google calendar under Calendar connections to see your busy times here.',
    };
  }

  try {
    const adapter = adapterFor('google');
    const busy = await adapter.getFreeBusy(connection.id, { start, end });
    return { ok: true, connected: true, busy: busy.map((b) => ({ start: b.start, end: b.end })) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read your calendar' };
  }
}

export async function suggestVenues(
  context: VenueSuggestContext
): Promise<{ ok: true; venues: VenueSuggestion[] } | { ok: false; error: string }> {
  const { supabase, user } = await authed();
  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!isGatheringType(context.intent)) return { ok: false, error: 'Pick a gathering type first' };

  // `venues` is a shared catalogue: any authenticated user may SELECT; writes
  // are service-role only (populated by lyra_suggest_venues via Google Places).
  let q = supabase
    .from('venues')
    .select(
      'id, name, venue_type, city, postcode, lat, lng, price_tier, capacity_estimate, accessibility_flags, dietary_flags, external_rating'
    )
    .limit(50);
  const anchor = (context.anchor ?? '').trim();
  if (anchor && !anchor.includes(',')) {
    const cityToken = anchor.replace(/[%,()*\\]/g, '').trim();
    if (cityToken.length >= 2) q = q.ilike('city', `%${cityToken}%`);
  }

  const { data, error } = await q;
  if (error) return { ok: false, error: 'Could not load venues' };

  const ctx: VenueContext = {
    intent: context.intent,
    anchor: context.anchor ?? null,
    capacityRequired: context.capacityRequired ?? 0,
    required: {},
    preferred: {},
  };

  const ranked = (data ?? [])
    .map((v) => {
      const candidate: VenueCandidate = {
        venueId: v.id,
        name: v.name,
        venueType: v.venue_type,
        city: v.city,
        postcode: v.postcode,
        lat: toNum(v.lat),
        lng: toNum(v.lng),
        priceTier: toNum(v.price_tier),
        capacityEstimate: toNum(v.capacity_estimate),
        accessibilityFlags: (v.accessibility_flags ?? []) as string[],
        dietaryFlags: (v.dietary_flags ?? []) as string[],
        externalRating: toNum(v.external_rating),
      };
      return { candidate, score: scoreVenue(candidate, ctx) };
    })
    .filter((x) => !x.score.hardFilterFailed)
    .sort((a, b) => b.score.score - a.score.score)
    .slice(0, 8)
    .map(({ candidate, score }) => ({
      venueId: candidate.venueId,
      name: candidate.name,
      venueType: candidate.venueType,
      city: candidate.city,
      score: score.score,
      reasons: score.reasons.slice(0, 3),
    }));

  return { ok: true, venues: ranked };
}
