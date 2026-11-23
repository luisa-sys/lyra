/**
 * KAN-487 — v0.8 §02 affiliation autocomplete from Lyra's own entries
 * (founder decision: replaces the KAN-451 Google Places lookup; plan §B
 * "Affiliation autocomplete RPC").
 *
 * Calls `public.suggest_affiliation_names(p_type, p_prefix, p_limit)`
 * (SECURITY INVOKER, so RLS limits it to affiliations the member can already
 * see). This is a SUGGESTION, never a gate: any failure is an empty list and
 * the member types the name themselves.
 *
 * Server only (request-scoped Supabase client). No imports from `src/app/**`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isAffiliationType } from '@/modules/profile/affiliation-rules';
import { MIN_SUGGEST_QUERY_LENGTH } from '@/modules/profile/geo/places-schools';

/** Matches the RPC default; the RPC clamps to 1..10 anyway. */
export const AFFILIATION_SUGGEST_LIMIT = 8;

/**
 * Distinct affiliation names of `type` starting with `prefix`. Empty when the
 * prefix is under 3 characters (whitespace ignored), the type is not one of
 * school / organisation / community, or the RPC fails.
 */
export async function suggestAffiliationNamesRpc(
  supabase: SupabaseClient,
  type: unknown,
  prefix: unknown,
): Promise<string[]> {
  if (typeof type !== 'string' || !isAffiliationType(type)) return [];
  const trimmed = typeof prefix === 'string' ? prefix.trim() : '';
  if ([...trimmed].length < MIN_SUGGEST_QUERY_LENGTH) return [];

  try {
    const { data, error } = await supabase.rpc('suggest_affiliation_names', {
      p_type: type,
      p_prefix: trimmed,
      p_limit: AFFILIATION_SUGGEST_LIMIT,
    });
    if (error || !Array.isArray(data)) return [];
    return (data as Array<{ name?: unknown }>)
      .map((row) => (typeof row?.name === 'string' ? row.name.trim() : ''))
      .filter((name) => name !== '');
  } catch {
    return [];
  }
}
