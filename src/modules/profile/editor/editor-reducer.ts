/**
 * KAN-487 — v0.8 profile editor: the pure state reducer (spec v0.8 §01–§10;
 * plan §A "Pure logic").
 *
 * `editorReducer(state, action)` is the only way the editor state changes.
 * It is pure: no Supabase calls, no `'use client'`, no clock. The UI passes
 * `at` (e.g. `Date.now()`) on remove actions so it can expire the undo row
 * after 8 s; the reducer only stores it and exposes `undoRemove`.
 *
 * Rules applied here:
 *   - Remove keeps ONE pending undo per list (`state.undo[listKey]`). A newer
 *     removal in the same list replaces the older entry; the older row then
 *     stays removed. `undoRemove` puts the row back at its original index
 *     (clamped to the current length).
 *   - Caps are NOT enforced here (the save validator does that) — except
 *     `addRow`, which leaves the state unchanged at the section cap from
 *     `ITEM_RULES` (spec v0.8 §01, §03, §04, §06–§08).
 *   - Preset answers are never reordered. `moveCustomQuestion` moves a
 *     custom question only among custom questions (no-op at either end) and
 *     renumbers every custom question's `sortOrder` 0..n-1 in display order.
 *   - The CheckLyra ID cannot change once `lyraIdLocked` (first published).
 *   - `applySaveResult` rewrites `new:` keys to the DB ids the save returned
 *     and clears pending undos (those deletes are now committed). A refused
 *     CheckLyra ID is replaced by the stored one (see the function).
 *   - An action naming an unknown key returns the SAME state object.
 */

import { ITEM_RULES } from '@/modules/profile/profile-rules';
import type { ManualOfMeField } from '@/modules/profile/manual-of-me-fields';
import {
  LIST_CATEGORIES,
  blankRow,
  newRowKey,
  type AffRow,
  type AffiliationType,
  type CustomQuestionRow,
  type EditorRow,
  type EditorState,
  type ListKey,
  type PhotoState,
  type PresetQuestionRow,
  type ProfileFieldKey,
  type QuestionRow,
  type SaveResult,
  type UndoEntry,
  type UndoListKey,
} from '@/modules/profile/editor/editor-state';

// ── Actions ─────────────────────────────────────────────────────────────

/** Editable text of a list row. `key`, `id`, `category`, `groupLabel` are fixed. */
export type RowPatch = Partial<Pick<EditorRow, 'title' | 'description' | 'url'>>;

/** Editable fields of an affiliation. Its type never changes. */
export type AffPatch = Partial<Pick<AffRow, 'name' | 'location' | 'description' | 'showOnProfile'>>;

/** `customPrompt` applies to custom questions only. */
export type QuestionPatch = { answer?: string; customPrompt?: string };

/** What a successful save tells the editor about the new stored state. */
export interface SaveBaseline {
  /** `profiles.updated_at` after the save; the next `base_updated_at`. */
  updatedAt: string;
  isPublished?: boolean;
  firstPublishedAt?: string | null;
  /** The stored avatar after the save, when the save touched the photo. */
  avatarUrl?: string | null;
  /** The STORED CheckLyra ID after the save, and whether it was chosen. */
  slug?: string | null;
  slugConfirmed?: boolean;
  /** The save's warnings. `lyra_id` = the requested ID was refused (draft). */
  warnings?: Record<string, string>;
}

/**
 * Every baseline field a successful save result carries, so the UI cannot
 * forget one (e.g. the stored slug after a refused CheckLyra ID). PURE.
 */
export function saveBaselineFromResult(r: Extract<SaveResult, { ok: true }>): SaveBaseline {
  return {
    updatedAt: r.updatedAt,
    isPublished: r.isPublished,
    firstPublishedAt: r.firstPublishedAt,
    avatarUrl: r.avatarUrl,
    slug: r.slug,
    slugConfirmed: r.slugConfirmed,
    warnings: r.warnings,
  };
}

