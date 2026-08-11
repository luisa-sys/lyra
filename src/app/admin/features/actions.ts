'use server';

/**
 * KAN-408: set an environment-scoped GLOBAL feature switch from the admin
 * console. Mirrors setFeatureEntitlement (src/app/admin/users/actions.ts):
 *   1. Re-check admin (never trust the client).
 *   2. Validate feature_key against the global registry + environment against
 *      the environments THIS deployment may manage (its own DB; beta+prod share
 *      the prod-lyra project, so a prod-family console manages both).
 *   3. Audit-first: one moderation_logs row (environment in metadata), abort if
 *      it fails.
 *   4. Service-role upsert (passes the admin-only self-write trigger), stamping
 *      updated_by.
 */

import { revalidatePath } from 'next/cache';
import { getCurrentAdmin, getAdminServiceClient, logModerationAction } from '@/lib/admin';
import { isGlobalFeatureKey } from '@/modules/features/global-features';
import { isDeployEnv, manageableEnvironments } from '@/modules/platform/deploy-env';

export async function setGlobalFeature(formData: FormData): Promise<void> {
  const admin = await getCurrentAdmin();
  if (!admin) {
    throw new Error('Not authorised');
  }

  const environment = String(formData.get('environment') ?? '').trim();
  const featureKey = String(formData.get('featureKey') ?? '').trim();
  const enabled = String(formData.get('enabled') ?? '') === 'true';

  if (!isGlobalFeatureKey(featureKey)) {
    throw new Error('Invalid feature key');
  }
  // The environment must be one this deployment can actually write to. This
  // blocks a forged form trying to flip, say, 'prod' from the dev console
  // (whose service key can't reach the prod DB anyway) — fail loudly instead.
  if (!isDeployEnv(environment) || !manageableEnvironments().includes(environment)) {
    throw new Error('Environment not manageable from this deployment');
  }

  await logModerationAction({
    admin,
    action: enabled ? 'enable_global_feature' : 'disable_global_feature',
    metadata: { feature_key: featureKey, environment },
  });

  const svc = getAdminServiceClient();
  const { error } = await svc.from('global_feature_switches').upsert(
    {
      environment,
      feature_key: featureKey,
      enabled,
      updated_by: admin.profileId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'environment,feature_key' },
  );
  if (error) {
    throw new Error(`Could not update global feature switch: ${error.message}`);
  }

  revalidatePath('/admin/features');
}
