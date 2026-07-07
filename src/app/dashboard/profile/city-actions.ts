'use server';

/**
 * KAN-341 (epic KAN-349) — resolve a town/city from a postcode (Google Places).
 *
 * The user enters a postcode; we resolve it to a town/city and return ONLY the
 * city (+ optional region). The raw postcode is used transiently and is never
 * persisted or logged — it lives only for the duration of this call. The caller
 * then saves the chosen city via updateProfileFields (city is in the allowlist).
 *
 * '`use server`' constraint: every export is an async function. The pure Places
 * client + extractor live in src/lib/geo/places-city.ts. See BUGS-12.
 */
import { createClient } from '@/lib/supabase-server';
import { lookupCityFromPostcode } from '@/lib/geo/places-city';

export type ResolveCityResult =
  | { success: true; city: string; region: string | null }
  | { success: false; error: string };

export async function resolveCityFromPostcode(postcode: string): Promise<ResolveCityResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const trimmed = (postcode ?? '').trim();
  if (!trimmed) {
    return { success: false, error: 'Enter a postcode to look up your town or city.' };
  }

  const result = await lookupCityFromPostcode(trimmed);
  if (!result) {
    // Never echo the postcode back in the error.
    return { success: false, error: "We couldn't find a town for that postcode. You can type your town in directly." };
  }
  return { success: true, city: result.city, region: result.region };
}
