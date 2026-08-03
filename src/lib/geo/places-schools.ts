/**
 * KAN-451 — the pure half of the schools / organisations / communities picker:
 * types, and every decision the UI makes about what to show.
 *
 * CLIENT-SAFE BY CONSTRUCTION. This module imports nothing — in particular not
 * `src/lib/env.ts` — so the picker component can use it without dragging the
 * environment accessor (or the Places client) into the browser bundle. The
 * network call lives next door in `places-schools-lookup.ts`, which only the
 * server action imports.
 *
 * DEGRADE, NEVER BLOCK. A member whose school is not in any list must always be
 * able to add it, which is why `buildSuggestionOptions` always ends with an
 * explicit "add your own" option. Nothing here decides whether an affiliation
 * can be SAVED — that is the server action's job, and the KAN-404 postcode rule
 * lives there.
 */

/**
 * Don't call out until there is enough to match on. One or two characters
 * matches half the world and costs a request per keystroke.
 */
export const MIN_SUGGEST_QUERY_LENGTH = 3;

/** Enough to choose from, few enough to read without scrolling. */
export const MAX_SUGGESTIONS = 5;

export interface PlaceSuggestion {
  /** The place's display name — what goes into `school_name`. */
  name: string;
  /** Short address line, so two same-named schools can be told apart. */
  address: string | null;
  /**
   * The `postal_code` component when Places returned one. Used to pre-fill the
   * postcode field; it is still validated by `isSchoolPostcodeValid` before any
   * school is saved.
   */
  postcode: string | null;
}

/** One row of the picker: either a real match, or the "add your own" escape. */
export type SuggestionOption =
  | ({ kind: 'place' } & PlaceSuggestion)
  | { kind: 'custom'; name: string };

export interface PlacesAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

/** One row of a Places response, narrowed to the fields we ask for. */
export interface PlacesResult {
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: PlacesAddressComponent[];
}

/**
 * Pure: has the member typed enough for a lookup to be worth making?
 * Whitespace doesn't count.
 */
export function shouldSuggest(query: string | null | undefined): boolean {
  return (query ?? '').trim().length >= MIN_SUGGEST_QUERY_LENGTH;
}

/**
 * Pure: the Places primary type to bias the search towards, or null for no
 * bias. Schools are a well-defined place type; "organisation" and "community"
 * are not, so those searches stay unrestricted rather than guessing.
 */
export function placeTypeForAffiliation(affiliationType: string): string | null {
  return affiliationType === 'school' ? 'school' : null;
}

/**
 * Pure: reshape one Places result into a suggestion. Returns null when there is
 * no usable name — a nameless row is not something anyone can pick.
 * Exported for direct unit testing without a network call.
 */
export function extractSuggestion(place: PlacesResult): PlaceSuggestion | null {
  const name = (place.displayName?.text ?? '').trim();
  if (!name) return null;

  const components = place.addressComponents ?? [];
  const postal = components.find((c) => c.types?.includes('postal_code'));
  const postcode = (postal?.shortText ?? postal?.longText ?? '').trim();

  const address = (place.formattedAddress ?? '').trim();

  return {
    name,
    address: address || null,
    postcode: postcode || null,
  };
}

/**
 * Pure: the list the picker renders. Real matches first, then ALWAYS an
 * explicit "add your own" option carrying exactly what the member typed.
 *
 * That last option is the whole safety net of this feature: a school missing
 * from the provider's data, a newly opened one, a home-education group, a
 * community that exists only on a noticeboard. It is built here rather than in
 * the component so that removing it is a test failure and not a silent
 * regression in JSX.
 */
export function buildSuggestionOptions(
  query: string,
  suggestions: readonly PlaceSuggestion[],
): SuggestionOption[] {
  const typed = (query ?? '').trim();
  const options: SuggestionOption[] = suggestions
    .slice(0, MAX_SUGGESTIONS)
    .map((s) => ({ kind: 'place' as const, ...s }));

  if (typed) options.push({ kind: 'custom', name: typed });
  return options;
}

/**
 * Pure: what the location field should hold after a suggestion is picked.
 * A postcode the member typed themselves is never overwritten — picking a
 * suggestion may only fill a blank.
 */
export function resolvePickedLocation(
  picked: PlaceSuggestion,
  currentLocation: string | null | undefined,
): string {
  const current = (currentLocation ?? '').trim();
  if (current !== '') return current;
  return picked.postcode ?? '';
}
