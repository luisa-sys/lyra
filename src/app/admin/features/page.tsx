/**
 * KAN-408: global feature switches — admin console.
 *
 * Environment-scoped master switches that turn a feature ON/OFF for EVERY user
 * in an environment. This deployment can manage the environments whose switch
 * rows live in its own database: dev/staging manage only themselves; a
 * prod-family console (beta or prod — they share the prod-lyra project) manages
 * BOTH beta and prod. See src/modules/platform/deploy-env.ts.
 *
 * Effective availability of a feature = its env/credential gate AND this switch
 * AND (where relevant) the per-user entitlement. Flipping a switch off here is a
 * kill switch that cannot be overridden per user, and hides the per-user toggle
 * in /admin/users/[slug].
 */

import { getCurrentAdmin, getAdminServiceClient } from '@/modules/admin/admin';
import { getDeployEnv, manageableEnvironments, type DeployEnv } from '@/modules/platform/deploy-env';
import {
  GLOBAL_FEATURE_KEYS,
  GLOBAL_FEATURE_CONFIG,
  resolveGlobalSwitches,
  type GlobalFeatureKey,
} from '@/modules/features/global-features';
import { setGlobalFeature } from './actions';
import ConfirmSubmit from './confirm-submit';

export const dynamic = 'force-dynamic';

const ENV_LABEL: Record<DeployEnv, string> = {
  dev: 'Development',
  staging: 'Staging',
  beta: 'Beta',
  prod: 'Production',
};

async function loadSwitches(
  environments: DeployEnv[],
): Promise<Record<DeployEnv, Record<GlobalFeatureKey, boolean>>> {
  const svc = getAdminServiceClient();
  const { data } = await svc
    .from('global_feature_switches')
    .select('environment, feature_key, enabled')
    .in('environment', environments);
  const rows = (data ?? []) as { environment: string; feature_key: string; enabled: boolean }[];

  const out = {} as Record<DeployEnv, Record<GlobalFeatureKey, boolean>>;
  for (const e of environments) {
    out[e] = resolveGlobalSwitches(rows.filter((r) => r.environment === e));
  }
  return out;
}

export default async function GlobalFeaturesPage() {
  await getCurrentAdmin(); // layout already gated; keep the type honest
  const current = getDeployEnv();
  const environments = manageableEnvironments(current);
  const switches = await loadSwitches(environments);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <header>
        <h1 className="text-2xl font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)]">
          Global features
        </h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          Environment-wide master switches. Turning a feature off here disables it for{' '}
          <span className="font-medium">every</span> user in that environment and hides its
          per-user toggle — it cannot be overridden per user. A switch can only enable a feature
          whose environment prerequisite is also configured.
        </p>
        <p className="text-xs text-[var(--color-muted)] mt-2">
          This console runs on <span className="font-medium">{ENV_LABEL[current]}</span> and can
          manage:{' '}
          {environments.map((e) => ENV_LABEL[e]).join(' · ')}
          {(current === 'prod' || current === 'beta') && (
            <> — beta and production share one database, so both are managed here.</>
          )}
        </p>
      </header>

      {environments.map((e) => (
        <section
          key={e}
          className="p-5 rounded-xl border border-[var(--color-border)] bg-white space-y-1"
        >
          <h2 className="text-base font-medium text-[var(--color-ink)] mb-2">{ENV_LABEL[e]}</h2>
          <div className="divide-y divide-[var(--color-border)]">
            {GLOBAL_FEATURE_KEYS.map((k) => {
              const cfg = GLOBAL_FEATURE_CONFIG[k];
              const on = switches[e][k];
              return (
                <div key={k} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--color-ink)]">
                      <span className="font-medium">{cfg.label}</span>{' '}
                      <span
                        className={
                          'text-xs px-2 py-0.5 rounded-full ' +
                          (on
                            ? 'bg-green-50 text-green-700'
                            : 'bg-red-50 text-red-700')
                        }
                      >
                        {on ? 'on' : 'off'}
                      </span>
                    </p>
                    <p className="text-xs text-[var(--color-muted)]">
                      {cfg.description}
                      {cfg.envPrerequisite ? ` · needs ${cfg.envPrerequisite}` : ''}
                    </p>
                  </div>
                  <form action={setGlobalFeature} className="shrink-0">
                    <input type="hidden" name="environment" value={e} />
                    <input type="hidden" name="featureKey" value={k} />
                    <input type="hidden" name="enabled" value={(!on).toString()} />
                    <ConfirmSubmit
                      confirmMessage={
                        cfg.sensitive
                          ? on
                            ? `Turn OFF “${cfg.label}” for ${ENV_LABEL[e]}? This changes a compliance control for every user in that environment. This action is audited.`
                            : `Turn ON “${cfg.label}” for ${ENV_LABEL[e]}? This re-introduces a provider (Didit) age check — special-category (Art. 9) biometric processing — for every user in that environment. Update the privacy policy and sub-processor register BEFORE enabling in a live environment. This action is audited.`
                          : undefined
                      }
                      className={
                        'text-xs font-medium px-4 py-2 rounded-full transition-colors ' +
                        (on
                          ? 'bg-[#f4efe7] text-red-700 hover:bg-red-50'
                          : 'bg-[var(--color-sage)] text-white hover:opacity-90')
                      }
                    >
                      {on ? 'Turn off' : 'Turn on'}
                    </ConfirmSubmit>
                  </form>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
