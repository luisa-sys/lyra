/**
 * KAN-408: canonical deploy-environment resolver.
 *
 * Until now there was no single "which environment am I running in" helper —
 * the answer was inferred ad hoc from VERCEL_ENV / NEXT_PUBLIC_SITE_URL /
 * IS_BETA_DEPLOY in ~6 places (middleware `deployTier`, beta-access/flow
 * `isProdDeploy`, the robots gate in layout, the health route, cookie-domain,
 * and the Sentry env tag). The environment-scoped global feature switches
 * (KAN-408) need ONE authoritative value to key on, across all four real
 * deploy targets, so this module centralises the derivation.
 *
 * Why beta vs prod must be distinguished: they SHARE the prod-lyra Supabase
 * project (CLAUDE.md gotcha #19) and are separated ONLY by IS_BETA_DEPLOY=true
 * on the beta Vercel deployment. The switch table is therefore keyed
 * (environment, feature_key), and this resolver decides which environment's
 * rows a running deployment reads and writes.
 *
 * Pure (env-in, value-out) so it is directly unit-testable without globals.
 */

export type DeployEnv = 'dev' | 'staging' | 'beta' | 'prod';

export const DEPLOY_ENVS: readonly DeployEnv[] = ['dev', 'staging', 'beta', 'prod'] as const;

export function isDeployEnv(value: string): value is DeployEnv {
  return (DEPLOY_ENVS as readonly string[]).includes(value);
}

/**
 * Resolve the current deploy environment.
 *
 * Order matters:
 *   1. Beta FIRST — a beta deploy runs on the *production* Vercel env and the
 *      prod-lyra Supabase project, so `IS_BETA_DEPLOY=true` is the only signal
 *      that separates it from prod (mirrors beta-access/flow.ts:77-79).
 *   2. Prod — the real production deploy (checklyra.com + VERCEL_ENV=production;
 *      mirrors isProdDeploy at beta-access/flow.ts:67-69). The admin console
 *      (admin.checklyra.com) is served by this same prod deployment, so it too
 *      resolves to 'prod'.
 *   3. Staging / dev — keyed off the public site origin (set per env in Vercel).
 *
 * Fail-safe default: anything unrecognised (local dev, an ad-hoc preview, a
 * misconfigured env) resolves to 'dev' — the least-privileged target. An
 * unknown deploy must NEVER be mistaken for 'prod'.
 */
export function getDeployEnv(e: NodeJS.ProcessEnv = process.env): DeployEnv {
  if (e.IS_BETA_DEPLOY === 'true') return 'beta';

  const site = e.NEXT_PUBLIC_SITE_URL ?? '';
  if (site === 'https://checklyra.com' && e.VERCEL_ENV === 'production') return 'prod';
  if (site === 'https://stage.checklyra.com') return 'staging';
  if (site === 'https://dev.checklyra.com') return 'dev';

  return 'dev';
}

/**
 * The set of environments whose switch rows live in the SAME database as the
 * current deploy — i.e. the environments an admin console on this deployment
 * can manage. Beta and prod co-tenant the prod-lyra project, so the prod-family
 * admin console manages both; dev and staging are single-tenant, so each
 * manages only itself.
 *
 * This is what lets one admin console offer "switch this feature per
 * environment" without cross-project service keys (KAN-408 design decision).
 */
export function manageableEnvironments(current: DeployEnv = getDeployEnv()): DeployEnv[] {
  if (current === 'prod' || current === 'beta') return ['prod', 'beta'];
  return [current];
}
