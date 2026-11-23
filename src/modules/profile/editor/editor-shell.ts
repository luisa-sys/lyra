/**
 * KAN-487 — v0.8 profile editor SHELL logic (spec v0.8 §1 "Save all sections
 * together atomically", §3 "Changes saved successfully"; plan §B "Modes",
 * §C "Action bar" / "Unsaved-changes warning").
 *
 * The pure decisions behind `edit-profile-form.tsx` and its action bar,
 * kept here so they can be tested without a DOM (Jest runs in `node`):
 *
 *   - `rebaseAfterSave` — after a successful save, the new BASELINE is the
 *     snapshot that was SENT with the save result applied (never the live
 *     state, or edits typed while the save was in flight would be folded into
 *     the baseline and never sent). The live state keeps those edits, but its
 *     new rows take their stored ids so the next save does not insert them
 *     twice.
 *   - `editorShellReducer` — `editorReducer` plus one `rebaseAfterSave`
 *     action, so the live rebase runs against the CURRENT state (not a stale
 *     closure from when the save started).
 *   - `visibleErrors` / `touchErrors` — validation errors show after a save
 *     attempt, or once the member leaves a field, never while first typing.
 *   - `publishBlockers` — "Before you can publish:" items with the field each
 *     one links to.
 *   - `saveChangesDisabled` — the published bar's single Save Changes is off
 *     when nothing changed or while the photo is removed (founder decision:
 *     a published profile cannot drop its photo).
 *   - `shouldGuardLinkClick` — which in-app link clicks get the
 *     unsaved-changes confirm.
 *   - `historyGuardStep` / `popstateStep` — the Back / Forward guard: a
 *     sentinel history entry while dirty, a confirm when the member leaves it.
 *   - `retryIntent` / `saveFailureStatus` — what "Try again" re-runs, and
 *     whether a failure offers "Try again" or "Reload".
 *   - `liveServerErrors` / `errorKeysForFieldId` / `remapKeySet` — server
 *     errors clear once their field changes, a blur touches only its own
 *     field, and rows keep their expanded state across a save.
 *
 * Pure: no `'use client'`, no Supabase, no server-only imports.
 */

import {
  type EditorState,
  type SaveMode,
  type UndoEntry,
  type UndoListKey,
} from '@/modules/profile/editor/editor-state';
import {
  editorReducer,
  type EditorAction,
  type SaveBaseline,
} from '@/modules/profile/editor/editor-reducer';
import {
  PUBLISH_ID_MISSING,
  PUBLISH_NAME_MISSING,
  PUBLISH_PHOTO_MISSING,
} from '@/modules/profile/editor/validate-save-payload';

// ── Copy (plan §D "Proposed", founder-approved via spec v0.8 sign-off) ──

/** Spec v0.8 §3 — exact. */
export const SAVE_SUCCESS_COPY = 'Changes saved successfully';
export const DRAFT_SAVED_COPY = 'Draft saved';
export const SAVE_FAILED_COPY = 'We couldn’t save your changes. Your edits are still here.';
export const TRY_AGAIN_LABEL = 'Try again';
export const PUBLISH_BLOCKED_HEADING = 'Before you can publish:';
/** Approved copy (KAN-487 brief): a draft save could not take the ID. */
export const LYRA_ID_TAKEN_COPY = 'That CheckLyra ID is already taken.';
export const UNSAVED_COPY =
  'You have unsaved changes. Leave without saving? Your public profile will stay as it is.';
/** The failure action when the editor must be reloaded (the server says "Reload …"). */
export const RELOAD_LABEL = 'Reload';

// ── Save rebase ─────────────────────────────────────────────────────────

function rewriteRowKey<T extends { key: string; id: string | null }>(row: T, idMap: Record<string, string>): T {
  const id = idMap[row.key];
  return id === undefined ? row : { ...row, key: id, id };
}

function rewriteUndo(entry: UndoEntry, idMap: Record<string, string>): UndoEntry {
  return { ...entry, row: rewriteRowKey(entry.row, idMap) } as UndoEntry;
}

/**
 * The live state after a successful save of `sent`.
 *
 * Starts from `applySaveResult` on the live state (new keys → stored ids,
 * `updated_at`, publish state, stored photo), then puts back what the member
 * changed while the save was in flight:
 *   - a photo picked or removed during the save stays (the reducer creates a
 *     new photo object on every change, so identity tells them apart);
 *   - the typed CheckLyra ID stays, so a refused ID keeps the editor dirty
 *     and is sent again on the next save;
 *   - an undo entry made during the save stays (its row key rewritten). Undo
 *     entries that were already pending when the save started are dropped:
 *     the save committed those removals.
 */
