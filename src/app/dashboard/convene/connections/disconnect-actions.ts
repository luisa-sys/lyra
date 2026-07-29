'use server';

/**
 * SEC-109 — server-side disconnect for Convene OAuth connections.
 *
 * The Disconnect button used to soft-delete `oauth_connections` straight from
 * the browser under the user's own JWT and stop there, so the vaulted Google
 * refresh token stayed live indefinitely after the user asked us to forget it.
 * The connections page promises the opposite ("we'll forget your tokens
 * immediately"), which makes it a consent-withdrawal defect, not just an
 * untidy code path.
 *
 * `disconnectConnection` in `@/lib/convene/oauth-connections` already does the
 * right thing — soft-delete plus `vaultRevokeRefreshToken` — but it runs on a
 * service-role client and deliberately performs NO ownership check (see the
 * `ownership-ok` note on `getConnection`: the caller owns that check). This
 * action is that caller: it authenticates, proves ownership on the user's own
 * RLS-scoped client, and only then hands the id to the repository.
 *
 * Two deliberate choices:
 *
 * - **No suspension guard.** The SEC-57 family gates write paths on
 *   `is_suspended`, but withdrawing consent is not a privileged write — a
 *   suspended user who cannot disconnect is a user whose calendar token we keep
 *   against their wishes. Disconnect stays available to any authenticated owner.
 *
 * - **One generic failure message.** "Not yours", "already gone" and "never
 *   existed" all return the same string, so the action cannot be used to probe
 *   whether a given connection id exists.
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase-server';
import { disconnectConnection } from '@/lib/convene/oauth-connections';

const GENERIC_ERROR = 'Could not disconnect that account';

export async function disconnectOAuthConnection(
  connectionId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof connectionId !== 'string' || connectionId.trim() === '') {
    return { ok: false, error: GENERIC_ERROR };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  // Ownership is proven on the caller's own client (anon key + their JWT) and
  // filtered explicitly on owner_user_id, so the check does not lean on RLS
  // alone. Only after this do we touch the service-role path.
  const { data: owned, error: lookupError } = await supabase
    .from('oauth_connections')
    .select('id')
    .eq('id', connectionId)
    .eq('owner_user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (lookupError) return { ok: false, error: GENERIC_ERROR };
  if (!owned) return { ok: false, error: GENERIC_ERROR };

  try {
    await disconnectConnection(connectionId);
  } catch {
    // disconnectConnection throws only if the soft-delete update fails; the
    // vault revoke inside it is already best-effort and logs on failure.
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath('/dashboard/convene/connections');
  return { ok: true };
}
