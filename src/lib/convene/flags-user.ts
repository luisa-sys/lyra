/**
 * KAN-309 follow-on: per-user Convene gate.
 *
 * Effective rule (env = master kill-switch):
 *   Convene is available to a user IFF  CONVENE_ENABLED  AND  the user is
 *   entitled to the 'convene' feature.
 *
 * Kept in a separate module from the sync, dependency-free isConveneEnabled()
 * (src/lib/convene/flags.ts) so cron/oauth/infra routes that have no user can
 * keep using the env-only check without pulling in the server-only entitlement
 * read (next/headers, service client).
 */
import { isConveneEnabled } from './flags';
import { getMyFeatureEntitlements } from '@/lib/features/entitlements';

/** True only if Convene is enabled in this env AND the current user is entitled. */
export async function isConveneEnabledForCurrentUser(): Promise<boolean> {
  if (!isConveneEnabled()) return false;
  const entitlements = await getMyFeatureEntitlements();
  return entitlements.convene === true;
}
