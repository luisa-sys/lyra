/**
 * KAN-487 — v0.8 profile editor: ONE validator for the browser (pre-flight and
 * live field errors) and the server action (authoritative), so a member sees
 * the same message in both places (spec v0.8 §3 "All character limits include
 * spaces and are enforced consistently in browser and server … Validate caps
 * per group and per user"; plan §A "validate-save-payload.ts").
 *
 * Every text field and link goes through the step-3 validators
 * (./field-validation, ../free-text, ../member-url), so limits, line-break
 * handling and the contact-detail filter are identical to the other write
 * paths. Pure: no Supabase, no `'use client'`, no server-only imports.
 *
 * Error keys:
 *   profile.<field>        fixed profile fields; `profile.lyra_id` for the ID
 *   manual_of_me.<field>   §05 prompts
 *   <clientKey>.<field>    a list / affiliation / question row
 *   photo                  the profile photo
 *   lists.<listKey>        a list over its cap
 *   affiliations.<type>    more than 7 affiliations of one type
 *   questions.custom       more than 10 custom questions
 *
 * Exports:
 *   validateEditorState(state)            full client state, incl. caps
 *   validatePayloadForServer(payload, ctx) the save DIFF, field rules only;
 *                                          returns the CLEANED payload
 *   isSavePayloadShape(v)                  nested shape check before that
 *   validateForPublish(state)              ALL missing identity items at once
 */

import {
  LIST_KEYS,
  type AffRow,
  type CustomQuestionRow,
  type EditorRow,
  type EditorState,
  type ListKey,
  type PresetQuestionRow,
  type ProfileFieldKey,
  type SaveAffiliationUpsert,
  type SaveItemUpsert,
  type SaveMode,
  type SavePayload,
  type SaveProfilePatch,
  type SaveQuestionUpsert,
} from '@/modules/profile/editor/editor-state';
import {
  MANUAL_OF_ME_LABELS,
  validateAffiliationDescription,
  validateAffiliationLocation,
  validateAffiliationName,
  validateGroupLabel,
  validateItemDescription,
  validateItemTitle,
  validateProfileField,
} from '@/modules/profile/field-validation';
import { validateFreeText, type FreeTextResult } from '@/modules/profile/free-text';
import { parseMemberUrl } from '@/modules/profile/member-url';
import { AFFILIATION_RULES, checkLyraId, itemRuleFor } from '@/modules/profile/profile-rules';
import {
  MANUAL_OF_ME_FIELDS,
  MANUAL_OF_ME_MAX_LENGTHS,
  isManualOfMeField,
} from '@/modules/profile/manual-of-me-fields';
import { isCountryCode } from '@/modules/profile/countries';
import { isAffiliationType, isSchoolPostcodeValid, requiresPostcode } from '@/modules/profile/affiliation-rules';

// ── Limits (spec v0.8 §09) ──────────────────────────────────────────────
// Mirrors src/app/dashboard/profile/conversation-starters-fields.ts, which a
// module may not import (depcruise `no-module-to-app`). Both copies mirror
// the KAN-484 DB constraints and are pinned to the spec literals by tests.

/** Longest member-written question (`pcs_custom_prompt_length`). */
export const CUSTOM_PROMPT_MAX = 180;
/** Longest answer to a member-written question. */
export const CUSTOM_ANSWER_MAX = 500;
/** How many questions a member may write themselves. */
export const CUSTOM_QUESTION_CAP = 10;
/** Fallback when a preset's `answer_max` is unknown (the DB default). */
export const DEFAULT_PRESET_ANSWER_MAX = 500;
/** Table ceiling on any answer (`pcs_answer_length`). */
export const ANSWER_HARD_MAX = 2000;

/** Categories with no link field (spec v0.8 §01, §04, §06 Quotes, §08). */
export const NO_URL_CATEGORIES: ReadonlySet<string> = new Set([
  'quotes',
  'causes',
  'proud_of',
  'gifts_to_avoid',
  'current_problems',
]);