export function rebaseLiveAfterSave(
  live: EditorState,
  sent: EditorState,
  idMap: Record<string, string>,
  newBaseline: SaveBaseline,
): EditorState {
  const applied = editorReducer(live, { type: 'applySaveResult', idMap, newBaseline });
  const undo: EditorState['undo'] = {};
  for (const listKey of Object.keys(live.undo) as UndoListKey[]) {
    const entry = live.undo[listKey];
    if (entry !== undefined && sent.undo[listKey] !== entry) undo[listKey] = rewriteUndo(entry, idMap);
  }
  return {
    ...applied,
    photo: live.photo === sent.photo ? applied.photo : live.photo,
    lyraId: applied.lyraIdLocked ? applied.lyraId : live.lyraId,
    undo,
  };
}

/** New baseline + rebased live state after a successful save of `sent`. */
export function rebaseAfterSave(
  sent: EditorState,
  live: EditorState,
  idMap: Record<string, string>,
  newBaseline: SaveBaseline,
): { baseline: EditorState; live: EditorState } {
  return {
    baseline: editorReducer(sent, { type: 'applySaveResult', idMap, newBaseline }),
    live: rebaseLiveAfterSave(live, sent, idMap, newBaseline),
  };
}

export type ShellAction =
  | EditorAction
  | { type: 'rebaseAfterSave'; sent: EditorState; idMap: Record<string, string>; newBaseline: SaveBaseline };

/** `editorReducer` plus the post-save live rebase. */
export function editorShellReducer(state: EditorState, action: ShellAction): EditorState {
  if (action.type === 'rebaseAfterSave') {
    return rebaseLiveAfterSave(state, action.sent, action.idMap, action.newBaseline);
  }
  return editorReducer(state, action);
}

/**
 * A draft save's `warnings.lyra_id` as the message shown at the ID field:
 * `'taken'` (unique violation caught by the RPC) → the approved copy; any
 * other value is already a member-facing format message from the validator.
 */
export function lyraIdWarningMessage(warning: string | undefined): string | null {
  if (warning === undefined || warning === '') return null;
  return warning === 'taken' ? LYRA_ID_TAKEN_COPY : warning;
}

// ── Error visibility ────────────────────────────────────────────────────

/**
 * Mark every error present right now as touched. (The editor marks only the
 * blurred field — see `errorKeysForFieldId`; this is the bulk variant.)
 */
export function touchErrors(touched: ReadonlySet<string>, errors: Readonly<Record<string, string>>): Set<string> {
  const next = new Set(touched);
  for (const k of Object.keys(errors)) next.add(k);
  return next;
}

/**
 * The errors to show: every validation error after a save attempt, otherwise
 * only touched ones. Server field errors (from the last save) always show and
 * win over a validation error on the same key.
 */
export function visibleErrors(
  errors: Readonly<Record<string, string>>,
  touched: ReadonlySet<string>,
  attempted: boolean,
  serverErrors: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) {
    if (attempted || touched.has(k)) out[k] = v;
  }
  return { ...out, ...serverErrors };
}

/** `<rowKey>.<field>` error field → the suffix of that field's DOM id. */
const FIELD_ID_SUFFIX: Readonly<Record<string, string>> = {
  title: 'title',
  description: 'description',
  url: 'url',
  name: 'name',
  location: 'location',
  answer: 'answer',
  custom_prompt: 'prompt',
};

/** A row key as used inside DOM ids (`new:<uuid>` → `new_<uuid>`). */
export function domSafeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * The error keys that belong to the field with DOM id `fieldId` (the field
 * the member just left), out of `errorKeys`. Field ids follow the editor's
 * conventions: `profile-<f>` ↔ `profile.<f>`, `profile-photo` ↔ `photo`,
 * `understand-<f>` ↔ `manual_of_me.<f>`, and row fields
 * `…-<domSafeKey(rowKey)>-<suffix>` ↔ `<rowKey>.<field>`.
 */
export function errorKeysForFieldId(fieldId: string, errorKeys: Iterable<string>): string[] {
  const out: string[] = [];
  for (const key of errorKeys) {
    if (key === 'photo') {
      if (fieldId === 'profile-photo') out.push(key);
      continue;
    }
    if (key.startsWith('profile.')) {
      if (fieldId === `profile-${key.slice('profile.'.length)}`) out.push(key);
      continue;
    }
    if (key.startsWith('manual_of_me.')) {
      if (fieldId === `understand-${key.slice('manual_of_me.'.length)}`) out.push(key);
      continue;
    }
    const dot = key.lastIndexOf('.');
    if (dot <= 0) continue;
    const suffix = FIELD_ID_SUFFIX[key.slice(dot + 1)];
    if (suffix !== undefined && fieldId.endsWith(`-${domSafeKey(key.slice(0, dot))}-${suffix}`)) out.push(key);
  }
  return out;
}

