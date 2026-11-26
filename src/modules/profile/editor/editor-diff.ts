/**
 * KAN-487 — v0.8 profile editor: save DIFF builder and dirty check
 * (plan §A "Pure logic" → `editor-diff.ts`, plan §B "Payload").
 *
 * Pure: no Supabase calls, no `'use client'`, no server-only imports.
 *
 * `buildSavePayload(baseline, current, mode)` compares the state after the
 * last load / successful save (`baseline`) with the live editor state
 * (`current`) and returns ONLY what changed:
 *   - An absent section means "untouched". Deletes are explicit id lists of
 *     rows present in `baseline` and gone from `current` — never "absent means
 *     delete" (BUGS-74). An untouched section therefore never produces deletes.
 *   - New rows (no id) carry their `client_key` so the server can return the
 *     `{client_key: id}` map. Blank new rows are dropped (a row with only a
 *     link is not blank).
 *   - A stored preset answer cleared to blank goes in `questions.delete`.
 *   - `manual_of_me` is sent as the full object when any field changed.
 *   - `photo` carries only the staged storage path for `set`; the server
 *     action resolves it to `avatar_url` (the client never sends a URL).
 *   - `slug` is sent only while `baseline.firstPublishedAt` is null.
 *   - `sort_order` is sent on custom questions only.
 *
 * `isDirty(baseline, current)` is true exactly when the payload would carry a
 * change, so trailing whitespace and blank new rows never make the editor
 * dirty, and the Save button is enabled only when a save would send something.
 */

import { MANUAL_OF_ME_FIELDS, type ManualOfMe } from '@/modules/profile/manual-of-me-fields';
import {
  LIST_KEYS,
  type AffRow,
  type AiGiftRow,
  type CustomQuestionRow,
  type EditorRow,
  type EditorState,
  type ProfileFieldKey,
  type QuestionRow,
  type SaveAffiliationUpsert,
  type SaveItemUpsert,
  type SaveMode,
  type SavePayload,
  type SavePhotoPayload,
  type SaveProfilePatch,
  type SaveQuestionUpsert,
} from '@/modules/profile/editor/editor-state';

// ── Normalisation ───────────────────────────────────────────────────────

/** Comparison / wire form of a text value: trailing whitespace removed. */
function norm(v: string | null | undefined): string {
  return (v ?? '').trimEnd();
}

/** Normalised text, or null when empty (nullable DB columns). */
function normOrNull(v: string | null | undefined): string | null {
  const n = norm(v);
  return n.trim() === '' ? null : n;
}

function isBlankText(v: string | null | undefined): boolean {
  return norm(v).trim() === '';
}

// ── Profile fields + slug ───────────────────────────────────────────────

const NULLABLE_PROFILE_FIELDS = [
  'headline',
  'city',
  'country',
  'bio_short',
  'gift_voucher_hint',
  'billboard',
] as const satisfies readonly ProfileFieldKey[];

function diffProfile(baseline: EditorState, current: EditorState, mode: SaveMode): SaveProfilePatch | undefined {
  const patch: SaveProfilePatch = {};
  if (norm(baseline.fields.display_name) !== norm(current.fields.display_name)) {
    patch.display_name = norm(current.fields.display_name);
  }
  for (const f of NULLABLE_PROFILE_FIELDS) {
    if (norm(baseline.fields[f]) !== norm(current.fields[f])) patch[f] = normOrNull(current.fields[f]);
  }
  // The CheckLyra ID can change only before first publication. An empty ID
  // is never sent (the column is not nullable; publish validation catches it).
  const slug = norm(current.lyraId).trim();
  if (
    baseline.firstPublishedAt === null &&
    mode !== 'published' &&
    slug !== '' &&
    slug !== norm(baseline.lyraId).trim()
  ) {
    patch.slug = slug;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

// ── Photo ───────────────────────────────────────────────────────────────

function diffPhoto(baseline: EditorState, current: EditorState): SavePhotoPayload | undefined {
  const b = baseline.photo;
  const c = current.photo;
  if (c.kind === 'staged') {
    if (b.kind === 'staged' && b.path === c.path) return undefined;
    return { action: 'set', staged_path: c.path };
  }
  if (c.kind === 'removed' || c.kind === 'none') {
    return b.kind === 'stored' || b.kind === 'staged' ? { action: 'remove' } : undefined;
  }
  return undefined; // stored: keep (absent section = untouched)
}

// ── Generic row-section diff ────────────────────────────────────────────

interface Keyed {
  key: string;
  id: string | null;
}

/** Ids present in `before` and missing from `after` (the explicit delete list). */
function removedIds(before: ReadonlyArray<{ id: string | null }>, after: ReadonlyArray<{ id: string | null }>): string[] {
  const kept = new Set(after.map((r) => r.id).filter((id): id is string => id !== null));
  const out: string[] = [];
  for (const r of before) if (r.id !== null && !kept.has(r.id)) out.push(r.id);
  return out;
}

function byId<T extends Keyed>(rows: ReadonlyArray<T>): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) if (r.id !== null) m.set(r.id, r);
  return m;
}

