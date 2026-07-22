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
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { getDeployEnv, type DeployEnv } from '@/lib/deploy-env';
import {
  resolveGlobalSwitches,
  type GlobalFeatureKey,
} from './global-features';

function serviceClient() {
  return createServiceClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

/**
 * The full switch map for one environment (defaults to the current deploy env).
 * Absent rows resolve to ON; a read error also resolves to the all-ON baseline.
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