export type EditorAction =
  | { type: 'setField'; field: ProfileFieldKey; value: string }
  | { type: 'setManualOfMe'; field: ManualOfMeField; value: string }
  | { type: 'setLyraId'; value: string }
  | { type: 'addRow'; listKey: ListKey; key?: string }
  | { type: 'updateRow'; listKey: ListKey; key: string; patch: RowPatch }
  | { type: 'removeRow'; listKey: ListKey; key: string; at?: number }
  | { type: 'undoRemove'; listKey: UndoListKey }
  | { type: 'addAffiliation'; affiliationType: AffiliationType; key?: string }
  | { type: 'updateAffiliation'; key: string; patch: AffPatch }
  | { type: 'removeAffiliation'; key: string; at?: number }
  | { type: 'answerPreset'; promptId: string; text: string; key?: string }
  | { type: 'addCustomQuestion'; customPrompt?: string; answer?: string; key?: string }
  | { type: 'updateQuestion'; key: string; patch: QuestionPatch }
  | { type: 'removeQuestion'; key: string; at?: number }
  | { type: 'moveCustomQuestion'; key: string; direction: -1 | 1 }
  | { type: 'setPhoto'; photo: PhotoState }
  | { type: 'requestPhotoRemoval' }
  | { type: 'approveAiGift'; id: string }
  | { type: 'deleteAiGift'; id: string }
  | { type: 'aiGiftsGenerated'; rows: ReadonlyArray<{ id: string; title: string; description: string | null }> }
  | { type: 'aiGiftDismissed'; id: string }
  | { type: 'applySaveResult'; idMap: Record<string, string>; newBaseline: SaveBaseline };

// ── Helpers ─────────────────────────────────────────────────────────────

function withUndo(state: EditorState, entry: UndoEntry): EditorState['undo'] {
  // One pending undo per list: a newer removal replaces the older one.
  return { ...state.undo, [entry.listKey]: entry };
}

function withoutUndo(state: EditorState, listKey: UndoListKey): EditorState['undo'] {
  const undo = { ...state.undo };
  delete undo[listKey];
  return undo;
}

function insertAt<T>(rows: readonly T[], index: number, row: T): T[] {
  const at = Math.max(0, Math.min(index, rows.length));
  return [...rows.slice(0, at), row, ...rows.slice(at)];
}

function sectionCap(listKey: ListKey): number {
  return ITEM_RULES[LIST_CATEGORIES[listKey].newCategory].cap;
}

function rewriteKey<T extends { key: string; id: string | null }>(row: T, idMap: Record<string, string>): T {
  const id = idMap[row.key];
  return id === undefined ? row : { ...row, key: id, id };
}

function nextCustomSortOrder(questions: readonly QuestionRow[]): number {
  let count = 0;
  let max = -1;
  for (const q of questions) {
    if (q.kind !== 'custom') continue;
    count++;
    if (q.sortOrder !== null && q.sortOrder > max) max = q.sortOrder;
  }
  return Math.max(max + 1, count);
}

// ── Lists ───────────────────────────────────────────────────────────────

function addRow(state: EditorState, listKey: ListKey, key?: string): EditorState {
  const rows = state.lists[listKey];
  if (rows.length >= sectionCap(listKey)) return state;
  const row = blankRow(listKey);
  if (key !== undefined) row.key = key;
  return { ...state, lists: { ...state.lists, [listKey]: [...rows, row] } };
}

function updateRow(state: EditorState, listKey: ListKey, key: string, patch: RowPatch): EditorState {
  const rows = state.lists[listKey];
  const index = rows.findIndex((r) => r.key === key);
  if (index === -1) return state;
  const next = rows.slice();
  next[index] = { ...rows[index], ...patch };
  return { ...state, lists: { ...state.lists, [listKey]: next } };
}