function withId<T extends object>(id: string | null, body: T): T & { id?: string } {
  return id === null ? body : { id, ...body };
}

// ── Items ───────────────────────────────────────────────────────────────

function allListRows(s: EditorState): EditorRow[] {
  return LIST_KEYS.flatMap((k) => s.lists[k]);
}

/** Same rule as validate-save-payload `isBlankRow`: a link alone is not blank. */
function isBlankItem(r: EditorRow): boolean {
  return isBlankText(r.title) && isBlankText(r.description) && isBlankText(r.url);
}

function itemChanged(a: EditorRow, b: EditorRow): boolean {
  return (
    a.category !== b.category ||
    norm(a.title) !== norm(b.title) ||
    norm(a.description) !== norm(b.description) ||
    norm(a.url) !== norm(b.url) ||
    (a.groupLabel ?? null) !== (b.groupLabel ?? null)
  );
}

function itemUpsert(r: EditorRow): SaveItemUpsert {
  return withId(r.id, {
    client_key: r.key,
    category: r.category,
    title: norm(r.title),
    description: normOrNull(r.description),
    url: normOrNull(r.url),
    group_label: r.groupLabel ?? null,
  });
}

function diffItems(baseline: EditorState, current: EditorState): SavePayload['items'] {
  const before = allListRows(baseline);
  const after = allListRows(current);
  const old = byId(before);
  const upsert: SaveItemUpsert[] = [];
  for (const r of after) {
    if (r.id === null) {
      if (!isBlankItem(r)) upsert.push(itemUpsert(r));
      continue;
    }
    const prev = old.get(r.id);
    if (prev === undefined || itemChanged(prev, r)) upsert.push(itemUpsert(r));
  }
  const del = removedIds(before, after);
  return upsert.length > 0 || del.length > 0 ? { upsert, delete: del } : undefined;
}

// ── AI gifts ────────────────────────────────────────────────────────────

function diffAiGifts(baseline: EditorState, current: EditorState): SavePayload['ai_gifts'] {
  const old = new Map<string, AiGiftRow>(baseline.aiGifts.map((g) => [g.id, g]));
  const approve: string[] = [];
  for (const g of current.aiGifts) {
    const prev = old.get(g.id);
    if (g.approved && prev !== undefined && !prev.approved) approve.push(g.id);
  }
  const del = removedIds(baseline.aiGifts, current.aiGifts);
  return approve.length > 0 || del.length > 0 ? { approve, delete: del } : undefined;
}

// ── Affiliations ────────────────────────────────────────────────────────

function isBlankAff(r: AffRow): boolean {
  return isBlankText(r.name) && isBlankText(r.location) && isBlankText(r.description);
}

function affChanged(a: AffRow, b: AffRow): boolean {
  return (
    a.affiliationType !== b.affiliationType ||
    norm(a.name) !== norm(b.name) ||
    norm(a.location) !== norm(b.location) ||
    norm(a.description) !== norm(b.description) ||
    a.showOnProfile !== b.showOnProfile
  );
}

function affUpsert(r: AffRow): SaveAffiliationUpsert {
  return withId(r.id, {
    client_key: r.key,
    affiliation_type: r.affiliationType,
    school_name: norm(r.name),
    school_location: normOrNull(r.location),
    description: normOrNull(r.description),
    show_on_profile: r.showOnProfile,
  });
}

function diffAffiliations(baseline: EditorState, current: EditorState): SavePayload['affiliations'] {
  const old = byId(baseline.affiliations);
  const upsert: SaveAffiliationUpsert[] = [];
  for (const r of current.affiliations) {
    if (r.id === null) {
      if (!isBlankAff(r)) upsert.push(affUpsert(r));
      continue;
    }
    const prev = old.get(r.id);
    if (prev === undefined || affChanged(prev, r)) upsert.push(affUpsert(r));
  }
  const del = removedIds(baseline.affiliations, current.affiliations);
  return upsert.length > 0 || del.length > 0 ? { upsert, delete: del } : undefined;
}

// ── Questions ───────────────────────────────────────────────────────────

function isBlankQuestion(q: QuestionRow): boolean {
  return q.kind === 'preset' ? isBlankText(q.answer) : isBlankText(q.customPrompt) && isBlankText(q.answer);
}

function questionTextChanged(a: QuestionRow, b: QuestionRow): boolean {
  if (a.kind !== b.kind) return true;
  if (norm(a.answer) !== norm(b.answer)) return true;
  return a.kind === 'custom' && b.kind === 'custom' && norm(a.customPrompt) !== norm(b.customPrompt);
}

