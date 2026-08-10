/**
 * KAN-451 — the Places call behind the schools / organisations / communities
 * picker.
 *
 * Reuses the KAN-341 town/city integration (`src/lib/geo/places-city.ts`) —
 * same Google Places (New) Text Search endpoint, same existing key, no new
 * vendor and no new secret. The key is read via `src/modules/platform/env.ts` rather than
 * `process.env` directly (CTL-037 — a new file reading env fails the ratchet),
 * which is also why this module is kept SEPARATE from the pure picker logic:
 * the client component must not pull the env accessor into the browser bundle.
 *
 * Every failure path returns an empty list. See `places-schools.ts` for the
 * degrade-never-block rule this serves.
 */

import { env } from '@/modules/platform/env';
import {
  MAX_SUGGESTIONS,
  extractSuggestion,
  placeTypeForAffiliation,
  shouldSuggest,
  type PlaceSuggestion,
  type PlacesResult,
} from './places-schools';

const PLACES_TEXT_SEARCH_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

/**
 * Look up matching places by name. Returns [] on ANY failure so the caller can
 * fall back to free text — never throws, never logs the query.
 */
export async function lookupPlaceSuggestions(
  query: string,
  affiliationType: string,
  // Injected for tests; defaults to the global fetch.
  fetchImpl: typeof fetch = fetch,
): Promise<PlaceSuggestion[]> {
  const key = env.placesApiKey();
  const textQuery = (query ?? '').trim();
  if (!key || !shouldSuggest(textQuery)) return [];

  const includedType = placeTypeForAffiliation(affiliationType);

  try {
    const res = await fetchImpl(PLACES_TEXT_SEARCH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        // Name, address and address components only — no place id, no lat/lng,
        // no opening hours or ratings (data minimisation, as KAN-341).
        'X-Goog-FieldMask':
          'places.displayName,places.formattedAddress,places.addressComponents',
      },
      body: JSON.stringify({
        textQuery,
        maxResultCount: MAX_SUGGESTIONS,
        ...(includedType ? { includedType } : {}),
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { places?: PlacesResult[] };
    return (data.places ?? [])
      .map(extractSuggestion)
      .filter((s): s is PlaceSuggestion => s !== null)
      .slice(0, MAX_SUGGESTIONS);
  } catch {
    // Swallow — a lookup failure must never stop someone adding their school.
    return [];
  }
}