// ── Copy ────────────────────────────────────────────────────────────────
// Reused verbatim from db-error-copy.ts TRIGGER_COPY where a trigger already
// says the same thing, so browser and database errors read alike.

export const SECTION_CAP_ERROR = 'You’ve reached the limit for this section. Remove an entry to add another.';
export const CUSTOM_QUESTION_CAP_ERROR = 'You can write up to 10 of your own questions. Remove one to add another.';
export const PUBLISHED_PHOTO_ERROR = 'A published profile needs a photo. Add a new photo before removing this one.';
export const LYRA_ID_LOCKED_ERROR = 'Your CheckLyra ID can’t be changed after publishing.';
export const SCHOOL_POSTCODE_ERROR =
  'Schools need a postcode (full or partial) so people can tell schools with the same name apart.';
// Not in the spec; founder-approved 2026-11-23 with the PR #1238 error messages:
export const NO_URL_ERROR = 'Links can’t be added to this section.';
export const COUNTRY_ERROR = 'Choose a country from the list.';
export const INVALID_ENTRY_ERROR = 'This entry can’t be saved here. Reload to continue.';

/** Publish blockers (approved copy, KAN-487 brief). */
export const PUBLISH_PHOTO_MISSING = 'Add a profile photo';
export const PUBLISH_NAME_MISSING = 'Add a display name';
export const PUBLISH_ID_MISSING = 'Choose a CheckLyra ID';

export type ValidationResult = { ok: true } | { ok: false; errors: Record<string, string> };

// ── Shared field rules ──────────────────────────────────────────────────

type Errors = Record<string, string>;

function put(errors: Errors, key: string, r: FreeTextResult): void {
  if (!r.ok && errors[key] === undefined) errors[key] = r.error;
}

function isBlank(v: string | null | undefined): boolean {
  return typeof v !== 'string' || v.trim() === '';
}

/** The cleaned text of a passing check (null when empty), or null. */
function cleaned(r: FreeTextResult): string | null {
  return r.ok ? r.value : null;
}

/**
 * A profile text field. Country must be '' or an ISO 3166-1 alpha-2 code.
 * Returns the cleaned value (null when empty).
 */
function checkProfileField(errors: Errors, key: ProfileFieldKey, raw: string | null | undefined): string | null {
  if (key === 'country') {
    if (isBlank(raw)) return null;
    if (!isCountryCode(raw)) errors['profile.country'] = COUNTRY_ERROR;
    return isCountryCode(raw) ? raw : null;
  }
  const r = validateProfileField(key, raw ?? '');
  put(errors, `profile.${key}`, r);
  return cleaned(r);
}

const PROFILE_FIELD_KEYS: readonly ProfileFieldKey[] = [
  'display_name',
  'headline',
  'city',
  'country',
  'bio_short',
  'gift_voucher_hint',
  'billboard',
];

function checkManualOfMeField(errors: Errors, key: string, raw: unknown): string | null {
  if (!isManualOfMeField(key) || (raw !== null && typeof raw !== 'string')) {
    errors[`manual_of_me.${key}`] = INVALID_ENTRY_ERROR;
    return null;
  }
  const r = validateFreeText(raw, { label: MANUAL_OF_ME_LABELS[key], max: MANUAL_OF_ME_MAX_LENGTHS[key], multiline: true });
  put(errors, `manual_of_me.${key}`, r);
  return cleaned(r);
}

interface ItemFields {
  key: string;
  category: string;
  title: string | null;
  description: string | null;
  url: string | null;
  groupLabel: string | null | undefined;
}

interface CleanItemText {
  title: string;
  description: string | null;
  url: string | null;
  groupLabel: string | null;
}

/**
 * One member list entry: per-category limits, required title, link rules.
 * Returns the cleaned text (`.value` of each check, the parsed link).
 */
