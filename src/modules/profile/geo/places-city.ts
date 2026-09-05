/**
 * KAN-341 (epic KAN-349) — resolve a town/city from a postcode via Google Places
 * (New) Text Search, reusing the existing GOOGLE_PLACES_API_KEY (KAN-207, the
 * Convene venues integration). No new secret needed.
 *
 * PRIVACY INVARIANT (critical): the postcode is used ONLY transiently here — it
 * is never persisted, never logged, and never placed in an error message. We
 * return the coarse locality (town/city + optional region) only; the caller
 * stores just the city in profiles.city. The raw postcode is discarded when this
 * function returns.
 *
 * GLOBAL: the postcode is passed as a free-text query with no region restriction,
 * so the same path resolves postcodes/zip codes in any country (Q6: "assume
 * global so it's more reusable").
 */

const PLACES_TEXT_SEARCH_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

export interface CityLookupResult {
  city: string;
  /** administrative_area_level_1 (e.g. "Greater London", "California"), if present. */
  region: string | null;
}

interface PlacesAddressComponent {
  longText?: string;
  types?: string[];
}

/**
 * Pure: pick the coarse locality from a Places result's address components.
 * Prefers postal_town (UK) → locality (most countries) → admin_area_2 (county).
 * Exported for direct unit testing without a network call.
 */
export function extractCity(components: ReadonlyArray<PlacesAddressComponent>): CityLookupResult | null {
  const pick = (type: string): string | null =>
    components.find((c) => c.types?.includes(type))?.longText ?? null;

  const city = pick('postal_town') ?? pick('locality') ?? pick('administrative_area_level_2');
  if (!city) return null;
  return { city, region: pick('administrative_area_level_1') };
}

/**
 * Resolve a postcode to a town/city via Google Places. Returns null on any
 * failure (no key, network error, no result) — the caller falls back to manual
 * city entry. NEVER logs or returns the postcode.
 */
export async function lookupCityFromPostcode(
  postcode: string,
  // Injected for tests; defaults to the global fetch.
  fetchImpl: typeof fetch = fetch,
): Promise<CityLookupResult | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const query = (postcode ?? '').trim();
  if (!key || !query) return null;

  try {
    const res = await fetchImpl(PLACES_TEXT_SEARCH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        // Address components only — no place id, no lat/lng (data minimisation).
        'X-Goog-FieldMask': 'places.addressComponents',
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      places?: Array<{ addressComponents?: PlacesAddressComponent[] }>;
    };
    const components = data.places?.[0]?.addressComponents ?? [];
    return extractCity(components);
  } catch {
    // Swallow — never surface the postcode in an error path.
    return null;
  }
}
