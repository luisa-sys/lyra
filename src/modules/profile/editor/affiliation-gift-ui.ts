/**
 * KAN-487 — v0.8 profile editor: pure decisions behind §02 "Where you might
 * know me from" and §03 "Gifts" (spec v0.8 §02, §03; plan §C rows 02–03).
 *
 * The section components under `src/app/dashboard/profile/editor/` stay thin:
 * they render what these functions return and dispatch reducer actions.
 * Jest runs without a DOM, so the rules live here, as plain data in / out.
 *
 * Rules:
 *   - §02 has three groups in this order: Schools, Organisations,
 *     Communities, with "Add school" / "Add organisation" / "Add community",
 *     up to 7 entries each (`AFFILIATION_RULES.capPerType`).
 *   - Schools: Name (120, required) + Postcode (12, required) + Description
 *     (250). Organisations / Communities: Name (120, required) + Location
 *     (120, optional) + Description (250). Field labels match the labels
 *     `field-validation.ts` puts in its error messages.
 *   - The reducer keeps ONE affiliation undo for all three groups, indexed
 *     into the whole `affiliations` array; the undo row is shown inside the
 *     removed row's own group, at its position among that group's rows.
 *   - Name autocomplete: look up only from 3 characters (whitespace does not
 *     count) and never for the name the member just picked or dismissed;
 *     show an answer only when it belongs to the text now in the box; with
 *     no matches show no list (the plain field is the manual fallback);
 *     with matches the list always ends with "add your own" (KAN-451).
 *   - §03 AI slot (step 4): only APPROVED AI suggestions are shown.
 */

import { AFFILIATION_RULES } from '@/modules/profile/profile-rules';
import {
  buildSuggestionOptions,
  shouldSuggest,
  type SuggestionOption,
} from '@/modules/profile/geo/places-schools';
import type { AffRow, AffiliationType, AiGiftRow } from '@/modules/profile/editor/editor-state';

// ── §02 groups and fields ───────────────────────────────────────────────

export interface AffiliationGroupDef {
  type: AffiliationType;
  heading: string;
  addLabel: string;
}

/** The three §02 groups, in spec order. */
export const AFFILIATION_GROUPS: readonly AffiliationGroupDef[] = [
  { type: 'school', heading: 'Schools', addLabel: 'Add school' },
  { type: 'organisation', heading: 'Organisations', addLabel: 'Add organisation' },
  { type: 'community', heading: 'Communities', addLabel: 'Add community' },
];

export interface AffiliationFieldSpec {
  nameLabel: string;
  nameMax: number;
  locationLabel: string;
  locationMax: number;
  locationRequired: boolean;
  descriptionLabel: string;
  descriptionMax: number;
}

/** The fields a row of this type shows, with their limits (§02). */
export function affiliationFieldSpec(type: AffiliationType): AffiliationFieldSpec {
  const isSchool = type === 'school';
  return {
    nameLabel: 'Name',
    nameMax: AFFILIATION_RULES.nameMax,
    locationLabel: isSchool ? 'Postcode' : 'Location',
    locationMax: isSchool ? AFFILIATION_RULES.schoolPostcodeMax : AFFILIATION_RULES.locationMax,
    locationRequired: isSchool,
    descriptionLabel: 'Description',
    descriptionMax: AFFILIATION_RULES.descriptionMax,
  };
}

/** The rows of one group, in their stored order. */
export function rowsOfType(rows: readonly AffRow[], type: AffiliationType): AffRow[] {
  return rows.filter((r) => r.affiliationType === type);
}

/**
 * Where an undo row goes inside its group: the number of rows of the same
 * type that sit before `globalIndex` in the whole affiliations array.
 */
export function undoIndexInGroup(rows: readonly AffRow[], globalIndex: number, type: AffiliationType): number {
  const end = Math.max(0, Math.min(globalIndex, rows.length));
  let n = 0;
  for (let i = 0; i < end; i++) if (rows[i].affiliationType === type) n++;
  return n;
}

// ── §02 name autocomplete ───────────────────────────────────────────────

/** Debounce before a name lookup (plan §C: 350 ms). */
export const SUGGEST_DEBOUNCE_MS = 350;

/** The last lookup answer, tagged with the text it answered. */
export interface SuggestAnswer {
  query: string;
  names: readonly string[];
}

/**
 * Should the picker look up `value`? Not under 3 characters, and not for the
 * name the member just picked or dismissed (`closedFor`).
 */
export function shouldLookUpName(value: string, closedFor: string | null): boolean {
  return closedFor !== value && shouldSuggest(value);
}

/**
 * The options to show under the name field: none unless the answer is for
 * exactly the text in the box, the list was not closed for that text, and at
 * least one name matched. Otherwise the matches, then "add your own".
 */
export function visibleNameOptions(
  value: string,
  answer: SuggestAnswer | null,
  closedFor: string | null,
): SuggestionOption[] {
  if (answer === null || answer.query !== value || closedFor === value) return [];
  if (answer.names.length === 0) return [];
  return buildSuggestionOptions(
    value,
    answer.names.map((name) => ({ name, address: null, postcode: null })),
  );
}

// ── §03 AI slot ─────────────────────────────────────────────────────────

/** Step 4 shows only approved AI suggestions (never an unapproved one). */
export function approvedAiGifts(aiGifts: readonly AiGiftRow[]): AiGiftRow[] {
  return aiGifts.filter((g) => g.approved === true);
}