/** `touched` plus the error keys of the field the member just left. */
export function touchField(
  touched: ReadonlySet<string>,
  fieldId: string,
  errors: Readonly<Record<string, string>>,
): ReadonlySet<string> {
  const keys = errorKeysForFieldId(fieldId, Object.keys(errors)).filter((k) => !touched.has(k));
  if (keys.length === 0) return touched;
  const next = new Set(touched);
  for (const k of keys) next.add(k);
  return next;
}

const ROW_FIELD_PROP: Readonly<Record<string, string>> = {
  custom_prompt: 'customPrompt',
  show_on_profile: 'showOnProfile',
};

/** The editor value an error key is about (compared by identity / value). */
export function errorKeyValue(state: EditorState, key: string): unknown {
  if (key === 'photo') return state.photo;
  if (key === 'profile.lyra_id' || key === 'profile.slug') return state.lyraId;
  if (key.startsWith('profile.')) return (state.fields as unknown as Record<string, unknown>)[key.slice(8)];
  if (key.startsWith('manual_of_me.')) {
    return (state.manualOfMe as unknown as Record<string, unknown>)[key.slice('manual_of_me.'.length)];
  }
  if (key.startsWith('lists.')) return (state.lists as unknown as Record<string, unknown>)[key.slice(6)];
  if (key.startsWith('affiliations.')) return state.affiliations;
  if (key.startsWith('questions.')) return state.questions;
  const dot = key.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const rowKey = key.slice(0, dot);
  const field = key.slice(dot + 1);
  const rows: ReadonlyArray<{ key: string }> = [
    ...Object.values(state.lists).flat(),
    ...state.affiliations,
    ...state.questions,
  ];
  const row = rows.find((r) => r.key === rowKey) as Record<string, unknown> | undefined;
  if (row === undefined) return undefined;
  const prop = ROW_FIELD_PROP[field] ?? field;
  return prop in row ? row[prop] : row;
}

/**
 * The server field errors still worth showing: those whose field has the
 * same value now as when the errors arrived (`base`). Once the member
 * changes the field, its server error goes (the live validator takes over).
 * `base` null = not captured yet → all errors show.
 */
export function liveServerErrors(
  serverErrors: Readonly<Record<string, string>>,
  base: EditorState | null,
  live: EditorState,
): Record<string, string> {
  if (base === null) return { ...serverErrors };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(serverErrors)) {
    if (Object.is(errorKeyValue(base, k), errorKeyValue(live, k))) out[k] = v;
  }
  return out;
}

// ── Row expansion across a save ─────────────────────────────────────────

/**
 * A set of row keys with every saved new key (`new:…`) replaced by its
 * stored id from `idMap`, so an expanded row stays expanded after a save.
 * Returns the same set when nothing maps.
 */
export function remapKeySet(keys: ReadonlySet<string>, idMap: Readonly<Record<string, string>>): ReadonlySet<string> {
  let changed = false;
  const next = new Set<string>();
  for (const k of keys) {
    const id = idMap[k];
    if (id !== undefined) changed = true;
    next.add(id ?? k);
  }
  return changed ? next : keys;
}

// ── Save / retry ────────────────────────────────────────────────────────

export type SaveIntent = 'draft' | 'publish' | 'published';

export const MODE_FOR_INTENT: Readonly<Record<SaveIntent, SaveMode>> = {
  draft: 'draft',
  publish: 'publish',
  published: 'published',
};

/**
 * What "Try again" runs: the intent of the last FAILED attempt (kept until a
 * save completes — a failed Publish is retried as a Publish, even when its
 * save step succeeded), otherwise the bar's own save for this profile.
 */
export function retryIntent(lastFailed: SaveIntent | null, isPublished: boolean): SaveIntent {
  if (lastFailed !== null) return lastFailed;
  return isPublished ? 'published' : 'draft';
}

/** The intent to remember after a save attempt: null once it succeeded. */
export function failedIntentAfter(intent: SaveIntent, ok: boolean): SaveIntent | null {
  return ok ? null : intent;
}

/** True when the server says the editor must be reloaded first. */
export function isReloadError(error: string): boolean {
  return /\breload\b/i.test(error);
}

/**
 * The failure callout under `SAVE_FAILED_COPY`: the server's own message
 * (unless it is that same generic copy) and the action offered — "Reload"
 * when the editor is out of date / saved elsewhere (a retry would fail the
 * same way), otherwise "Try again".
 */
export function saveFailureStatus(error: string | undefined): { detail: string | null; action: 'retry' | 'reload' } {
  const e = (error ?? '').trim();
  const detail = e === '' || e === SAVE_FAILED_COPY ? null : e;
  return { detail, action: detail !== null && isReloadError(detail) ? 'reload' : 'retry' };
}

