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
 *   - Every string field is run through validateFreeText (KAN-486): strips
 *     HTML (stored-XSS defence in depth, KAN-171), keeps line breaks, and
 *     REJECTS over-limit text and contact details rather than cutting them.
 *   - The owning profile is resolved server-side from auth.uid() — caller
 *     cannot supply a profile_id.
 */

import { createClient } from '@/modules/platform/supabase-server';
import { revalidatePath } from 'next/cache';
import { type ActionResult } from '@/modules/guards/sanitise';
import { validateFreeText } from '@/modules/profile/free-text';
import { MANUAL_OF_ME_LABELS } from '@/modules/profile/field-validation';
import { moderateAndAudit } from '@/modules/audit/moderation-audit';
import { checkProfileWriteRateLimit } from '@/modules/guards/profile-rate-limit';
import { dbErrorFor } from '@/modules/profile/db-error-copy';
import {
  MANUAL_OF_ME_FIELDS,
  MANUAL_OF_ME_MAX_LENGTHS,
  isManualOfMeField,
} from '@/modules/profile/manual-of-me-fields';

/** Update (upsert) the user's Manual of Me row. Accepts a partial — any
 * subset of allowlisted fields. Non-allowlisted keys cause wholesale
 * rejection with a descriptive error.
 *
 * Null / empty-string values are written as null in the DB so the public-view
 * "skip if empty" logic works correctly.
 *
 * BUGS-74 — "not provided" and "explicitly cleared" are different things:
 *   - `undefined`      → the field is OMITTED from the upsert, leaving whatever
 *                        is already in the DB untouched. This is what makes the
 *                        "accepts a partial" promise above actually true.
 *   - `null` or `''`   → an explicit clear; written as NULL.
 * Previously `undefined` was coerced to null and written, so any caller that
 * sent an incomplete object silently destroyed the fields it omitted.
 */
export async function updateManualOfMe(
  data: Record<string, string | null | undefined>
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
    // BUGS-74: absent means "leave it alone", not "clear it". Omitting the key
    // keeps it out of the upsert payload entirely.
    if (val === undefined) {
      continue;
    }
    if (val === null) {
      sanitised[key] = null;
      continue;
    }
    if (typeof val !== 'string') {
      // Defensive: this should not happen given the action signature, but
      // a buggy caller passing a number/object would otherwise blow up
      // validation. Reject explicitly.
      rejected.push(key);
      continue;
    }
    // KAN-486 — v0.8 §05: multiline (line breaks kept), the limit is
    // enforced by rejection rather than cut, and contact details (email,
    // phone, postal address) are refused with a correction message.
    const checked = validateFreeText(val, {
      label: MANUAL_OF_ME_LABELS[key],
      max: MANUAL_OF_ME_MAX_LENGTHS[key],
      multiline: true,
    });
    if (!checked.ok) return { success: false, error: checked.error };
    // Empty after cleaning is stored as null so isManualOfMeEmpty works.
    sanitised[key] = checked.value;
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

  if (error) return { success: false, error: dbErrorFor('update-manual-of-me', error) };

  revalidatePath('/dashboard/profile');
  return { success: true };
}

// Note: MANUAL_OF_ME_FIELDS is intentionally not re-exported from this file
// (it would be a non-async export, rejected by Next.js 16+ at action-invocation
// time — see CLAUDE.md gotcha #18). Callers should import it directly from
// ./manual-of-me-fields.
