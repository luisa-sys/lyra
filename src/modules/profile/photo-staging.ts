/**
 * KAN-487 — v0.8 profile editor: staged profile photos (spec v0.8 §01 / §1
 * "edits remain private until the user presses Save Changes"; plan §B
 * "Photo").
 *
 * The legacy `uploadAvatar` overwrote `${uid}/avatar.jpg` and pointed the
 * profile at it at once, so a new photo went live before the member saved.
 * The editor instead:
 *
 *   1. stageProfilePhoto   processes the file (real type, ≥ 400 px, square
 *                          crop, EXIF stripped — photo-processing.ts) and
 *                          uploads it to a NEW unique path
 *                          `profile-photos/<uid>/avatar-<uuid>.jpg`
 *                          (upsert: false). Nothing on the profile changes.
 *   2. resolveStagedPhoto  at save time, checks the client-named path is
 *                          exactly `<uid>/avatar-<uuid v4>.jpg` and exists,
 *                          and returns
 *                          the public URL the save writes to `avatar_url`.
 *                          The client never supplies a URL.
 *   3. cleanupOldPhotos    after a successful save, best effort: removes the
 *                          caller's other `avatar*` objects. Never throws.
 *
 * Residual risk (plan §B, ADR-010): the bucket is public, so a staged file is
 * reachable by anyone who knows its unguessable UUID path until cleanup.
 *
 * Server only (Node runtime: sharp). No imports from `src/app/**`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { preflightUpload } from '@/modules/guards/file-magic-bytes';
import { dbErrorFor } from '@/modules/profile/db-error-copy';
import {
  PHOTO_MAX_BYTES,
  PHOTO_SIZE_ERROR,
  PHOTO_TYPE_ERROR,
  processProfilePhoto,
  type PhotoCrop,
} from '@/modules/profile/photo-processing';

export const PROFILE_PHOTO_BUCKET = 'profile-photos';

/** Same allowlist as `uploadAvatar` (spec v0.8 §01: JPG, PNG or WebP). */
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Not in the spec; founder-approved 2026-11-23 with the PR #1238 error messages. */
export const STAGED_PHOTO_INVALID_ERROR = 'That photo is no longer available. Please upload it again.';
export const NO_FILE_ERROR = 'No file provided';

export type StagePhotoResult = { ok: true; path: string; previewUrl: string } | { ok: false; error: string };
export type ResolvePhotoResult = { ok: true; avatarUrl: string } | { ok: false; error: string };

/** The object name inside the bucket for a new staged photo. */
export function stagedPhotoPath(userId: string, uuid: string = crypto.randomUUID()): string {
  return `${userId}/avatar-${uuid}.jpg`;
}

/** `avatar-<uuid v4, lowercase hex with dashes>.jpg` — exactly what `stagedPhotoPath` makes. */
const STAGED_NAME_RE = /^avatar-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;

/**
 * True when `path` is exactly `<uid>/avatar-<uuid v4>.jpg`, the name
 * `stageProfilePhoto` gives a PROCESSED photo. Storage rules let a member
 * upload anything under `<uid>/` directly (e.g. `avatar-x.svg`, or a JPEG
 * with GPS data), so any other name is refused. PURE.
 */
export function isOwnStagedPhotoPath(userId: string, path: unknown): path is string {
  if (typeof path !== 'string' || typeof userId !== 'string' || userId === '') return false;
  const prefix = `${userId}/`;
  if (!path.startsWith(prefix)) return false;
  return STAGED_NAME_RE.test(path.slice(prefix.length));
}

function publicUrl(supabase: SupabaseClient, path: string): string {
  return supabase.storage.from(PROFILE_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Check, process and upload a new photo to a unique staged path. The profile
 * row is not touched.
 */
export async function stageProfilePhoto(
  supabase: SupabaseClient,
  userId: string,
  file: File | null | undefined,
  crop: PhotoCrop | null,
): Promise<StagePhotoResult> {
  const preflightError = await preflightUpload(file, {
    allowedMimes: ALLOWED_IMAGE_TYPES,
    maxBytes: PHOTO_MAX_BYTES,
    emptyMessage: NO_FILE_ERROR,
    typeMessage: PHOTO_TYPE_ERROR,
    sizeMessage: PHOTO_SIZE_ERROR,
  });
  if (preflightError) return { ok: false, error: preflightError };

  const photo = await processProfilePhoto(await (file as File).arrayBuffer(), crop);
  if (!photo.ok) return { ok: false, error: photo.error };

  const path = stagedPhotoPath(userId);
  const { error } = await supabase.storage
    .from(PROFILE_PHOTO_BUCKET)
    .upload(path, photo.buffer, { upsert: false, contentType: photo.contentType });
  if (error) return { ok: false, error: dbErrorFor('stage-profile-photo', error) };

  return { ok: true, path, previewUrl: publicUrl(supabase, path) };
}

/**
 * Turn a client-named staged path into the `avatar_url` to save. Refuses any
 * path that is not the caller's own staged photo, and any that no longer
 * exists in the bucket.
 */
export async function resolveStagedPhoto(
  supabase: SupabaseClient,
  userId: string,
  path: unknown,
): Promise<ResolvePhotoResult> {
  if (!isOwnStagedPhotoPath(userId, path)) return { ok: false, error: STAGED_PHOTO_INVALID_ERROR };

  const name = path.slice(userId.length + 1);
  const { data, error } = await supabase.storage
    .from(PROFILE_PHOTO_BUCKET)
    .list(userId, { search: name, limit: 100 });
  if (error || !Array.isArray(data) || !data.some((o) => o?.name === name)) {
    return { ok: false, error: STAGED_PHOTO_INVALID_ERROR };
  }

  return { ok: true, avatarUrl: `${publicUrl(supabase, path)}?v=${Date.now()}` };
}

/**
 * Best effort: remove the caller's `avatar*` objects other than `keepPath`
 * (all of them when `keepPath` is null). Never throws; a failure only leaves
 * an orphaned file behind.
 *
 * Known and accepted (KAN-487 review, minor 8): this also removes a photo
 * staged in ANOTHER tab that has not been saved yet. That tab's save then
 * fails with STAGED_PHOTO_INVALID_ERROR and the member uploads again; no
 * stored data is lost.
 */
export async function cleanupOldPhotos(
  supabase: SupabaseClient,
  userId: string,
  keepPath: string | null,
): Promise<void> {
  try {
    const { data, error } = await supabase.storage.from(PROFILE_PHOTO_BUCKET).list(userId, { limit: 1000 });
    if (error || !Array.isArray(data)) return;
    const doomed = data
      .map((o) => (typeof o?.name === 'string' ? o.name : ''))
      .filter((n) => n.startsWith('avatar') && !n.includes('/'))
      .map((n) => `${userId}/${n}`)
      .filter((p) => p !== keepPath);
    if (doomed.length === 0) return;
    await supabase.storage.from(PROFILE_PHOTO_BUCKET).remove(doomed);
  } catch {
    // Best effort by design (plan §B step 7): the save already succeeded.
  }
}