// ── Publish blockers ────────────────────────────────────────────────────

/** `validateForPublish` message → the input it links to (spec §01 field ids). */
const PUBLISH_BLOCKER_TARGET: Readonly<Record<string, { fieldId: string; errorKey: string }>> = {
  [PUBLISH_PHOTO_MISSING]: { fieldId: 'profile-photo', errorKey: 'photo' },
  [PUBLISH_NAME_MISSING]: { fieldId: 'profile-display_name', errorKey: 'profile.display_name' },
  [PUBLISH_ID_MISSING]: { fieldId: 'profile-lyra_id', errorKey: 'profile.lyra_id' },
};

export interface PublishBlocker {
  message: string;
  /** DOM id of the field to jump to, or null when unknown. */
  fieldId: string | null;
  /** Error-map key the message is shown under at the field. */
  errorKey: string | null;
}

export function publishBlockers(missing: readonly string[]): PublishBlocker[] {
  return missing.map((message) => {
    const t = PUBLISH_BLOCKER_TARGET[message];
    return { message, fieldId: t?.fieldId ?? null, errorKey: t?.errorKey ?? null };
  });
}

/** The blockers as field errors, so each field shows its own message too. */
export function publishBlockerErrors(missing: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of publishBlockers(missing)) if (b.errorKey) out[b.errorKey] = b.message;
  return out;
}

// ── Action bar ──────────────────────────────────────────────────────────

/** Save Changes (published bar) is disabled when nothing changed, while the
 *  photo is removed, or while a save is in flight. */
export function saveChangesDisabled(state: EditorState, dirty: boolean, saving: boolean): boolean {
  return saving || !dirty || state.photo.kind === 'removed';
}

// ── Unsaved-changes guard ───────────────────────────────────────────────

export interface LinkClick {
  /** The anchor's resolved `href` (absolute). */
  href: string;
  /** `target` attribute ('' when absent). */
  target: string;
  /** True when the anchor has a `download` attribute. */
  download: boolean;
  /** Any of ctrl / meta / shift / alt held, or a non-primary button. */
  modified: boolean;
  /** The page's current URL (absolute). */
  currentHref: string;
}

/**
 * True when clicking this link would leave the editor in the same tab, so
 * the member should be asked first. Same-page hash links (the section table
 * of contents), new-tab links, downloads and modified clicks are not
 * guarded. Off-site links are guarded by `beforeunload` instead.
 */
export function shouldGuardLinkClick(click: LinkClick): boolean {
  if (click.modified || click.download) return false;
  if (click.target !== '' && click.target !== '_self') return false;
  let to: URL;
  let from: URL;
  try {
    to = new URL(click.href);
    from = new URL(click.currentHref);
  } catch {
    return false;
  }
  if (to.origin !== from.origin) return false;
  const samePage = to.pathname === from.pathname && to.search === from.search;
  return !(samePage && to.hash !== '');
}

// ── Back / Forward guard ────────────────────────────────────────────────

/** Marker key on the sentinel history entry pushed while dirty. */
export const HISTORY_GUARD_KEY = '__lyraEditorGuard';

/** True when a `history.state` is (or was marked as) the editor's sentinel. */
export function isGuardState(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as Record<string, unknown>)[HISTORY_GUARD_KEY] === true;
}

/**
 * What to do with the sentinel entry when `dirty` changes: push one on
 * becoming dirty (so Back lands on the editor's own entry, not off the
 * page), pop it once clean again. Nothing while the member is leaving.
 */
export function historyGuardStep(input: { dirty: boolean; onSentinel: boolean; leaving: boolean }): 'push' | 'pop' | 'none' {
  if (input.leaving) return 'none';
  if (input.dirty && !input.onSentinel) return 'push';
  if (!input.dirty && input.onSentinel) return 'pop';
  return 'none';
}

/**
 * On `popstate`: ask the member only when the editor is dirty and the entry
 * landed on is NOT a sentinel (they stepped off it). Our own sentinel pop,
 * or leaving already confirmed, is ignored.
 */
export function popstateStep(input: {
  dirty: boolean;
  landedOnSentinel: boolean;
  leaving: boolean;
  ignoreNext: boolean;
}): 'ignore' | 'confirm' {
  if (input.ignoreNext || input.leaving || !input.dirty || input.landedOnSentinel) return 'ignore';
  return 'confirm';
}

/** After the confirm: OK → go on back (leave); Cancel → re-push the sentinel (stay). */
export function afterBackConfirm(confirmed: boolean): 'leave' | 'stay' {
  return confirmed ? 'leave' : 'stay';
}
