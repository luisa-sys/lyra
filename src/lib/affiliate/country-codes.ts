/**
 * KAN-186: supported delivery countries for the recommendation engine.
 *
 * This list backs the "Delivery country" selector on the profile edit page
 * and is the canonical set of countries that:
 *   1. We accept on the `profiles.delivery_country_code` column (schema-level
 *      check constraint allows any ISO-2; the UI restricts to this allowlist).
 *   2. The eligibility matrix (KAN-187) is seeded for.
 *   3. The affiliate-link smoke monitor (KAN-194) exercises.
 *
 * Order matches the rollout priority for Phase 1: UK first (primary market),
 * then the Earn Globally umbrella, then North America, then a small APAC tail.
 * The order is also the display order in the UI <select>.
 *
 * Adding a country here ALONE does not make recommendations work there — the
 * eligibility matrix (KAN-187) must also have entries for it. Keep the two
 * lists in sync; the seed script for KAN-187 reads this allowlist.
 */
export const SUPPORTED_DELIVERY_COUNTRIES = [
  { code: 'GB', name: 'United Kingdom' },
  { code: 'IE', name: 'Ireland' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'IT', name: 'Italy' },
  { code: 'ES', name: 'Spain' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'JP', name: 'Japan' },
] as const;

export type SupportedDeliveryCountry =
  (typeof SUPPORTED_DELIVERY_COUNTRIES)[number]['code'];

const SUPPORTED_CODES: ReadonlySet<string> = new Set(
  SUPPORTED_DELIVERY_COUNTRIES.map((c) => c.code)
);

/**
 * Normalise input to upper-case ISO-2 and verify it's in the supported list.
 * Returns the normalised code or null. Empty/whitespace input returns null
 * (the caller should treat null as "clear the field").
 */
export function normaliseDeliveryCountry(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const upper = trimmed.toUpperCase();
  return SUPPORTED_CODES.has(upper) ? upper : null;
}

/**
 * Type guard for the strict ISO-2 format that the DB check constraint enforces.
 * This is the wider guard (any ISO-2) vs. `normaliseDeliveryCountry` which
 * tightens to the supported set.
 */
export function isIsoAlpha2(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value);
}
