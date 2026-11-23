/**
 * KAN-487 — v0.8 profile editor: the server-side data access behind the
 * editor's save actions (spec v0.8 §1 "Save all sections together
 * atomically", §3; plan §A "Server modules", §B "Server action flow" /
 * "Error mapping").
 *
 * The editor server actions (`src/app/dashboard/profile/editor-actions.ts`)
 * make no `.from` / `.rpc` / `.storage` calls (CTL-056); everything they need
 * from the database is here:
 *
 *   saveProfileRpc(supabase, payload, mode)  one call to public.save_profile
 *   loadEditorProfileSnapshot(supabase, uid) the stored identity, re-read
 *                                            after a publish-mode save so the
 *                                            publish check uses the DATABASE,
 *                                            never the client's claims, and
 *                                            again after publishProfile() so
 *                                            the client gets the fresh
 *                                            updated_at / first_published_at
 *   loadPresetAnswerMax(supabase, ids)       per-preset answer limits (§09)
 *
 * plus pure helpers the action composes:
 *   publishRequirementsMissing(snapshot)     all missing identity items
 *   refreshedAfterPublish(saved, snapshot)   the result with fresh identity
 *   moderationTargets(payload)               the changed text to moderate
 *   saveErrorFieldKey(error)                 where a DB error points
 *
 * Server only (it is handed a request-scoped Supabase client). No imports
 * from `src/app/**` (depcruise `no-module-to-app`).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { dbErrorFor, parseSaveErrorDetail, type DbErrorLike } from '@/modules/profile/db-error-copy';
import { checkLyraId } from '@/modules/profile/profile-rules';
import {
  ANSWER_HARD_MAX,
  PUBLISH_ID_MISSING,
  PUBLISH_NAME_MISSING,
  PUBLISH_PHOTO_MISSING,
} from '@/modules/profile/editor/validate-save-payload';
import type { SaveMode, SavePayload, SaveResult } from '@/modules/profile/editor/editor-state';

// ── Result types ────────────────────────────────────────────────────────

/** What a successful save carries back to the client (plan §B step 8). */
export type SavedResult = Extract<SaveResult, { ok: true }>;

/** `saveProfileRpc` failure: member copy plus the field it points at, if known. */
export type SaveRpcFailure = { ok: false; error: string; fieldKey?: string };

/**
 * `publishProfileFromEditor` result. When the rows were saved but publishing
 * then failed (identity incomplete in the DB, age gate, trigger), `saved`
 * carries the new ids and `updated_at`, so the client can rebase and the next
 * save does not trip the "saved somewhere else" check.
 */
export type EditorPublishResult =
  | SaveResult
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string>;
      saved: SavedResult;
    };

// ── save_profile ────────────────────────────────────────────────────────

/** Trigger message → editor field name (see db-error-copy.ts TRIGGER_COPY). */
const MESSAGE_FIELD: ReadonlyArray<readonly [RegExp, string]> = [
  [/^title /i, 'title'],
  [/^description /i, 'description'],
  [/^links must start with http/i, 'url'],
  [/^name /i, 'name'],
  [/^(location|postcode) /i, 'location'],
  [/^(answer |unknown question)/i, 'answer'],
];

/** RPC section (DETAIL `section`) → editor key when no row is named. */
const SECTION_FIELD: Readonly<Record<string, string>> = {
  slug: 'profile.lyra_id',
  profile: 'profile',
  photo: 'photo',
  manual_of_me: 'manual_of_me',
  items: 'items',
  ai_gifts: 'ai_gifts',
  affiliations: 'affiliations',
  questions: 'questions',
};

const SLUG_CONSTRAINT_RE = /\bprofiles_slug_(lower_key|key|idx)\b/i;

/**
 * Where a `save_profile` error points, as an editor error key:
 * `<clientKey>.<field>` when the DETAIL names a row and the message names a
 * field, `<clientKey>` when only the row is known, else the section. A taken
 * CheckLyra ID is always `profile.lyra_id`. PURE.
 */
