'use server';

/**
 * KAN-154 — Server action for the "Manual of Me" profile section.
 *
 * Writes to the 1-1 `profile_manual_of_me` table (see migration
 * 20260514120000_manual_of_me.sql).
 *
 * Security:
 *   - Allowlist of writable fields (MANUAL_OF_ME_FIELDS) enforced before any
 *     DB call, same pattern as updateProfileFields → prevents remote property
 *     injection. (KAN-167 / CodeQL alert #2.)
 *   - Every string field is run through sanitiseText (strips HTML, normalises
 *     whitespace) with a per-field max length — defends in depth against
 *     stored XSS even though React JSX auto-escapes. See KAN-171.
 *   - The owning profile is resolved server-side from auth.uid() — caller
 *     cannot supply a profile_id.
 */

import { createClient } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { sanitiseText, type ActionResult } from '@/lib/sanitise';
import { moderateAndAudit } from '@/lib/moderation-audit';
import { checkProfileWriteRateLimit } from '@/lib/profile-rate-limit';
import {
  MANUAL_OF_ME_FIELDS,
  MANUAL_OF_ME_MAX_LENGTHS,
  isManualOfMeField,
} from './manual-of-me-fields';

/** Update (upsert) the user's Manual of Me row. Accepts a partial — any
 * subset of allowlisted fields. Non-allowlisted keys cause wholesale
 * rejection with a descriptive error.
 *
 * Null / empty-string values are written as null in the DB so the public-view
 * "skip if empty" logic works correctly.
 */
export async function updateManualOfMe(
  data: Record<string, string | null>
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // KAN-231 — profile-save rate limiting.
  const rl = await checkProfileWriteRateLimit(user.id);
  if (!rl.allowed) return rl.result;

  // 1. Allowlist enforcement — collect ALL rejected keys for a useful error.
  const rejected: string[] = [];
  const sanitised: Record<string, string | null> = {};
  for (const [key, val] of Object.entries(data)) {
    if (!isManualOfMeField(key)) {
      rejected.push(key);
      continue;
    }
    if (val === null || val === undefined) {
      sanitised[key] = null;
      continue;
    }
    if (typeof val !== 'string') {
      // Defensive: this should not happen given the action signature, but
      // a buggy caller passing a number/object would otherwise blow up
      // sanitiseText. Reject explicitly.
      rejected.push(key);
      continue;
    }
    const maxLen = MANUAL_OF_ME_MAX_LENGTHS[key];
    const cleaned = sanitiseText(val, maxLen);
    // Treat post-sanitisation empty string as null so isManualOfMeEmpty works.
    sanitised[key] = cleaned === '' ? null : cleaned;
  }

  if (rejected.length > 0) {
    return {
      success: false,
      error: `Field(s) not permitted: ${rejected.join(', ')}`,
    };
  }

  // 2. Resolve the owning profile (server-side, not client-supplied).
  // Fetched BEFORE moderation so the audit-row gets a profile_id (owner
  // can see own flags via RLS).
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single();
  if (profileErr || !profile) {
    return { success: false, error: 'Profile not found' };
  }

  // 1b. KAN-241 + KAN-244 — content moderation + audit log. Manual of Me
  // fields appear on the public profile via [slug]/page.tsx, so 'public'
  // fieldType applies. Moderate the sanitised text (post-strip, post-trim)
  // so HTML wrappers can't hide profanity from the word-boundary matcher.
  for (const [key, val] of Object.entries(sanitised)) {
    if (!val) continue;
    const mod = await moderateAndAudit(supabase, {
      text: val,
      fieldType: 'public',
      field: `profile_manual_of_me.${key}`,
      profileId: profile.id,
      source: 'web_app',
    });
    if (!mod.ok) {
      return { success: false, error: mod.error };
    }
  }

  // 3. Empty input → no-op success (don't fire a meaningless UPDATE).
  if (Object.keys(sanitised).length === 0) {
    return { success: true };
  }

  // 4. Upsert (insert-or-update on profile_id PK). RLS enforces ownership.
  const { error } = await supabase
    .from('profile_manual_of_me')
    .upsert(
      { profile_id: profile.id, ...sanitised },
      { onConflict: 'profile_id' }
    );

  if (error) return { success: false, error: error.message };

  revalidatePath('/dashboard/profile');
  return { success: true };
}

// Note: MANUAL_OF_ME_FIELDS is intentionally not re-exported from this file
// (it would be a non-async export, rejected by Next.js 16+ at action-invocation
// time — see CLAUDE.md gotcha #18). Callers should import it directly from
// ./manual-of-me-fields.