function checkItem(errors: Errors, it: ItemFields): CleanItemText {
  const out: CleanItemText = { title: '', description: null, url: null, groupLabel: null };
  if (itemRuleFor(it.category) === null) {
    errors[`${it.key}.category`] = INVALID_ENTRY_ERROR;
    return out;
  }
  const title = validateItemTitle(it.category, it.title);
  put(errors, `${it.key}.title`, title);
  out.title = cleaned(title) ?? '';
  const description = validateItemDescription(it.category, it.description);
  put(errors, `${it.key}.description`, description);
  out.description = cleaned(description);
  if (!isBlank(it.url)) {
    if (NO_URL_CATEGORIES.has(it.category)) {
      errors[`${it.key}.url`] = NO_URL_ERROR;
    } else {
      const u = parseMemberUrl(it.url);
      if (!u.ok) errors[`${it.key}.url`] = u.error;
      else out.url = u.url;
    }
  }
  if (!isBlank(it.groupLabel)) {
    const label = validateGroupLabel(it.groupLabel);
    put(errors, `${it.key}.group_label`, label);
    out.groupLabel = cleaned(label);
  }
  return out;
}

interface AffFields {
  key: string;
  type: string;
  name: string | null;
  location: string | null;
  description: string | null;
}

interface CleanAffText {
  name: string;
  location: string | null;
  description: string | null;
}

/**
 * One affiliation: name required; a school needs a valid postcode (§02).
 * Returns the cleaned text.
 */
function checkAffiliation(errors: Errors, a: AffFields): CleanAffText {
  if (!isAffiliationType(a.type)) {
    errors[`${a.key}.affiliation_type`] = INVALID_ENTRY_ERROR;
    return { name: '', location: null, description: null };
  }
  const isSchool = requiresPostcode(a.type);
  const name = validateAffiliationName(a.name);
  put(errors, `${a.key}.name`, name);
  const loc = validateAffiliationLocation(isSchool, a.location);
  put(errors, `${a.key}.location`, loc);
  if (loc.ok && isSchool && !isSchoolPostcodeValid(a.location)) errors[`${a.key}.location`] = SCHOOL_POSTCODE_ERROR;
  const description = validateAffiliationDescription(a.description);
  put(errors, `${a.key}.description`, description);
  return { name: cleaned(name) ?? '', location: cleaned(loc), description: cleaned(description) };
}

function clampAnswerMax(answerMax: number | null | undefined): number {
  const n = typeof answerMax === 'number' && Number.isFinite(answerMax) ? answerMax : DEFAULT_PRESET_ANSWER_MAX;
  return Math.max(1, Math.min(n, ANSWER_HARD_MAX));
}

function checkAnswer(errors: Errors, key: string, raw: string | null | undefined, max: number): string {
  const r = validateFreeText(raw, { label: 'Your answer', max, multiline: true, required: true });
  put(errors, `${key}.answer`, r);
  return cleaned(r) ?? '';
}

function checkCustomPrompt(errors: Errors, key: string, raw: string | null | undefined): string {
  const r = validateFreeText(raw, { label: 'Your question', max: CUSTOM_PROMPT_MAX, required: true });
  put(errors, `${key}.custom_prompt`, r);
  return cleaned(r) ?? '';
}

function checkLyraIdInto(errors: Errors, raw: string): void {
  const r = checkLyraId(raw);
  if (!r.ok) errors['profile.lyra_id'] = r.error;
}

function result(errors: Errors): ValidationResult {
  return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors };
}

// ── Client state ────────────────────────────────────────────────────────

/** A row with nothing typed in it: ignored, never saved, not counted. */
export function isBlankRow(row: EditorRow): boolean {
  return isBlank(row.title) && isBlank(row.description) && isBlank(row.url);
}

function isBlankAffiliation(a: AffRow): boolean {
  return isBlank(a.name) && isBlank(a.location) && isBlank(a.description);
}

function isBlankCustom(q: CustomQuestionRow): boolean {
  return isBlank(q.customPrompt) && isBlank(q.answer);
}

