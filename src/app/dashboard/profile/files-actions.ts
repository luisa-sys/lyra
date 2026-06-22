'use server';

import { createClient } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { sanitiseText, type ActionResult } from '@/lib/sanitise';
import { checkProfileWriteRateLimit } from '@/lib/profile-rate-limit';
import { coerceVisibility } from './visibility';
import {
  validateFileMagicBytes,
  ALLOWED_MIMES,
  extensionForMime,
  type AllowedMime,
} from '@/lib/file-magic-bytes';
import { getMyFeatureEntitlements } from '@/lib/features/entitlements';

/**
 * KAN-142: server actions for the profile_files surface.
 *
 * Three rules baked into every action:
 *
 *  1. **Authentication is required.** No file mutations from anonymous
 *     callers. `getAuthenticatedUser` short-circuits with an error.
 *
 *  2. **The user's own profile is the only one they can touch.** Every
 *     mutation joins `profiles` on `user_id = auth.uid()`. RLS enforces
 *     the same at the DB layer, but the application also checks so the
 *     error message can be helpful instead of an opaque RLS denial.
 *
 *  3. **Magic-byte validation BEFORE storage upload.** Declared MIME
 *     is browser-controlled and trivially spoofable. The server reads
 *     the first 16 bytes of every upload and matches against the
 *     documented signatures for the declared type. Mismatch = reject.
 *
 * The 10-file cap is enforced by a DB trigger (profile_files_cap) so
 * we don't have to race-check it in application code.
 */

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — matches bucket limit + DB check

interface AuthedRequest {
  user: { id: string };
  supabase: Awaited<ReturnType<typeof createClient>>;
  profileId: string;
}

async function getAuthedRequest(): Promise<AuthedRequest | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single();
  if (!profile) return { error: 'No profile for current user' };

  return { user: { id: user.id }, supabase, profileId: profile.id as string };
}

export async function uploadProfileFile(formData: FormData): Promise<ActionResult> {
  const authed = await getAuthedRequest();
  if ('error' in authed) return { success: false, error: authed.error };
  const { user, supabase, profileId } = authed;

  // KAN-309 — per-user feature gate (default on; an admin can revoke).
  const features = await getMyFeatureEntitlements();
  if (!features.media_uploads) {
    return { success: false, error: 'Media uploads are not enabled for your account.' };
  }

  // KAN-231 — profile-save rate limiting (file uploads are expensive — cap them).
  const rl = await checkProfileWriteRateLimit(user.id);
  if (!rl.allowed) return rl.result;

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return { success: false, error: 'No file supplied' };
  }
  if (file.size === 0) {
    return { success: false, error: 'File is empty' };
  }
  if (file.size > MAX_BYTES) {
    return { success: false, error: `File exceeds 10 MB limit (got ${file.size} bytes)` };
  }
  if (!ALLOWED_MIMES.has(file.type as AllowedMime)) {
    return {
      success: false,
      error: `Disallowed type ${file.type}. Allowed: ${[...ALLOWED_MIMES].join(', ')}`,
    };
  }

  // Magic-byte check — never trust the declared MIME alone.
  const magicError = await validateFileMagicBytes(file, file.type);
  if (magicError) {
    return { success: false, error: magicError };
  }

  const displayName = sanitiseText(
    // Strip path separators from the display name; keep the user-visible
    // bit at most 100 chars long.
    (formData.get('file_name') as string | null) || file.name,
  )
    .replace(/[/\\]/g, '')
    .slice(0, 100);

  // Storage path: {user_id}/{uuid}.{ext}. The UUID is generated server-side
  // so two files with the same display name don't collide.
  const ext = extensionForMime(file.type as AllowedMime);
  const storagePath = `${user.id}/${crypto.randomUUID()}.${ext}`;

  // Upload to storage first. If the DB insert later fails (e.g. trigger
  // rejects because cap reached), we clean up the orphan.
  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase
    .storage
    .from('profile-files')
    .upload(storagePath, arrayBuffer, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: false,
    });
  if (uploadError) {
    return { success: false, error: `Upload failed: ${uploadError.message}` };
  }

  const visibility = coerceVisibility(formData.get('visibility') as string | null);
  const { error: insertError } = await supabase
    .from('profile_files')
    .insert({
      profile_id: profileId,
      storage_path: storagePath,
      file_name: displayName,
      mime_type: file.type,
      size_bytes: file.size,
      visibility,
    });

  if (insertError) {
    // Orphan cleanup — best-effort; the user-facing error is the more
    // important signal.
    await supabase.storage.from('profile-files').remove([storagePath]);
    return { success: false, error: insertError.message };
  }

  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function removeProfileFile(id: string): Promise<ActionResult> {
  const authed = await getAuthedRequest();
  if ('error' in authed) return { success: false, error: authed.error };
  const { supabase, profileId } = authed;

  // Fetch the row before delete so we know the storage_path to clean up.
  // RLS guards the read: a user can only see their own files via the
  // "Users can manage own files" policy. If the row isn't theirs, the
  // select returns null and we 404 cleanly.
  const { data: row } = await supabase
    .from('profile_files')
    .select('id, storage_path')
    .eq('id', id)
    .eq('profile_id', profileId)
    .maybeSingle();
  if (!row) {
    return { success: false, error: 'File not found' };
  }

  const { error: deleteError } = await supabase
    .from('profile_files')
    .delete()
    .eq('id', id);
  if (deleteError) {
    return { success: false, error: deleteError.message };
  }

  // Storage cleanup. RLS on storage.objects already restricts delete to
  // the file's owner via folder-based check, so this is defence in depth.
  await supabase.storage.from('profile-files').remove([row.storage_path as string]);

  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function updateProfileFileVisibility(
  id: string,
  visibility: string,
): Promise<ActionResult> {
  const authed = await getAuthedRequest();
  if ('error' in authed) return { success: false, error: authed.error };
  const { supabase, profileId } = authed;

  const coerced = coerceVisibility(visibility);

  const { error } = await supabase
    .from('profile_files')
    .update({ visibility: coerced })
    .eq('id', id)
    .eq('profile_id', profileId);
  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/dashboard/profile');
  return { success: true };
}
