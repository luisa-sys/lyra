'use server';

/**
 * KAN-451 / KAN-487 — type-ahead suggestions for the schools / organisations /
 * communities picker.
 *
 * KAN-487 (spec v0.8 §02, founder decision): suggestions now come from Lyra's
 * own entries via `public.suggest_affiliation_names` (SECURITY INVOKER — RLS
 * limits it to affiliations the member can already see), through
 * `src/modules/profile/affiliation-suggest.ts`. The KAN-451 Google Places
 * lookup is no longer called; `places-schools-lookup.ts` stays on disk until
 * the PR3 clean-up. The export name, its arguments and its result shape are
 * unchanged, so the picker keeps working: a suggestion is a name only
 * (`address` / `postcode` are null — the member types the postcode).
 *
 * This is a SUGGESTION service, not a gate. When it returns nothing — RPC
 * failure, nothing matched — the picker falls back to a plain text input and
 * the member types the name in themselves. That is why an empty list is a
 * success and not an error. A `'use server'` file may export only async
 * functions (BUGS-12 / gotcha #18).
 */

import { createClient } from '@/modules/platform/supabase-server';
import { shouldSuggest, type PlaceSuggestion } from '@/modules/profile/geo/places-schools';
import { suggestAffiliationNamesRpc } from '@/modules/profile/affiliation-suggest';
import { coerceAffiliationType } from './affiliation-fields';

export type SuggestAffiliationsResult =
  | { success: true; suggestions: PlaceSuggestion[] }
  | { success: false; error: string };

export async function suggestAffiliations(
  query: string,
  affiliationType?: string,
): Promise<SuggestAffiliationsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // Too short to be worth a lookup — an empty list, not an error, so the picker
  // just shows nothing until there is enough to match on.
  if (!shouldSuggest(query)) return { success: true, suggestions: [] };

  const names = await suggestAffiliationNamesRpc(supabase, coerceAffiliationType(affiliationType), query);
  return {
    success: true,
    suggestions: names.map((name) => ({ name, address: null, postcode: null })),
  };
}