function checkListsAndCaps(errors: Errors, lists: EditorState['lists']): void {
  const perGroup = new Map<string, { count: number; cap: number; listKey: ListKey }>();
  for (const listKey of LIST_KEYS) {
    for (const row of lists[listKey]) {
      if (isBlankRow(row)) continue;
      checkItem(errors, {
        key: row.key,
        category: row.category,
        title: row.title,
        description: row.description,
        url: row.url,
        groupLabel: row.groupLabel,
      });
      const rule = itemRuleFor(row.category);
      if (rule === null) continue;
      const g = perGroup.get(rule.capGroup) ?? { count: 0, cap: rule.cap, listKey };
      g.count += 1;
      perGroup.set(rule.capGroup, g);
    }
  }
  for (const g of perGroup.values()) {
    if (g.count > g.cap) errors[`lists.${g.listKey}`] = SECTION_CAP_ERROR;
  }
}

function checkAffiliationsAndCaps(errors: Errors, rows: AffRow[]): void {
  const perType = new Map<string, number>();
  for (const a of rows) {
    if (isBlankAffiliation(a)) continue;
    checkAffiliation(errors, {
      key: a.key,
      type: a.affiliationType,
      name: a.name,
      location: a.location,
      description: a.description,
    });
    perType.set(a.affiliationType, (perType.get(a.affiliationType) ?? 0) + 1);
  }
  for (const [type, n] of perType) {
    if (n > AFFILIATION_RULES.capPerType) errors[`affiliations.${type}`] = SECTION_CAP_ERROR;
  }
}

function checkPreset(errors: Errors, q: PresetQuestionRow): void {
  if (isBlank(q.answer)) return; // unanswered: not saved, not shown
  checkAnswer(errors, q.key, q.answer, clampAnswerMax(q.answerMax));
}

function checkQuestions(errors: Errors, rows: EditorState['questions']): void {
  let custom = 0;
  for (const q of rows) {
    if (q.kind === 'preset') {
      checkPreset(errors, q);
      continue;
    }
    if (isBlankCustom(q)) continue;
    custom += 1;
    checkCustomPrompt(errors, q.key, q.customPrompt);
    checkAnswer(errors, q.key, q.answer, CUSTOM_ANSWER_MAX);
  }
  if (custom > CUSTOM_QUESTION_CAP) errors['questions.custom'] = CUSTOM_QUESTION_CAP_ERROR;
}

/**
 * Validate the whole client state: every field rule plus every cap, counted
 * over the full state (spec §3 "Validate caps per group and per user").
 * Blank rows are ignored. An empty CheckLyra ID is allowed here (Save Draft);
 * `validateForPublish` requires it.
 */
export function validateEditorState(state: EditorState): ValidationResult {
  const errors: Errors = {};
  for (const key of PROFILE_FIELD_KEYS) checkProfileField(errors, key, state.fields[key]);
  if (!state.lyraIdLocked && state.lyraId.trim() !== '') checkLyraIdInto(errors, state.lyraId);
  if (state.isPublished && (state.photo.kind === 'removed' || state.photo.kind === 'none')) {
    errors.photo = PUBLISHED_PHOTO_ERROR;
  }
  for (const f of MANUAL_OF_ME_FIELDS) checkManualOfMeField(errors, f, state.manualOfMe[f]);
  checkListsAndCaps(errors, state.lists);
  checkAffiliationsAndCaps(errors, state.affiliations);
  checkQuestions(errors, state.questions);
  return result(errors);
}

// ── Server: the save DIFF ───────────────────────────────────────────────

export interface ServerValidationContext {
  mode: SaveMode;
  /**
   * `answer_max` per preset prompt id, read by the server action. A preset
   * missing from the map uses DEFAULT_PRESET_ANSWER_MAX.
   */
  presetAnswerMax?: ReadonlyMap<string, number | null>;
}

/**
 * `ok: true` carries the CLEANED payload to send to `save_profile`: every
 * text is the validator's `.value` (HTML and control characters stripped,
 * whitespace collapsed; null when empty), links are the parsed URL, and a
 * draft's refused CheckLyra ID is left out. Never send the raw client
 * strings (the checks ran on the cleaned text).
 */
