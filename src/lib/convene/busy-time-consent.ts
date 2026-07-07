/**
 * SEC-58 — WEB busy-time consent gate (defence-in-depth).
 *
 * The SEC-18 opt-in (`profiles.share_availability_with_contacts`) was enforced
 * only in the MCP availability tool (`lyra-mcp-server` — see
 * convene-availability-tool.ts). This module mirrors that gate in the WEB
 * Convene calendar layer so that no WEB caller can disclose another user's
 * calendar busy/free windows without that user's explicit consent.
 *
 * Enforcement is FAIL-CLOSED: anything other than an explicit boolean `true`
 * on the target's `share_availability_with_contacts` (missing profile row,
 * NULL, `false`, or a query error) denies the fetch. This matches the MCP
 * behaviour, where non-consenting/legacy-NULL profiles fall through to
 * "requires manual confirm" and are never fanned out.
 *
 * Reading a user's OWN calendar (viewer === target) is always allowed and does
 * not touch the database.
 *
 * Low exploitability today: no WEB route currently fetches another user's
 * busy-times (the only caller reads the host's own calendar). This lands as
 * defence-in-depth BEFORE any shared-availability WEB surface ships.
 */

import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/** Thrown when the viewer is not permitted to read the target's busy-times. */
export class BusyTimeConsentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusyTimeConsentError';
  }
}

function admin() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

/**
 * Assert that `viewerUserId` is allowed to read `targetUserId`'s calendar
 * busy-times.
 *
 * - viewer === target → allowed (own calendar); no DB round-trip.
 * - viewer !== target → the target must have opted in via
 *   `profiles.share_availability_with_contacts === true`.
 *
 * @throws {BusyTimeConsentError} when consent is absent or unverifiable
 *   (fail-closed).
 */
export async function assertBusyTimeConsent(
  viewerUserId: string,
  targetUserId: string
): Promise<void> {
  if (!targetUserId) {
    throw new BusyTimeConsentError('Missing target user for busy-time consent check');
  }

  // Own calendar — always allowed. No database lookup.
  if (viewerUserId && viewerUserId === targetUserId) return;

  // ownership-ok: single-user consent lookup keyed on the target's user_id (SEC-58)
  const { data, error } = await admin()
    .from('profiles')
    .select('share_availability_with_contacts')
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (error) {
    // Fail closed: never disclose on an unverifiable consent state.
    throw new BusyTimeConsentError(
      `Could not verify availability-sharing consent: ${error.message}`
    );
  }

  if (data?.share_availability_with_contacts !== true) {
    throw new BusyTimeConsentError(
      'Target user has not consented to share calendar availability with contacts'
    );
  }
}
