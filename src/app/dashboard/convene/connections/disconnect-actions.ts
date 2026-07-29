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
 * - **Suspension guard, on the softer of the two SEC-57 postures** (owner
 *   decision, 2026-07-29). `account-status.ts` documents two: credential-mint
 *   paths refuse on anything other than `ok` (fail closed), while the consent
 *   screen acts only on a *confirmed* `suspended`. Disconnect uses the latter.
 *   Refusing on `unknown` would let a transient `profiles` read error block a
 *   user from withdrawing consent, and consent withdrawal is not a credential
 *   mint — the blast radius of a false allow here is a token being deleted
 *   slightly too readily, which is the safe direction to fail.
 *
 * - **One generic failure message for the connection itself.** "Not yours",
 *   "already gone" and "never existed" all return the same string, so the
 *   action cannot be used to probe whether a given connection id exists. The
 *   suspension refusal is distinct, because it describes the caller's own
 *   account and leaks nothing about anyone else's data.
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase-server';
import { getAccountStanding } from '@/lib/account-status';
import { disconnectConnection } from '@/lib/convene/oauth-connections';

const GENERIC_ERROR = 'Could not disconnect that account';
const SUSPENDED_ERROR = 'Your account is suspended, so this connection cannot be changed right now';

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

  // SEC-57 family. Only a positively confirmed suspension refuses; `unknown`
  // falls through so a transient lookup error cannot trap a user's token.
  if ((await getAccountStanding(supabase, user.id)) === 'suspended') {
    return { ok: false, error: SUSPENDED_ERROR };
  }

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