export type ServerValidationResult =
  | { ok: true; payload: SavePayload; warnings: Record<string, string> }
  | { ok: false; errors: Record<string, string>; warnings: Record<string, string> };

function cleanItemUpsert(errors: Errors, u: SaveItemUpsert): SaveItemUpsert {
  const c = checkItem(errors, {
    key: u.client_key,
    category: u.category,
    title: u.title,
    description: u.description,
    url: u.url,
    groupLabel: u.group_label,
  });
  const body: SaveItemUpsert = {
    client_key: u.client_key,
    category: u.category,
    title: c.title,
    description: c.description,
    url: c.url,
    group_label: c.groupLabel,
  };
  return u.id === undefined ? body : { id: u.id, ...body };
}

function cleanAffiliationUpsert(errors: Errors, u: SaveAffiliationUpsert): SaveAffiliationUpsert {
  const c = checkAffiliation(errors, {
    key: u.client_key,
    type: u.affiliation_type,
    name: u.school_name,
    location: u.school_location,
    description: u.description,
  });
  const body: SaveAffiliationUpsert = {
    client_key: u.client_key,
    affiliation_type: u.affiliation_type,
    school_name: c.name,
    school_location: c.location,
    description: c.description,
    show_on_profile: u.show_on_profile,
  };
  return u.id === undefined ? body : { id: u.id, ...body };
}

function cleanQuestionUpsert(errors: Errors, u: SaveQuestionUpsert, ctx: ServerValidationContext): SaveQuestionUpsert {
  const out: SaveQuestionUpsert = { ...u };
  const hasPrompt = typeof u.prompt_id === 'string' && u.prompt_id !== '';
  const hasCustom = typeof u.custom_prompt === 'string';
  if (hasPrompt && hasCustom) {
    errors[`${u.client_key}.custom_prompt`] = INVALID_ENTRY_ERROR;
  } else if (hasCustom) {
    out.custom_prompt = checkCustomPrompt(errors, u.client_key, u.custom_prompt);
    out.answer = checkAnswer(errors, u.client_key, u.answer, CUSTOM_ANSWER_MAX);
  } else if (hasPrompt) {
    out.answer = checkAnswer(errors, u.client_key, u.answer, clampAnswerMax(ctx.presetAnswerMax?.get(u.prompt_id as string)));
  } else if (u.id === undefined) {
    // A new answer must name a preset or carry its own question (pcs_prompt_source_xor).
    errors[`${u.client_key}.custom_prompt`] = INVALID_ENTRY_ERROR;
  } else {
    // Answer-only update of a stored row: the exact per-question limit is the
    // DB trigger enforce_pcs_answer_max(); the app checks the table ceiling.
    out.answer = checkAnswer(errors, u.client_key, u.answer, ANSWER_HARD_MAX);
  }
  return out;
}