function removeRow(state: EditorState, listKey: ListKey, key: string, at: number): EditorState {
  const rows = state.lists[listKey];
  const index = rows.findIndex((r) => r.key === key);
  if (index === -1) return state;
  return {
    ...state,
    lists: { ...state.lists, [listKey]: [...rows.slice(0, index), ...rows.slice(index + 1)] },
    undo: withUndo(state, { listKey, row: rows[index], index, at }),
  };
}

function undoRemove(state: EditorState, listKey: UndoListKey): EditorState {
  const entry = state.undo[listKey];
  if (entry === undefined) return state;
  const undo = withoutUndo(state, listKey);
  switch (entry.listKey) {
    case 'affiliations':
      return { ...state, affiliations: insertAt(state.affiliations, entry.index, entry.row), undo };
    case 'questions':
      return { ...state, questions: insertAt(state.questions, entry.index, entry.row), undo };
    default: {
      const lk = entry.listKey;
      return {
        ...state,
        lists: { ...state.lists, [lk]: insertAt(state.lists[lk], entry.index, entry.row) },
        undo,
      };
    }
  }
}

// ── Affiliations ────────────────────────────────────────────────────────

function addAffiliation(state: EditorState, affiliationType: AffiliationType, key?: string): EditorState {
  const row: AffRow = {
    key: key ?? newRowKey(),
    id: null,
    affiliationType,
    name: '',
    location: '',
    description: '',
    showOnProfile: false, // §02: "Show on my profile" unchecked by default
  };
  return { ...state, affiliations: [...state.affiliations, row] };
}

function updateAffiliation(state: EditorState, key: string, patch: AffPatch): EditorState {
  const index = state.affiliations.findIndex((r) => r.key === key);
  if (index === -1) return state;
  const next = state.affiliations.slice();
  next[index] = { ...state.affiliations[index], ...patch };
  return { ...state, affiliations: next };
}

function removeAffiliation(state: EditorState, key: string, at: number): EditorState {
  const rows = state.affiliations;
  const index = rows.findIndex((r) => r.key === key);
  if (index === -1) return state;
  return {
    ...state,
    affiliations: [...rows.slice(0, index), ...rows.slice(index + 1)],
    undo: withUndo(state, { listKey: 'affiliations', row: rows[index], index, at }),
  };
}

// ── Questions ───────────────────────────────────────────────────────────

function answerPreset(state: EditorState, promptId: string, text: string, key?: string): EditorState {
  const existing = state.questions.findIndex((q) => q.kind === 'preset' && q.promptId === promptId);
  if (existing !== -1) {
    const next = state.questions.slice();
    next[existing] = { ...(state.questions[existing] as PresetQuestionRow), answer: text };
    return { ...state, questions: next };
  }
  const preset = state.presets.find((p) => p.id === promptId);
  if (preset === undefined) return state;
  const row: PresetQuestionRow = {
    kind: 'preset',
    key: key ?? newRowKey(),
    id: null,
    promptId,
    prompt: preset.prompt,
    answerMax: preset.answerMax,
    answer: text,
    isActive: true,
  };
  // New preset answers go after the last preset answer, before custom questions.
  let lastPreset = -1;
  state.questions.forEach((q, i) => {
    if (q.kind === 'preset') lastPreset = i;
  });
  return { ...state, questions: insertAt(state.questions, lastPreset + 1, row) };
}

function addCustomQuestion(state: EditorState, customPrompt: string, answer: string, key?: string): EditorState {
  const row: CustomQuestionRow = {
    kind: 'custom',
    key: key ?? newRowKey(),
    id: null,
    customPrompt,
    answer,
    sortOrder: nextCustomSortOrder(state.questions),
    createdAt: null,
  };
  return { ...state, questions: [...state.questions, row] };
}