/**
 * Custom questions are renumbered 0..n-1 (by position) only when their order
 * changed or one was added. Otherwise stored `sort_order` values — possibly
 * null on older rows — are left alone, so an untouched editor sends nothing.
 */
function customOrderChanged(baseline: CustomQuestionRow[], current: CustomQuestionRow[]): boolean {
  if (current.some((q) => q.id === null)) return true;
  const kept = new Set(current.map((q) => q.id));
  const before = baseline.filter((q) => kept.has(q.id)).map((q) => q.id);
  const after = current.map((q) => q.id);
  return before.length !== after.length || before.some((id, i) => id !== after[i]);
}

function diffQuestions(baseline: EditorState, current: EditorState): SavePayload['questions'] {
  const old = byId(baseline.questions);
  const live = current.questions.filter((q) => q.id !== null || !isBlankQuestion(q));
  const baseCustom = baseline.questions.filter((q): q is CustomQuestionRow => q.kind === 'custom');
  const liveCustom = live.filter((q): q is CustomQuestionRow => q.kind === 'custom');
  const renumber = customOrderChanged(baseCustom, liveCustom);
  const position = new Map(liveCustom.map((q, i) => [q.key, i]));

  const upsert: SaveQuestionUpsert[] = [];
  const clearedPresets: string[] = [];
  for (const q of live) {
    const prev = q.id === null ? undefined : old.get(q.id);
    if (q.kind === 'preset') {
      if (prev !== undefined && !questionTextChanged(prev, q)) continue;
      // A stored preset answer cleared to blank is removed, not saved as ''
      // (the validator treats a blank preset as unanswered).
      if (q.id !== null && isBlankText(q.answer)) {
        clearedPresets.push(q.id);
        continue;
      }
      const body: SaveQuestionUpsert = { client_key: q.key, answer: norm(q.answer) };
      if (q.id === null) body.prompt_id = q.promptId; // prompt_id never changes on update
      upsert.push(withId(q.id, body));
      continue;
    }
    // A stored custom question cleared to completely blank (question AND
    // answer) is removed, not saved as empty text — same rule as presets.
    if (q.id !== null && isBlankQuestion(q)) {
      clearedPresets.push(q.id);
      continue;
    }
    const index = position.get(q.key) ?? 0;
    const prevSort = prev?.kind === 'custom' ? prev.sortOrder : null;
    const reorder = renumber && prevSort !== index;
    if (prev !== undefined && !reorder && !questionTextChanged(prev, q)) continue;
    const body: SaveQuestionUpsert = {
      client_key: q.key,
      custom_prompt: norm(q.customPrompt),
      answer: norm(q.answer),
    };
    if (renumber) body.sort_order = index;
    else if (prevSort !== null) body.sort_order = prevSort;
    upsert.push(withId(q.id, body));
  }
  const del = [...removedIds(baseline.questions, current.questions), ...clearedPresets];
  return upsert.length > 0 || del.length > 0 ? { upsert, delete: del } : undefined;
}

// ── Manual of Me ────────────────────────────────────────────────────────

function diffManualOfMe(baseline: EditorState, current: EditorState): ManualOfMe | undefined {
  const changed = MANUAL_OF_ME_FIELDS.some((f) => norm(baseline.manualOfMe[f]) !== norm(current.manualOfMe[f]));
  if (!changed) return undefined;
  const out = {} as ManualOfMe;
  for (const f of MANUAL_OF_ME_FIELDS) out[f] = normOrNull(current.manualOfMe[f]);
  return out;
}

// ── Public API ──────────────────────────────────────────────────────────

/** The save DIFF from `baseline` to `current` (plan §B). */
export function buildSavePayload(baseline: EditorState, current: EditorState, mode: SaveMode): SavePayload {
  const payload: SavePayload = { base_updated_at: baseline.baseUpdatedAt };
  const profile = diffProfile(baseline, current, mode);
  if (profile) payload.profile = profile;
  const photo = diffPhoto(baseline, current);
  if (photo) payload.photo = photo;
  const items = diffItems(baseline, current);
  if (items) payload.items = items;
  const aiGifts = diffAiGifts(baseline, current);
  if (aiGifts) payload.ai_gifts = aiGifts;
  const affiliations = diffAffiliations(baseline, current);
  if (affiliations) payload.affiliations = affiliations;
  const manualOfMe = diffManualOfMe(baseline, current);
  if (manualOfMe) payload.manual_of_me = manualOfMe;
  const questions = diffQuestions(baseline, current);
  if (questions) payload.questions = questions;
  return payload;
}

/**
 * True when `current` differs from `baseline` after normalisation (trailing
 * whitespace ignored, blank new rows ignored) — i.e. when a save would send
 * at least one section.
 */
export function isDirty(baseline: EditorState, current: EditorState): boolean {
  const mode: SaveMode = baseline.isPublished ? 'published' : 'draft';
  return Object.keys(buildSavePayload(baseline, current, mode)).some((k) => k !== 'base_updated_at');
}
