/**
 * KAN-408: service-role reads of the global (environment-scoped) feature
 * switches (no next/headers), plus the composed availability gate.
 *
 * Kept separate from the pure registry (global-features.ts) so gate call sites
 * and the affiliate/service-role code paths can check a switch without pulling
 * request-scoped APIs into their module graph — mirrors entitlements-service.ts.
 *
 * SERVICE-ROLE — bypasses RLS. The switch table is world-readable (flags aren't
 * secret), but reading via the service client keeps the code path uniform with
 * the rest of the feature machinery and avoids a cookie-client dependency in
 * infra gates.
 *
 * Fail-safe on read error: DEFAULT-ON. A transient DB hiccup must not silently
 * disable a live feature for a whole environment; the existing env/credential
 * gates remain the hard, fail-closed layer. (An admin-driven OFF is a written
 * row, which we DO honour.)
 */
import { createServiceRoleClient } from '@/modules/platform/supabase-service';
import { getDeployEnv, type DeployEnv } from '@/modules/platform/deploy-env';
import {
  resolveGlobalSwitches,
  type GlobalFeatureKey,
} from './global-features';

function serviceClient() {
  // KAN-352: route through the one hardened service-role factory (bakes in
  // persistSession:false + autoRefreshToken:false — a superset of the prior
  // inline options, so behaviour is unchanged).
  return createServiceRoleClient();
}

/**
 * The full switch map for one environment (defaults to the current deploy env).
 *
 * An absent row resolves to that key's `defaultEnabled`, which is **per key**,
 * not a blanket ON — see GLOBAL_FEATURE_CONFIG. Most default ON; the exception
 * is `age_verification`, which defaults **OFF** because the KAN-407 baseline is
 * an 18+ self-declaration and the provider check is opt-in. A read error
 * resolves to the same per-key defaults.
 *
 * This docstring used to say "Absent rows resolve to ON", which is wrong for
 * exactly the one key where it matters. It cost real time during the SEC-112
 * investigation: it made the prod age gate look like it might be ON (there is
 * no `age_verification` row on any environment), which would have made a latent
 * bypass read as a live one.
 */
export async function getGlobalSwitches(
  environment: DeployEnv = getDeployEnv(),
): Promise<Record<GlobalFeatureKey, boolean>> {
  try {
    const svc = serviceClient();
    const { data, error } = await svc
      .from('global_feature_switches')
      .select('feature_key, enabled')
      .eq('environment', environment);
    if (error) {
      console.error('[global-switches] read failed (defaulting ON):', error.message);
      return resolveGlobalSwitches([]);
    }
    return resolveGlobalSwitches(data ?? []);
  } catch (e) {
    console.error('[global-switches] read threw (defaulting ON):', e);
    return resolveGlobalSwitches([]);
  }
}

/**
 * Is `key` enabled at the global level in this environment? Default ON. This is
 * ONE factor of the effective gate — call sites still AND it with their existing
 * env/credential gate and (where relevant) the per-user entitlement.
 */
export async function isFeatureGloballyEnabled(
  key: GlobalFeatureKey,
  environment: DeployEnv = getDeployEnv(),
): Promise<boolean> {
  return (await getGlobalSwitches(environment))[key];
}