function updateQuestion(state: EditorState, key: string, patch: QuestionPatch): EditorState {
  const index = state.questions.findIndex((q) => q.key === key);
  if (index === -1) return state;
  const q = state.questions[index];
  const next = state.questions.slice();
  if (q.kind === 'custom') {
    next[index] = {
      ...q,
      ...(patch.answer !== undefined ? { answer: patch.answer } : {}),
      ...(patch.customPrompt !== undefined ? { customPrompt: patch.customPrompt } : {}),
    };
  } else {
    if (patch.answer === undefined) return state;
    next[index] = { ...q, answer: patch.answer };
  }
  return { ...state, questions: next };
}

function removeQuestion(state: EditorState, key: string, at: number): EditorState {
  const rows = state.questions;
  const index = rows.findIndex((q) => q.key === key);
  if (index === -1) return state;
  return {
    ...state,
    questions: [...rows.slice(0, index), ...rows.slice(index + 1)],
    undo: withUndo(state, { listKey: 'questions', row: rows[index], index, at }),
  };
}

function moveCustomQuestion(state: EditorState, key: string, direction: -1 | 1): EditorState {
  const customs = state.questions.filter((q): q is CustomQuestionRow => q.kind === 'custom');
  const from = customs.findIndex((q) => q.key === key);
  if (from === -1) return state;
  const to = from + direction;
  if (to < 0 || to >= customs.length) return state;
  const reordered = customs.slice();
  reordered[from] = customs[to];
  reordered[to] = customs[from];
  // Custom slots keep their positions in `questions`; presets never move.
  let c = 0;
  const questions = state.questions.map((q) => {
    if (q.kind !== 'custom') return q;
    const sortOrder = c;
    const row = reordered[c++];
    return { ...row, sortOrder };
  });
  return { ...state, questions };
}

// ── Photo / AI gifts / save result ──────────────────────────────────────

function requestPhotoRemoval(state: EditorState): EditorState {
  if (state.photo.kind === 'stored' || state.photo.kind === 'staged') {
    return { ...state, photo: { kind: 'removed' } };
  }
  return state;
}

function approveAiGift(state: EditorState, id: string): EditorState {
  const index = state.aiGifts.findIndex((g) => g.id === id);
  if (index === -1 || state.aiGifts[index].approved) return state;
  const next = state.aiGifts.slice();
  next[index] = { ...state.aiGifts[index], approved: true };
  return { ...state, aiGifts: next };
}

function deleteAiGift(state: EditorState, id: string): EditorState {
  if (!state.aiGifts.some((g) => g.id === id)) return state;
  return { ...state, aiGifts: state.aiGifts.filter((g) => g.id !== id) };
}

/**
 * KAN-489: suggestions just stored by a generation (unapproved, private).
 * Appended as `approved: false`; ids already present are skipped. No undo —
 * the rows are already in the database. The editor applies the SAME action
 * to its baseline (`applyAiGiftChangeToBaseline`), so new pending rows never
 * make the editor dirty and approving one later is sent as `ai_gifts.approve`.
 */
function aiGiftsGenerated(
  state: EditorState,
  rows: ReadonlyArray<{ id: string; title: string; description: string | null }>,
): EditorState {
  const have = new Set(state.aiGifts.map((g) => g.id));
  const added = rows
    .filter((r) => !have.has(r.id))
    .map((r) => ({ id: r.id, title: r.title, description: r.description ?? '', url: '', approved: false }));
  if (added.length === 0) return state;
  return { ...state, aiGifts: [...state.aiGifts, ...added] };
}

/**
 * KAN-489: a pending suggestion the server has already deleted
 * (`dismissAiGift`). Removes exactly that row; also applied to the baseline,
 * so it is not sent again as `ai_gifts.delete`.
 */
function aiGiftDismissed(state: EditorState, id: string): EditorState {
  if (!state.aiGifts.some((g) => g.id === id)) return state;
  return { ...state, aiGifts: state.aiGifts.filter((g) => g.id !== id) };
}

/**
 * Turn the editor state into the new save BASELINE.
 *
 * Apply this to the snapshot that was SENT (the `current` passed to
 * `buildSavePayload`), never to the live state: edits typed while the save
 * was in flight must stay out of the baseline, or the next diff will not
 * send them.
 *
 * When the save refused the CheckLyra ID (`warnings.lyra_id`), the baseline
 * takes the STORED ID (`slug`, or '' while unconfirmed), not the refused one,
 * so the live editor stays dirty and the next save sends the ID again.
 */