function cleanProfilePatch(
  errors: Errors,
  warnings: Errors,
  p: SaveProfilePatch,
  mode: SaveMode,
): SaveProfilePatch | undefined {
  const out: SaveProfilePatch = {};
  for (const key of PROFILE_FIELD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(p, key)) continue;
    const value = checkProfileField(errors, key, p[key]);
    if (key === 'display_name') {
      // Not nullable in the DB. A published profile (or one being published)
      // may not lose its name (spec v0.8 §01; approved copy).
      if (value === null && mode !== 'draft' && errors['profile.display_name'] === undefined) {
        errors['profile.display_name'] = PUBLISH_NAME_MISSING;
      }
      out.display_name = value ?? '';
    } else {
      out[key] = value;
    }
  }
  if (p.slug !== undefined) {
    if (mode === 'published') {
      errors['profile.lyra_id'] = LYRA_ID_LOCKED_ERROR;
    } else {
      const id = checkLyraId(p.slug);
      if (id.ok) out.slug = id.id;
      // Draft: identity is optional, so an invalid ID is a warning and is
      // left out of the cleaned payload; the rest still saves.
      else if (mode === 'draft') warnings.lyra_id = id.error;
      else errors['profile.lyra_id'] = id.error;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Validate the save DIFF in the server action, before moderation and the RPC,
 * and return the CLEANED payload to send. Applies the same field rules as
 * `validateEditorState` to whatever sections are present. Expects a payload
 * that passed `isSavePayloadShape`.
 *
 * Caps are NOT checked here: a diff does not hold the full row set, and the
 * DB triggers (enforce_profile_item_rules, enforce_affiliation_rules,
 * enforce_pcs_custom_cap) enforce every cap inside the save_profile
 * transaction. The browser checks caps on the full state via
 * `validateEditorState`.
 *
 * Draft mode: an invalid `profile.slug` is returned in `warnings.lyra_id`
 * (not an error) and left out of the cleaned payload.
 * Publish / published: a blank `display_name` is refused ("Add a display name").
 */
export function validatePayloadForServer(payload: SavePayload, ctx: ServerValidationContext): ServerValidationResult {
  const errors: Errors = {};
  const warnings: Errors = {};
  const out: SavePayload = { base_updated_at: payload.base_updated_at ?? null };

  if (payload.profile) {
    const profile = cleanProfilePatch(errors, warnings, payload.profile, ctx.mode);
    if (profile) out.profile = profile;
  }
  if (payload.photo !== undefined) {
    if (ctx.mode === 'published' && payload.photo.action === 'remove') errors.photo = PUBLISHED_PHOTO_ERROR;
    out.photo = payload.photo;
  }
  if (payload.items) {
    out.items = {
      upsert: payload.items.upsert.map((u) => cleanItemUpsert(errors, u)),
      delete: [...payload.items.delete],
    };
  }
  if (payload.ai_gifts) {
    out.ai_gifts = { approve: [...payload.ai_gifts.approve], delete: [...payload.ai_gifts.delete] };
  }
  if (payload.affiliations) {
    out.affiliations = {
      upsert: payload.affiliations.upsert.map((u) => cleanAffiliationUpsert(errors, u)),
      delete: [...payload.affiliations.delete],
    };
  }
  if (payload.manual_of_me !== undefined) {
    if (payload.manual_of_me === null) {
      out.manual_of_me = null;
    } else {
      // Iterate the fixed allowlist, never the client's keys: a property name
      // written here must not come from user input (CodeQL
      // js/remote-property-injection). Unknown keys are already refused by
      // isSavePayloadShape.
      const src = payload.manual_of_me as Partial<Record<(typeof MANUAL_OF_ME_FIELDS)[number], string | null>>;
      const mom = {} as Record<(typeof MANUAL_OF_ME_FIELDS)[number], string | null>;
      for (const f of MANUAL_OF_ME_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(src, f)) mom[f] = checkManualOfMeField(errors, f, src[f]);
      }
      out.manual_of_me = mom as unknown as SavePayload['manual_of_me'];
    }
  }
  if (payload.questions) {
    out.questions = {
      upsert: payload.questions.upsert.map((u) => cleanQuestionUpsert(errors, u, ctx)),
      delete: [...payload.questions.delete],
    };
  }
  return Object.keys(errors).length === 0 ? { ok: true, payload: out, warnings } : { ok: false, errors, warnings };
}

// ── Server: payload shape (before validation) ───────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrOrNull = (v: unknown): boolean => v === null || typeof v === 'string';
const isOptStrOrNull = (v: unknown): boolean => v === undefined || isStrOrNull(v);
const isUuid = (v: unknown): boolean => typeof v === 'string' && UUID_RE.test(v);
const isOptUuid = (v: unknown): boolean => v === undefined || isUuid(v);
const isKey = (v: unknown): boolean => typeof v === 'string' && v !== '';

function isUuidList(v: unknown): boolean {
  return Array.isArray(v) && v.every(isUuid);
}

/** `{upsert: Row[], delete: uuid[]}` (an absent section is fine). */
function isUpsertSection(v: unknown, row: (r: Obj) => boolean): boolean {
  if (v === undefined) return true;
  if (!isObj(v)) return false;
  const rows = v.upsert;
  return Array.isArray(rows) && rows.every((r) => isObj(r) && row(r)) && isUuidList(v.delete);
}

const PROFILE_PATCH_KEYS: ReadonlySet<string> = new Set([...PROFILE_FIELD_KEYS, 'slug']);

function isProfilePatchShape(v: unknown): boolean {
  if (v === undefined) return true;
  if (!isObj(v)) return false;
  return Object.entries(v).every(([k, x]) => PROFILE_PATCH_KEYS.has(k) && (k === 'slug' ? isStr(x) : isStrOrNull(x)));
}

function isPhotoShape(v: unknown): boolean {
  if (v === undefined) return true;
  if (!isObj(v) || !isStr(v.action) || !['keep', 'remove', 'set'].includes(v.action)) return false;
  return (v.staged_path === undefined || isStr(v.staged_path)) && (v.avatar_url === undefined || isStr(v.avatar_url));
}

function isItemRow(r: Obj): boolean {
  return (
    isOptUuid(r.id) &&
    isKey(r.client_key) &&
    isStr(r.category) &&
    isStr(r.title) &&
    isOptStrOrNull(r.description) &&
    isOptStrOrNull(r.url) &&
    isOptStrOrNull(r.group_label)
  );
}

function isAffRow(r: Obj): boolean {
  return (
    isOptUuid(r.id) &&
    isKey(r.client_key) &&
    isStr(r.affiliation_type) &&
    isStr(r.school_name) &&
    isOptStrOrNull(r.school_location) &&
    isOptStrOrNull(r.description) &&
    (r.show_on_profile === undefined || typeof r.show_on_profile === 'boolean')
  );
}

function isQuestionRow(r: Obj): boolean {
  return (
    isOptUuid(r.id) &&
    isKey(r.client_key) &&
    isOptUuid(r.prompt_id) &&
    (r.custom_prompt === undefined || isStr(r.custom_prompt)) &&
    isStr(r.answer) &&
    (r.sort_order === undefined || Number.isInteger(r.sort_order))
  );
}

function isAiGiftsShape(v: unknown): boolean {
  if (v === undefined) return true;
  return isObj(v) && isUuidList(v.approve) && isUuidList(v.delete);
}

function isManualOfMeShape(v: unknown): boolean {
  return v === undefined || v === null || (isObj(v) && Object.values(v).every(isStrOrNull));
}

/**
 * True when `v` has the SavePayload shape all the way down: sections are
 * objects, lists are arrays, ids are UUID strings, text is a string (or null
 * where nullable). The server action refuses anything else with a clean
 * validation error instead of crashing in validation or failing in the DB
 * with a generic error. PURE.
 */
export function isSavePayloadShape(v: unknown): v is SavePayload {
  if (!isObj(v)) return false;
  return (
    isOptStrOrNull(v.base_updated_at) &&
    isProfilePatchShape(v.profile) &&
    isPhotoShape(v.photo) &&
    isUpsertSection(v.items, isItemRow) &&
    isAiGiftsShape(v.ai_gifts) &&
    isUpsertSection(v.affiliations, isAffRow) &&
    isManualOfMeShape(v.manual_of_me) &&
    isUpsertSection(v.questions, isQuestionRow)
  );
}

// ── Publish ─────────────────────────────────────────────────────────────

/**
 * Every missing identity item, all at once, in spec §01 order (photo, display
 * name, CheckLyra ID). An empty list means the identity is complete.
 */
export function validateForPublish(state: EditorState): string[] {
  const missing: string[] = [];
  if (state.photo.kind !== 'stored' && state.photo.kind !== 'staged') missing.push(PUBLISH_PHOTO_MISSING);
  if (isBlank(state.fields.display_name)) missing.push(PUBLISH_NAME_MISSING);
  if (!checkLyraId(state.lyraId).ok) missing.push(PUBLISH_ID_MISSING);
  return missing;
}
