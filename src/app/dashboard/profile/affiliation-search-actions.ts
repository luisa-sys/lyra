'use server';

/**
 * KAN-451 — type-ahead suggestions for the schools / organisations /
 * communities picker.
 *
 * Same shape as the KAN-341 town/city lookup (`city-actions.ts`): a thin
 * authenticated wrapper around a pure Places client that lives in
 * `src/modules/profile/geo/places-schools.ts`. Constants and types stay in that module —
 * a `'use server'` file may export only async functions (BUGS-12 / gotcha #18).
 *
 * This is a SUGGESTION service, not a gate. When it returns nothing — no key
 * configured, provider down, nothing matched — the picker falls back to a plain
 * text input and the member types their school in themselves. That is why an
 * empty list is a success and not an error.
 */

import { createClient } from '@/modules/platform/supabase-server';
import { shouldSuggest, type PlaceSuggestion } from '@/modules/profile/geo/places-schools';
import { lookupPlaceSuggestions } from '@/modules/profile/geo/places-schools-lookup';
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

  const suggestions = await lookupPlaceSuggestions(
    query,
    coerceAffiliationType(affiliationType),
  );
  return { success: true, suggestions };
}
