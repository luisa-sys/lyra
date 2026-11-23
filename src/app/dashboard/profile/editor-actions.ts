'use server';

/**
 * KAN-487 — v0.8 profile editor server actions (spec v0.8 §1 "Save all
 * sections together atomically", §3; plan §B "Server action flow").
 *
 *   saveProfileDraft(payload)                    Save Draft (before publishing)
 *   publishProfileFromEditor(payload, snapshot?) Publish
 *   saveProfileChanges(payload)                  Save Changes (published)
 *   stageProfilePhoto(formData)                  stage a new photo (not live)
 *
 * Flow per save: auth → rate limit (once) → validate the DIFF → moderate the
 * changed text → resolve the photo (staged path → URL; remove → null) →
 * `save_profile` RPC → clean up old photos → revalidate.
 *
 * Publish re-checks the identity from the DATABASE after the save (photo,
 * display name, chosen CheckLyra ID) and only then calls the existing
 * `publishProfile()` (service role + age gate, SEC-112), then re-reads the
 * row so the client gets the fresh `updated_at` / `first_published_at` /
 * `is_published`. The optional client snapshot can only stop a publish
 * early, never allow one.
 *
 * Only the validator's CLEANED payload reaches the RPC (and moderation).
 *
 * CTL-056: zero `.from` / `.rpc` / `.storage` calls here — data access lives
 * in src/modules/profile/{save-profile,photo-staging}.ts. Gotcha #18: a
 * `'use server'` file exports async functions only.
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@/modules/platform/supabase-server';
import { checkProfileWriteRateLimit } from '@/modules/guards/profile-rate-limit';
import { moderateAndAudit } from '@/modules/audit/moderation-audit';
import { parseCrop } from '@/modules/profile/photo-processing';
import {
  INVALID_ENTRY_ERROR,
  PUBLISHED_PHOTO_ERROR,
  isSavePayloadShape,
  validateForPublish,
  validatePayloadForServer,
} from '@/modules/profile/editor/validate-save-payload';
import type {
  EditorState,
  SaveMode,
  SavePayload,
  SavePhotoPayload,
  SaveResult,
} from '@/modules/profile/editor/editor-state';
import {
  PUBLISH_BLOCKER_FIELD,
  loadEditorProfileSnapshot,
  loadPresetAnswerMax,
  moderationTargets,
  publishRequirementsMissing,
  refreshedAfterPublish,
  saveProfileRpc,
  type EditorProfileSnapshot,
  type EditorPublishResult,
  type SavedResult,
} from '@/modules/profile/save-profile';
import {
  cleanupOldPhotos,
  resolveStagedPhoto,
  stageProfilePhoto as stagePhotoFile,
  type StagePhotoResult,
} from '@/modules/profile/photo-staging';
import { publishProfile } from './actions';

// Proposed copy (plan §D; not in the spec).
const PUBLISHED_PHOTO_REMOVE_BLOCK = 'Add a new photo to save your changes — a published profile needs a photo.';
const SAVE_FAILED = 'We couldn’t save your changes. Your edits are still here.';
const PUBLISH_BLOCKED_HEADING = 'Before you can publish:';
const NOT_AUTHENTICATED = 'Not authenticated';
// Approved copy (KAN-487 brief): the profile is published but its fresh
// state could not be read, so the client must reload before the next save.
const EDITOR_OUT_OF_DATE = 'Editor is out of date. Reload to continue.';

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function getAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { user, supabase };
}

function fail(error: string, fieldErrors?: Record<string, string>): SaveResult {
  return fieldErrors && Object.keys(fieldErrors).length > 0 ? { ok: false, error, fieldErrors } : { ok: false, error };
}

function publishBlocked(missing: string[]): { error: string; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  for (const m of missing) fieldErrors[PUBLISH_BLOCKER_FIELD[m] ?? 'profile'] = m;
  return { error: `${PUBLISH_BLOCKED_HEADING} ${missing.join(', ')}.`, fieldErrors };
}

/** Client photo intent → what the RPC receives. The client never sends a URL. */
async function resolvePhoto(
  supabase: Supabase,
  userId: string,
  photo: SavePhotoPayload | undefined,
): Promise<{ ok: true; photo: SavePhotoPayload | undefined; keepPath: string | null | undefined } | { ok: false; error: string }> {
  if (photo === undefined || photo.action === 'keep') return { ok: true, photo, keepPath: undefined };
  if (photo.action === 'remove') return { ok: true, photo: { action: 'remove' }, keepPath: null };
  if (photo.action === 'set') {
    const resolved = await resolveStagedPhoto(supabase, userId, photo.staged_path);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    return {
      ok: true,
      photo: { action: 'set', avatar_url: resolved.avatarUrl },
      keepPath: photo.staged_path as string,
    };
  }
  return { ok: false, error: INVALID_ENTRY_ERROR };
}

