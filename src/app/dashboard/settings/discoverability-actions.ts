'use server';

/**
 * KAN-153: opt-in phone/postcode discoverability server actions.
 *
 * Three actions:
 *
 *   1. setDiscoverability({ phone?, postcode?, phoneValue?, postcodeValue? })
 *      - Flips the discoverable_by_* flag on the user's profile.
 *      - When a flag flips ON, the caller MUST also supply the corresponding
 *        plaintext value (phoneValue / postcodeValue); we hash it and store
 *        only the hash. The plaintext never lives past this function's scope.
 *      - When a flag flips OFF, the corresponding hash is cleared (NULL).
 *
 *   2. searchByPhone(phone: string)
 *      - Normalises + hashes input; calls the SECURITY DEFINER RPC
 *        `search_by_contact_hash`. Rate-limited per authenticated user.
 *
 *   3. searchByPostcode(postcode: string)
 *      - Same as above for postcode.
 *
 * Privacy invariants (enforced here, also enforced by the DB):
 *   - Plaintext phone/postcode is never logged, never returned in error
 *     strings, never persisted.
 *   - Failed lookups return generic "no matches" rather than distinguishing
 *     "wrong value" from "value exists but profile opted out".
 *   - Search hashes ARE NOT exposed to the caller in either success or
 *     failure paths.
 *
 * `'use server'` constraint: every export must be an async function. Pure
 * helpers (hashContact, normalisePhone, etc.) live in
 * ./discoverability-helpers.ts. See BUGS-12 and
 * scripts/check-server-action-exports.sh.
 */
import { createClient } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/sanitise';
import { rateLimit } from '@/lib/rate-limit';
import {
  hashPhoneInput,
  hashPostcodeInput,
  SEARCH_RATE_LIMIT,
} from './discoverability-helpers';
import { getMyFeatureEntitlements } from '@/lib/features/entitlements';

interface DiscoverabilityInput {
  phone?: boolean;
  postcode?: boolean;
  /** Required when phone flips from false → true. Ignored otherwise. */
  phoneValue?: string;
  /** Required when postcode flips from false → true. Ignored otherwise. */
  postcodeValue?: string;
}

export async function setDiscoverability(input: DiscoverabilityInput): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  // KAN-309 — per-user feature gate (default on; an admin can revoke). Opting
  // OUT is always allowed so a revoked user can still turn discovery off.
  if (input.phone === true || input.postcode === true) {
    const features = await getMyFeatureEntitlements();
    if (!features.discovery) {
      return { success: false, error: 'Discovery is not enabled for your account.' };
    }
  }

  // Read the current flags so we know which transitions to perform. We do
  // NOT read the hash columns (they are revoked from `authenticated` at
  // column-privilege level — see migration).
  const { data: profile, error: readError } = await supabase
    .from('profiles')
    .select('id, discoverable_by_phone, discoverable_by_postcode')
    .eq('user_id', user.id)
    .single();
  if (readError || !profile) {
    return { success: false, error: 'Profile not found' };
  }

  const updates: Record<string, string | boolean | null> = {};

  // ── Phone ────────────────────────────────────────────────
  if (typeof input.phone === 'boolean') {
    if (input.phone === true) {
      // Opting in — must provide a phone value to hash.
      if (!input.phoneValue || typeof input.phoneValue !== 'string') {
        return {
          success: false,
          error: 'A phone number is required to enable phone discovery.',
        };
      }
      const hash = hashPhoneInput(input.phoneValue);
      if (!hash) {
        // Never echo the input back.
        return {
          success: false,
          error: 'Phone number could not be normalised. Use an international format like +44 7… .',
        };
      }
      updates.discoverable_by_phone = true;
      updates.phone_search_hash = hash;
    } else {
      // Opting out — clear the hash.
      updates.discoverable_by_phone = false;
      updates.phone_search_hash = null;
    }
  }

  // ── Postcode ────────────────────────────────────────────
  if (typeof input.postcode === 'boolean') {
    if (input.postcode === true) {
      if (!input.postcodeValue || typeof input.postcodeValue !== 'string') {
        return {
          success: false,
          error: 'A postcode is required to enable postcode discovery.',
        };
      }
      const hash = hashPostcodeInput(input.postcodeValue);
      if (!hash) {
        return {
          success: false,
          error: 'Postcode could not be normalised. Use a UK format like SW1A 1AA.',
        };
      }
      updates.discoverable_by_postcode = true;
      updates.postcode_search_hash = hash;
    } else {
      updates.discoverable_by_postcode = false;
      updates.postcode_search_hash = null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return { success: true };
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update(updates)
    .eq('user_id', user.id);

  if (updateError) {
    // Do NOT propagate the raw DB error — it could contain the hash. Return
    // a generic message and let the caller log via Sentry on the server.
    return { success: false, error: 'Could not update discoverability settings.' };
  }

  revalidatePath('/dashboard/settings');
  return { success: true };
}

/**
 * Read-only: returns the current flags so the UI can populate the toggle
 * state without trying (and failing) to SELECT the hash columns. The hash
 * itself is never returned.
 */
export async function getDiscoverability(): Promise<
  | { success: true; phone: boolean; postcode: boolean }
  | { success: false; error: string }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('profiles')
    .select('discoverable_by_phone, discoverable_by_postcode')
    .eq('user_id', user.id)
    .single();
  if (error || !data) return { success: false, error: 'Profile not found' };

  return {
    success: true,
    phone: !!data.discoverable_by_phone,
    postcode: !!data.discoverable_by_postcode,
  };
}

/**
 * Shape returned by search actions. We deliberately do NOT distinguish
 * "no matches because the value doesn't exist" from "no matches because
 * the matching user opted out" — both return `matches: []`.
 */
type SearchResult =
  | { success: true; matches: Array<{ id: string; slug: string }> }
  | { success: false; error: string };

async function performHashedSearch(
  kind: 'phone' | 'postcode',
  hash: string,
  userId: string
): Promise<SearchResult> {
  // Rate-limit per authenticated user (10 per hour). Anonymous lookups are
  // not supported by this endpoint.
  const rl = rateLimit(`discoverability-search:${userId}`, SEARCH_RATE_LIMIT);
  if (rl.limited) {
    return {
      success: false,
      error: `Too many lookups. Try again in ${rl.retryAfter ?? 60} seconds.`,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('search_by_contact_hash', {
    p_kind: kind,
    p_hash: hash,
  });

  if (error) {
    // Same generic-error rule as setDiscoverability — never include the hash.
    return { success: false, error: 'Search failed. Please try again.' };
  }

  const matches = (data ?? []) as Array<{ id: string; slug: string }>;
  return { success: true, matches };
}

export async function searchByPhone(phone: string): Promise<SearchResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const hash = hashPhoneInput(phone);
  if (!hash) {
    // Return the generic empty-match result, NOT a validation error,
    // so the response is indistinguishable from a normalised-but-unknown
    // value. (We could 400 here, but that leaks "your input is malformed"
    // vs "your input is unknown".)
    return { success: true, matches: [] };
  }

  return performHashedSearch('phone', hash, user.id);
}

export async function searchByPostcode(postcode: string): Promise<SearchResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const hash = hashPostcodeInput(postcode);
  if (!hash) {
    return { success: true, matches: [] };
  }

  return performHashedSearch('postcode', hash, user.id);
}