export function saveErrorFieldKey(error: DbErrorLike): string | undefined {
  if (!error) return undefined;
  const message = (error.message ?? '').trim();
  if ((error.code ?? '') === '23505' && SLUG_CONSTRAINT_RE.test(`${message}\n${error.details ?? ''}`)) {
    return 'profile.lyra_id';
  }
  const detail = parseSaveErrorDetail(error.details);
  if (!detail) return undefined;
  if (detail.clientKey) {
    const field = MESSAGE_FIELD.find(([re]) => re.test(message))?.[1];
    return field ? `${detail.clientKey}.${field}` : detail.clientKey;
  }
  if (/^custom question limit/i.test(message)) return 'questions.custom';
  if (/^add a display name/i.test(message)) return 'profile.display_name';
  return SECTION_FIELD[detail.section] ?? detail.section;
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string')
  );
}

const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** Narrow the RPC's jsonb return; null when it is not the documented shape. */
function parseRpcResult(data: unknown): SavedResult | null {
  if (typeof data !== 'object' || data === null) return null;
  const r = data as Record<string, unknown>;
  const { updated_at: updatedAt, ids, warnings } = r;
  if (typeof updatedAt !== 'string' || updatedAt === '') return null;
  const idMap = ids ?? {};
  const warn = warnings ?? {};
  if (!isStringRecord(idMap) || !isStringRecord(warn)) return null;
  const { slug, slug_confirmed: slugConfirmed, avatar_url: avatarUrl } = r;
  const { is_published: isPublished, first_published_at: firstPublishedAt } = r;
  if (!isStrOrNull(slug) || !isStrOrNull(avatarUrl) || !isStrOrNull(firstPublishedAt)) return null;
  if (typeof slugConfirmed !== 'boolean' || typeof isPublished !== 'boolean') return null;
  return { ok: true, idMap, updatedAt, warnings: warn, slug, slugConfirmed, avatarUrl, isPublished, firstPublishedAt };
}

/**
 * Call `public.save_profile(p_payload, p_mode)` with the caller's own session
 * (SECURITY INVOKER: RLS and every trigger apply). Errors become member copy
 * via `dbErrorFor` (which records unrecognised ones) plus a field key parsed
 * from the RPC's DETAIL.
 */
export async function saveProfileRpc(
  supabase: SupabaseClient,
  payload: SavePayload,
  mode: SaveMode,
): Promise<SavedResult | SaveRpcFailure> {
  let data: unknown;
  let error: DbErrorLike;
  try {
    const res = await supabase.rpc('save_profile', { p_payload: payload, p_mode: mode });
    data = res.data;
    error = res.error;
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }

  if (error) {
    const fieldKey = saveErrorFieldKey(error);
    const copy = dbErrorFor('save-profile', error);
    return fieldKey ? { ok: false, error: copy, fieldKey } : { ok: false, error: copy };
  }

  const parsed = parseRpcResult(data);
  if (!parsed) {
    return { ok: false, error: dbErrorFor('save-profile', { message: 'save_profile returned an unexpected shape' }) };
  }
  return parsed;
}

// ── Profile snapshot (publish re-check) ─────────────────────────────────

/** The stored identity, as the database has it. */
export interface EditorProfileSnapshot {
  id: string;
  /** `profiles.updated_at`: the next save's `base_updated_at`. */
  updatedAt: string | null;
  slug: string | null;
  slugConfirmed: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  isPublished: boolean;
  firstPublishedAt: string | null;
}

/** Read the caller's own profile row (RLS-scoped). Null when there is none. */
export async function loadEditorProfileSnapshot(
  supabase: SupabaseClient,
  userId: string,
): Promise<EditorProfileSnapshot | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, updated_at, slug, slug_confirmed, display_name, avatar_url, is_published, first_published_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  if (typeof row.id !== 'string') return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    id: row.id,
    updatedAt: str(row.updated_at),
    slug: str(row.slug),
    slugConfirmed: row.slug_confirmed === true,
    displayName: str(row.display_name),
    avatarUrl: str(row.avatar_url),
    isPublished: row.is_published === true,
    firstPublishedAt: str(row.first_published_at),
  };
}

/**
 * Every identity item the STORED profile is missing for publishing, in spec
 * §01 order (photo, display name, CheckLyra ID). The ID counts only when it
 * was chosen (`slug_confirmed`): the signup placeholder passes the format
 * check. Empty list = ready to publish. PURE.
 */
export function publishRequirementsMissing(s: EditorProfileSnapshot): string[] {
  const missing: string[] = [];
  if (!s.avatarUrl || s.avatarUrl.trim() === '') missing.push(PUBLISH_PHOTO_MISSING);
  if (!s.displayName || s.displayName.trim() === '') missing.push(PUBLISH_NAME_MISSING);
  if (!s.slugConfirmed || !checkLyraId(s.slug).ok) missing.push(PUBLISH_ID_MISSING);
  return missing;
}