type Prepared =
  | {
      ok: true;
      supabase: Supabase;
      userId: string;
      before: EditorProfileSnapshot | null;
      rpcPayload: SavePayload;
      keepPath: string | null | undefined;
      warnings: Record<string, string>;
    }
  | { ok: false; result: SaveResult };

/** Steps 1–5 of the flow; nothing is written yet. */
async function prepareSave(raw: unknown, mode: SaveMode): Promise<Prepared> {
  const { user, supabase } = await getAuthenticatedUser();
  if (!user) return { ok: false, result: fail(NOT_AUTHENTICATED) };

  const rl = await checkProfileWriteRateLimit(user.id);
  if (!rl.allowed) {
    return { ok: false, result: fail(rl.result.success ? SAVE_FAILED : rl.result.error) };
  }

  // Nested shape (arrays, UUID ids, string text) — a clean error, never a throw.
  if (!isSavePayloadShape(raw)) return { ok: false, result: fail(INVALID_ENTRY_ERROR) };
  const payload = raw;

  // Spec open decision → founder: a published profile cannot drop its photo.
  if (mode === 'published' && payload.photo?.action === 'remove') {
    return { ok: false, result: fail(PUBLISHED_PHOTO_REMOVE_BLOCK, { photo: PUBLISHED_PHOTO_ERROR }) };
  }

  const promptIds = (payload.questions?.upsert ?? [])
    .map((u) => u.prompt_id)
    .filter((id): id is string => typeof id === 'string');
  const presetAnswerMax = await loadPresetAnswerMax(supabase, promptIds);

  const checked = validatePayloadForServer(payload, { mode, presetAnswerMax });
  if (!checked.ok) return { ok: false, result: fail(SAVE_FAILED, checked.errors) };

  // From here on only the CLEANED payload is used (validated `.value`s, the
  // parsed link, a draft's refused ID left out) — never the raw client text.
  let rpcPayload: SavePayload = checked.payload;

  const before = await loadEditorProfileSnapshot(supabase, user.id);

  for (const t of moderationTargets(rpcPayload)) {
    const mod = await moderateAndAudit(supabase, {
      text: t.text,
      fieldType: 'public',
      field: t.field,
      profileId: before?.id ?? null,
      source: 'web_app',
    });
    if (!mod.ok) return { ok: false, result: fail(mod.error, { [t.key]: mod.error }) };
  }

  const photo = await resolvePhoto(supabase, user.id, rpcPayload.photo);
  if (!photo.ok) return { ok: false, result: fail(photo.error, { photo: photo.error }) };
  if (photo.photo === undefined) {
    const { photo: _none, ...rest } = rpcPayload;
    void _none;
    rpcPayload = rest;
  } else {
    rpcPayload = { ...rpcPayload, photo: photo.photo };
  }

  return {
    ok: true,
    supabase,
    userId: user.id,
    before,
    rpcPayload,
    keepPath: photo.keepPath,
    warnings: checked.warnings,
  };
}

/** Steps 6–7: the RPC, then photo cleanup. Revalidation is the caller's. */
async function commitSave(
  p: Extract<Prepared, { ok: true }>,
  mode: SaveMode,
): Promise<SavedResult | { ok: false; result: SaveResult }> {
  const saved = await saveProfileRpc(p.supabase, p.rpcPayload, mode);
  if (!saved.ok) {
    return { ok: false, result: fail(saved.error, saved.fieldKey ? { [saved.fieldKey]: saved.error } : undefined) };
  }
  if (p.keepPath !== undefined) await cleanupOldPhotos(p.supabase, p.userId, p.keepPath);
  return { ...saved, warnings: { ...p.warnings, ...saved.warnings } };
}

