/**
 * SEC-57: account-standing check for credential-issuance paths.
 *
 * A suspended/moderated user must not be able to mint NEW MCP credentials —
 * neither an API key (dashboard settings) nor an OAuth authorization code
 * (the /oauth/authorize consent flow). Suspension was previously forward-looking
 * only at the middleware layer (KAN-319), which redirects a suspended user to
 * /suspended on navigation but *fails open* on a lookup error (by design — that
 * gate governs ALL authenticated navigation and must not lock out the whole
 * userbase on a transient profiles read).
 *
 * This helper is the narrow, security-sensitive counterpart used at the exact
 * points where a credential is minted. Because its blast radius is a single
 * mint (a false refusal costs one retried key generation; a false allow hands a
 * suspended account live credentials), the issuance paths fail CLOSED: they
 * refuse unless the account is positively confirmed to be in good standing.
 *
 * The tri-state return lets each caller choose its own posture:
 *   - the mint paths refuse on anything other than 'ok' (fail closed);
 *   - the consent-screen render redirects only on a confirmed 'suspended', so a
 *     transient error never shows a good-standing user a misleading
 *     "account suspended" page (the mint in submitConsent still fails closed).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type AccountStanding = 'ok' | 'suspended' | 'unknown';

/**
 * Look up the account standing for the given authenticated user id.
 *
 * `unknown` means we could not positively determine standing (lookup error or
 * no profile row) — callers minting a credential MUST treat it like 'suspended'.
 */
export async function getAccountStanding(
  supabase: SupabaseClient,
  userId: string,
): Promise<AccountStanding> {
  const { data, error } = await supabase
    .from('profiles')
    .select('is_suspended')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    // Never fail silently, and never fall through to a permissive default on a
    // credential path — surface it and let the caller fail closed.
    console.error('[account-status] suspension lookup failed (treating as unknown):', error.message);
    return 'unknown';
  }
  if (!data) {
    // Every user has a profile (handle_new_user trigger) by the time they can
    // reach settings or the OAuth flow, so a missing row is anomalous — treat
    // it as unknown rather than assuming good standing.
    console.error('[account-status] no profile row for user (treating as unknown):', userId);
    return 'unknown';
  }
  return data.is_suspended === true ? 'suspended' : 'ok';
}

/**
 * Fail-closed predicate for credential-issuance paths: refuse unless the account
 * is positively in good standing. `suspended` and `unknown` both refuse.
 */
export function shouldRefuseIssuance(standing: AccountStanding): boolean {
  return standing !== 'ok';
}
