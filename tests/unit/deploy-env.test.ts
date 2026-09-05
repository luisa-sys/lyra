/**
 * KAN-408: canonical deploy-environment resolver.
 */
import {
  getDeployEnv,
  manageableEnvironments,
  isDeployEnv,
  DEPLOY_ENVS,
} from '@/modules/platform/deploy-env';

function envOf(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv;
}

describe('getDeployEnv (KAN-408)', () => {
  it('resolves beta FIRST — IS_BETA_DEPLOY wins even with prod site + VERCEL_ENV', () => {
    expect(
      getDeployEnv(
        envOf({
          IS_BETA_DEPLOY: 'true',
          NEXT_PUBLIC_SITE_URL: 'https://checklyra.com',
          VERCEL_ENV: 'production',
        }),
      ),
    ).toBe('beta');
  });

  it('resolves prod only with checklyra.com AND VERCEL_ENV=production', () => {
    expect(
      getDeployEnv(envOf({ NEXT_PUBLIC_SITE_URL: 'https://checklyra.com', VERCEL_ENV: 'production' })),
    ).toBe('prod');
  });

  it('does NOT resolve prod when VERCEL_ENV is not production (preview on prod URL)', () => {
    expect(
      getDeployEnv(envOf({ NEXT_PUBLIC_SITE_URL: 'https://checklyra.com', VERCEL_ENV: 'preview' })),
    ).toBe('dev');
  });

  it('resolves staging from the stage site origin', () => {
    expect(getDeployEnv(envOf({ NEXT_PUBLIC_SITE_URL: 'https://stage.checklyra.com' }))).toBe(
      'staging',
    );
  });

  it('resolves dev from the dev site origin', () => {
    expect(getDeployEnv(envOf({ NEXT_PUBLIC_SITE_URL: 'https://dev.checklyra.com' }))).toBe('dev');
  });

  it('fails safe to dev for local/unknown (never prod)', () => {
    expect(getDeployEnv(envOf({}))).toBe('dev');
    expect(getDeployEnv(envOf({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' }))).toBe('dev');
    expect(getDeployEnv(envOf({ VERCEL_ENV: 'production' }))).toBe('dev'); // no site url
  });
});

describe('manageableEnvironments (KAN-408)', () => {
  it('prod and beta each manage BOTH prod and beta (shared prod-lyra DB)', () => {
    expect(manageableEnvironments('prod').sort()).toEqual(['beta', 'prod']);
    expect(manageableEnvironments('beta').sort()).toEqual(['beta', 'prod']);
  });

  it('dev and staging manage only themselves (own DB)', () => {
    expect(manageableEnvironments('dev')).toEqual(['dev']);
    expect(manageableEnvironments('staging')).toEqual(['staging']);
  });
});

describe('isDeployEnv (KAN-408)', () => {
  it('accepts the four real envs and rejects anything else', () => {
    for (const e of DEPLOY_ENVS) expect(isDeployEnv(e)).toBe(true);
    expect(isDeployEnv('prod ')).toBe(false);
    expect(isDeployEnv('production')).toBe(false);
    expect(isDeployEnv('')).toBe(false);
    expect(isDeployEnv('local')).toBe(false);
  });
});