/**
 * The save result with the identity fields replaced by the row as re-read
 * AFTER `publishProfile()`, which bumped `updated_at` (on_profile_updated
 * trigger) and set `is_published` / `first_published_at`. Returning the
 * save's own `updatedAt` would make the next Save Changes fail the
 * concurrency check. Null when the re-read row has no `updated_at`. PURE.
 */
export function refreshedAfterPublish(saved: SavedResult, after: EditorProfileSnapshot): SavedResult | null {
  if (after.updatedAt === null) return null;
  return {
    ...saved,
    updatedAt: after.updatedAt,
    slug: after.slug,
    slugConfirmed: after.slugConfirmed,
    avatarUrl: after.avatarUrl,
    isPublished: after.isPublished,
    firstPublishedAt: after.firstPublishedAt,
  };
}

/** The editor field each publish blocker belongs to. */
export const PUBLISH_BLOCKER_FIELD: Readonly<Record<string, string>> = {
  [PUBLISH_PHOTO_MISSING]: 'photo',
  [PUBLISH_NAME_MISSING]: 'profile.display_name',
  [PUBLISH_ID_MISSING]: 'profile.lyra_id',
};

// ── Preset answer limits (spec v0.8 §09) ────────────────────────────────

/**
 * `answer_max` for each preset prompt id. On a read error every id maps to
 * ANSWER_HARD_MAX (the table ceiling), so the app never rejects an answer
 * the DB would accept; `enforce_pcs_answer_max()` stays the exact limit.
 */
export async function loadPresetAnswerMax(
  supabase: SupabaseClient,
  promptIds: readonly string[],
): Promise<Map<string, number | null>> {
  const ids = [...new Set(promptIds.filter((id) => typeof id === 'string' && id !== ''))];
  const out = new Map<string, number | null>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.from('conversation_starter_prompts').select('id, answer_max').in('id', ids);
  if (error || !Array.isArray(data)) {
    for (const id of ids) out.set(id, ANSWER_HARD_MAX);
    return out;
  }
  for (const row of data as Array<{ id?: unknown; answer_max?: unknown }>) {
    if (typeof row.id === 'string') out.set(row.id, typeof row.answer_max === 'number' ? row.answer_max : null);
  }
  return out;
}

// ── Moderation targets ──────────────────────────────────────────────────

/** One piece of member-written text to moderate, and where to report it. */
export interface ModerationTarget {
  text: string;
  /** Audit field name, `<table>.<column>`, as the legacy actions use. */
  field: string;
  /** Editor error key. */
  key: string;
}

/**
 * Every non-blank text in the save DIFF (so only changed fields), in payload
 * order. PURE.
 */
export function moderationTargets(payload: SavePayload): ModerationTarget[] {
  const out: ModerationTarget[] = [];
  const add = (text: unknown, field: string, key: string) => {
    if (typeof text === 'string' && text.trim() !== '') out.push({ text, field, key });
  };

  const p = payload.profile;
  if (p) {
    for (const [k, v] of Object.entries(p)) {
      add(v, `profiles.${k}`, k === 'slug' ? 'profile.lyra_id' : `profile.${k}`);
    }
  }
  for (const u of payload.items?.upsert ?? []) {
    add(u.title, 'profile_items.title', `${u.client_key}.title`);
    add(u.description, 'profile_items.description', `${u.client_key}.description`);
    add(u.group_label, 'profile_items.group_label', `${u.client_key}.group_label`);
  }
  for (const u of payload.affiliations?.upsert ?? []) {
    add(u.school_name, 'school_affiliations.school_name', `${u.client_key}.name`);
    add(u.school_location, 'school_affiliations.school_location', `${u.client_key}.location`);
    add(u.description, 'school_affiliations.description', `${u.client_key}.description`);
  }
  if (payload.manual_of_me) {
    for (const [k, v] of Object.entries(payload.manual_of_me)) {
      add(v, `profile_manual_of_me.${k}`, `manual_of_me.${k}`);
    }
  }
  for (const u of payload.questions?.upsert ?? []) {
    add(u.custom_prompt, 'profile_conversation_starters.custom_prompt', `${u.client_key}.custom_prompt`);
    add(u.answer, 'profile_conversation_starters.answer', `${u.client_key}.answer`);
  }
  return out;
}