function applySaveResult(state: EditorState, idMap: Record<string, string>, b: SaveBaseline): EditorState {
  const lists = {} as EditorState['lists'];
  for (const lk of Object.keys(state.lists) as ListKey[]) {
    lists[lk] = state.lists[lk].map((r) => rewriteKey(r, idMap));
  }
  const firstPublishedAt = b.firstPublishedAt !== undefined ? b.firstPublishedAt : state.firstPublishedAt;
  let photo = state.photo;
  if (b.avatarUrl !== undefined) {
    photo = b.avatarUrl ? { kind: 'stored', url: b.avatarUrl } : { kind: 'none' };
  }
  let lyraId = state.lyraId;
  if (b.warnings?.lyra_id !== undefined && b.slugConfirmed !== undefined) {
    lyraId = b.slugConfirmed ? (b.slug ?? '') : '';
  }
  return {
    ...state,
    lyraId,
    baseUpdatedAt: b.updatedAt,
    isPublished: b.isPublished ?? state.isPublished,
    firstPublishedAt,
    lyraIdLocked: state.lyraIdLocked || firstPublishedAt !== null,
    photo,
    lists,
    affiliations: state.affiliations.map((r) => rewriteKey(r, idMap)),
    questions: state.questions.map((q) => rewriteKey(q, idMap)),
    // Pending removals were committed by this save: they can no longer be undone.
    undo: {},
  };
}

// ── Reducer ─────────────────────────────────────────────────────────────

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'setField':
      if (state.fields[action.field] === action.value) return state;
      return { ...state, fields: { ...state.fields, [action.field]: action.value } };
    case 'setManualOfMe':
      if (state.manualOfMe[action.field] === action.value) return state;
      return { ...state, manualOfMe: { ...state.manualOfMe, [action.field]: action.value } };
    case 'setLyraId':
      if (state.lyraIdLocked || state.lyraId === action.value) return state;
      return { ...state, lyraId: action.value };
    case 'addRow':
      return addRow(state, action.listKey, action.key);
    case 'updateRow':
      return updateRow(state, action.listKey, action.key, action.patch);
    case 'removeRow':
      return removeRow(state, action.listKey, action.key, action.at ?? 0);
    case 'undoRemove':
      return undoRemove(state, action.listKey);
    case 'addAffiliation':
      return addAffiliation(state, action.affiliationType, action.key);
    case 'updateAffiliation':
      return updateAffiliation(state, action.key, action.patch);
    case 'removeAffiliation':
      return removeAffiliation(state, action.key, action.at ?? 0);
    case 'answerPreset':
      return answerPreset(state, action.promptId, action.text, action.key);
    case 'addCustomQuestion':
      return addCustomQuestion(state, action.customPrompt ?? '', action.answer ?? '', action.key);
    case 'updateQuestion':
      return updateQuestion(state, action.key, action.patch);
    case 'removeQuestion':
      return removeQuestion(state, action.key, action.at ?? 0);
    case 'moveCustomQuestion':
      return moveCustomQuestion(state, action.key, action.direction);
    case 'setPhoto':
      return { ...state, photo: action.photo };
    case 'requestPhotoRemoval':
      return requestPhotoRemoval(state);
    case 'approveAiGift':
      return approveAiGift(state, action.id);
    case 'deleteAiGift':
      return deleteAiGift(state, action.id);
    case 'aiGiftsGenerated':
      return aiGiftsGenerated(state, action.rows);
    case 'aiGiftDismissed':
      return aiGiftDismissed(state, action.id);
    case 'applySaveResult':
      return applySaveResult(state, action.idMap, action.newBaseline);
    default: {
      const never: never = action;
      return never;
    }
  }
}
