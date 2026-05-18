'use server';

/**
 * KAN-186: server action for the recipient's "Delivery country" field.
 *
 * Why a dedicated action (not just an entry in ALLOWED_PROFILE_FIELDS):
 *   - `updateProfileFields` runs `sanitiseText` on every string value, which
 *     does not uppercase / restrict to ISO-2. Putting delivery_country_code
 *     through the generic path would surface DB check-constraint errors to
 *     the user for any non-canonical input (lowercase, full names, etc).
 *   - This action normalises input via `normaliseDeliveryCountry`, accepts
 *     empty / null to clear the field, and returns a clear UX-friendly error
 *     if the chosen country is not in our supported list.
 *
 * Auth model:
 *   - Authenticated user only.
 *   - The owning profile is resolved server-side from `auth.uid()` — caller
 *     cannot supply a `profile_id`. Same pattern as updateManualOfMe (KAN-154).
 *
 * Pairs with src/lib/affiliate/country-codes.ts (the supported-country
 * allowlist, also used by KAN-187 seed and KAN-194 smoke monitor).
 */

import { createClient } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { type ActionResult } from '@/lib/sanitise';
import { checkProfileWriteRateLimit } from '@/lib/profile-rate-limit';
import { normaliseDeliveryCountry } from '@/lib/affiliate/country-codes';

export async function updateDeliveryCountry(
  input: string | null
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // KAN-231 — profile-save rate limiting.
  const rl = await checkProfileWriteRateLimit(user.id);
  if (!rl.allowed) return rl.result;

  // Normalise: trim, uppercase, restrict to supported allowlist.
  // null / empty after normalisation means "clear the field" — the recommender
  // will then fall back to the buyer's country at query time (KAN-185).
  let normalised: string | null = null;
  if (input !== null && input !== undefined && input !== '') {
    normalised = normaliseDeliveryCountry(input);
    if (normalised === null) {
      return {
        success: false,
        error: `Unsupported delivery country: ${input}. See SUPPORTED_DELIVERY_COUNTRIES.`,
      };
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ delivery_country_code: normalised })
    .eq('user_id', user.id);

  if (error) return { success: false, error: error.message };
  revalidatePath('/dashboard/profile');
  return { success: true };
}
