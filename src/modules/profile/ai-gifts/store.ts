/**
 * KAN-489 — AI gift suggestions: database calls (migration
 * 20261123120000_kan489_ai_gift_generations.sql).
 *
 *   claimGeneration(supabase, sessionId, consentVersion)
 *                                          public.claim_ai_gift_generation
 *   insertSuggestions(supabase, kept)      public.insert_ai_gift_suggestions
 *   dismissPendingSuggestion(supabase, id) delete ONE unapproved AI row
 *
 * All three use the member's own (RLS) client. The server actions make no
 * `.from` / `.rpc` calls themselves (CTL-056).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiSuggestion, GeneratedSuggestion } from './types';

type ClaimRefusal = 'session_limit' | 'daily_limit' | 'cooldown' | 'suspended';

export type ClaimResult =
  | { ok: true; sessionRemaining: number; dailyRemaining: number }
  | { ok: false; reason: ClaimRefusal; sessionRemaining: number | null }
  | { ok: false; reason: 'error' };

const CLAIM_REFUSALS: ReadonlySet<string> = new Set<ClaimRefusal>(['session_limit', 'daily_limit', 'cooldown', 'suspended']);

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Claim one generation, recording the consent version the member accepted.
 * Any error is reported as `error` and the caller must NOT call the model.
 */
export async function claimGeneration(
  supabase: SupabaseClient,
  sessionId: string,
  consentVersion: string,
): Promise<ClaimResult> {
  const { data, error } = await supabase.rpc('claim_ai_gift_generation', {
    p_session: sessionId,
    p_consent_version: consentVersion,
  });
  if (error || typeof data !== 'object' || data === null) return { ok: false, reason: 'error' };
  const d = data as Record<string, unknown>;
  if (d.ok === true) {
    const sessionRemaining = num(d.session_remaining);
    const dailyRemaining = num(d.daily_remaining);
    if (sessionRemaining === null || dailyRemaining === null) return { ok: false, reason: 'error' };
    return { ok: true, sessionRemaining, dailyRemaining };
  }
  if (d.ok === false && typeof d.reason === 'string' && CLAIM_REFUSALS.has(d.reason)) {
    return {
      ok: false,
      reason: d.reason as ClaimRefusal,
      sessionRemaining: num(d.session_remaining),
    };
  }
  return { ok: false, reason: 'error' };
}

export type InsertResult = { ok: true; inserted: GeneratedSuggestion[]; droppedForCap: number } | { ok: false };

/** Store the checked suggestions as unapproved, private AI rows. */
export async function insertSuggestions(supabase: SupabaseClient, kept: readonly AiSuggestion[]): Promise<InsertResult> {
  if (kept.length === 0) return { ok: true, inserted: [], droppedForCap: 0 };
  const p_items = kept.map((k) => ({ title: k.title, description: k.description }));
  const { data, error } = await supabase.rpc('insert_ai_gift_suggestions', { p_items });
  if (error || typeof data !== 'object' || data === null) return { ok: false };
  const d = data as { inserted?: unknown; dropped_for_cap?: unknown };
  if (!Array.isArray(d.inserted)) return { ok: false };
  const inserted: GeneratedSuggestion[] = [];
  for (const row of d.inserted as Array<Record<string, unknown>>) {
    if (typeof row?.id !== 'string' || typeof row.title !== 'string') return { ok: false };
    inserted.push({
      id: row.id,
      title: row.title,
      description: typeof row.description === 'string' ? row.description : null,
    });
  }
  return { ok: true, inserted, droppedForCap: num(d.dropped_for_cap) ?? 0 };
}

/**
 * Delete ONE pending (unapproved) AI suggestion now, so its slot frees at
 * once. Approved suggestions are removed through Save (`ai_gifts.delete`),
 * never here. Owner RLS limits the delete to the member's own rows.
 *
 * When nothing was deleted, one follow-up read tells the two cases apart: the
 * row is gone (`not_found` — the editor drops it) or it is already APPROVED,
 * e.g. in another tab (`approved_elsewhere` — the editor keeps it, because
 * dropping it locally would hide a row that is still public).
 */
export async function dismissPendingSuggestion(
  supabase: SupabaseClient,
  id: string,
): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'approved_elsewhere' | 'failed' }> {
  const { data, error } = await supabase
    .from('profile_items')
    .delete()
    .eq('id', id)
    .eq('origin', 'ai')
    .eq('approved', false)
    .select('id');
  if (error) return { ok: false, reason: 'failed' };
  if (Array.isArray(data) && data.length === 1) return { ok: true };

  const { data: still, error: readError } = await supabase
    .from('profile_items')
    .select('id, approved')
    .eq('id', id)
    .eq('origin', 'ai')
    .maybeSingle();
  if (readError) return { ok: false, reason: 'failed' };
  const row = still as { approved?: unknown } | null;
  if (row && row.approved === true) return { ok: false, reason: 'approved_elsewhere' };
  return { ok: false, reason: 'not_found' };
}