function revalidateEditor(slug: string | null | undefined): void {
  revalidatePath('/dashboard/profile');
  revalidatePath('/dashboard');
  if (slug) revalidatePath(`/${slug}`);
}

/** Draft / Save Changes: one atomic save in `mode`. */
async function runSave(raw: unknown, mode: 'draft' | 'published'): Promise<SaveResult> {
  const prepared = await prepareSave(raw, mode);
  if (!prepared.ok) return prepared.result;
  const saved = await commitSave(prepared, mode);
  if (!saved.ok) return saved.result;

  const sentSlug = prepared.rpcPayload.profile?.slug;
  const slug = sentSlug !== undefined && saved.warnings.lyra_id === undefined ? sentSlug : prepared.before?.slug;
  revalidateEditor(slug);
  return saved;
}

/** Save Draft — before the first publish. Identity is not required. */
export async function saveProfileDraft(payload: SavePayload): Promise<SaveResult> {
  return runSave(payload, 'draft');
}

/**
 * Save Changes — a published profile. All sections in one transaction; any
 * failure leaves the public profile as it was.
 */
export async function saveProfileChanges(payload: SavePayload): Promise<SaveResult> {
  return runSave(payload, 'published');
}

/**
 * Publish: save with mode `publish`, re-read the stored identity, and only
 * when it is complete call `publishProfile()`. If the rows were saved but
 * publishing fails, the result carries `saved` so the client can rebase.
 */
export async function publishProfileFromEditor(
  payload: SavePayload,
  editorStateSnapshotForPublishCheck?: EditorState,
): Promise<EditorPublishResult> {
  // Early, client-side view: may only REFUSE (saves a round trip), never allow.
  if (editorStateSnapshotForPublishCheck !== undefined) {
    let missing: string[] = [];
    try {
      missing = validateForPublish(editorStateSnapshotForPublishCheck);
    } catch {
      missing = [];
    }
    if (missing.length > 0) {
      const blocked = publishBlocked(missing);
      return fail(blocked.error, blocked.fieldErrors);
    }
  }

  const prepared = await prepareSave(payload, 'publish');
  if (!prepared.ok) return prepared.result;
  const saved = await commitSave(prepared, 'publish');
  if (!saved.ok) return saved.result;

  // Authoritative: the identity as the database now holds it.
  const after = await loadEditorProfileSnapshot(prepared.supabase, prepared.userId);
  if (!after) {
    revalidateEditor(prepared.before?.slug);
    return { ok: false, error: SAVE_FAILED, saved };
  }
  const missing = publishRequirementsMissing(after);
  if (missing.length > 0) {
    revalidateEditor(after.slug);
    return { ...publishBlocked(missing), ok: false, saved };
  }

  const published = await publishProfile();
  revalidateEditor(after.slug);
  if (!published.success) return { ok: false, error: published.error, saved };

  // publishProfile() wrote the row again (is_published, first_published_at,
  // and the updated_at trigger), so the save's values are stale: re-read.
  const fresh = await loadEditorProfileSnapshot(prepared.supabase, prepared.userId);
  const result = fresh ? refreshedAfterPublish(saved, fresh) : null;
  // The profile IS published; only the re-read failed. Report success (never
  // "couldn't save", which would invite a retry as a draft) with a warning
  // that the editor must reload before its next save — its updatedAt is stale.
  if (!result) {
    return { ...saved, isPublished: true, warnings: { ...saved.warnings, publish: EDITOR_OUT_OF_DATE } };
  }
  return result;
}

/**
 * Stage a new profile photo at a unique path. Not live until a save names it
 * (`photo: {action: 'set', staged_path}`).
 */
export async function stageProfilePhoto(formData: FormData): Promise<StagePhotoResult> {
  const { user, supabase } = await getAuthenticatedUser();
  if (!user) return { ok: false, error: NOT_AUTHENTICATED };

  const rl = await checkProfileWriteRateLimit(user.id);
  if (!rl.allowed) return { ok: false, error: rl.result.success ? SAVE_FAILED : rl.result.error };

  const entry = formData.get('avatar');
  const file = typeof File !== 'undefined' && entry instanceof File ? entry : null;
  return stagePhotoFile(supabase, user.id, file, parseCrop(formData));
}
