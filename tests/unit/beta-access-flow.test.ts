import { betaRedirectUrl, isProdDeploy, isProdFamily } from '@/lib/beta-access/flow';

const asEnv = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

// KAN-326: where a user lands after sign-in — routed by access tier on the prod family.
describe('betaRedirectUrl', () => {
  // --- prod family: live users route to their own tier's site ---
  it('prod family + live + prod tier -> production site', () => {
    expect(
      betaRedirectUrl({
        origin: 'https://checklyra.com',
        isProdFamily: true,
        userStatus: 'live',
        accessTier: 'prod',
        next: '/dashboard',
      }),
    ).toBe('https://checklyra.com/dashboard');
  });

  it('prod family + live + beta tier -> beta site', () => {
    expect(
      betaRedirectUrl({
        origin: 'https://checklyra.com',
        isProdFamily: true,
        userStatus: 'live',
        accessTier: 'beta',
        next: '/dashboard',
      }),
    ).toBe('https://beta.checklyra.com/dashboard');
  });

  it('prod family + not-live -> beta waitlist (regardless of tier)', () => {
    for (const userStatus of ['waitlist', 'not_applied'] as const) {
      for (const accessTier of ['beta', 'prod'] as const) {
        expect(
          betaRedirectUrl({
            origin: 'https://checklyra.com',
            isProdFamily: true,
            userStatus,
            accessTier,
            next: '/dashboard',
          }),
        ).toBe('https://beta.checklyra.com/waitlist');
      }
    }
  });

  it('prod family preserves a safe nested next path on the resolved tier host', () => {
    expect(
      betaRedirectUrl({
        origin: 'https://checklyra.com',
        isProdFamily: true,
        userStatus: 'live',
        accessTier: 'prod',
        next: '/dashboard/profile',
      }),
    ).toBe('https://checklyra.com/dashboard/profile');
    expect(
      betaRedirectUrl({
        origin: 'https://beta.checklyra.com',
        isProdFamily: true,
        userStatus: 'live',
        accessTier: 'beta',
        next: '/dashboard/profile',
      }),
    ).toBe('https://beta.checklyra.com/dashboard/profile');
  });

  // --- dev/stage: single full env, stay on the origin ---
  it('non-prod-family (dev/stage) stays on the same origin', () => {
    expect(
      betaRedirectUrl({
        origin: 'https://beta.checklyra.com',
        isProdFamily: false,
        userStatus: 'waitlist',
        accessTier: 'beta',
        next: '/dashboard',
      }),
    ).toBe('https://beta.checklyra.com/dashboard');
    expect(
      betaRedirectUrl({
        origin: 'https://dev.checklyra.com',
        isProdFamily: false,
        userStatus: 'live',
        accessTier: 'prod',
        next: '/dashboard',
      }),
    ).toBe('https://dev.checklyra.com/dashboard');
  });

  // --- open-redirect safety preserved (SEC-07 + SEC-19/F-12) ---
  it('rejects open-redirect next values -> safe /dashboard on the resolved host', () => {
    // SEC-19/F-12 — all must fall back to the safe default, never an off-site host.
    for (const next of [
      '//evil.com',
      'https://evil.com',
      '@evil.com',
      '/\\evil.com',
      '/\\/evil.com',
      '.evil.com',
      '\\evil.com',
    ]) {
      // prod tier -> production host, never the off-site host
      expect(
        betaRedirectUrl({
          origin: 'https://checklyra.com',
          isProdFamily: true,
          userStatus: 'live',
          accessTier: 'prod',
          next,
        }),
      ).toBe('https://checklyra.com/dashboard');
      // dev/stage -> origin, never the off-site host
      expect(
        betaRedirectUrl({
          origin: 'https://dev.checklyra.com',
          isProdFamily: false,
          userStatus: 'live',
          accessTier: 'beta',
          next,
        }),
      ).toBe('https://dev.checklyra.com/dashboard');
    }
    // A genuine relative path is still honoured (beta tier).
    expect(
      betaRedirectUrl({
        origin: 'https://checklyra.com',
        isProdFamily: true,
        userStatus: 'live',
        accessTier: 'beta',
        next: '/dashboard/profile',
      }),
    ).toBe('https://beta.checklyra.com/dashboard/profile');
  });
});

// KAN-278: only the real production deploy is "prod".
describe('isProdDeploy', () => {
  it('true only on prod URL + VERCEL_ENV=production', () => {
    expect(isProdDeploy(asEnv({ NEXT_PUBLIC_SITE_URL: 'https://checklyra.com', VERCEL_ENV: 'production' }))).toBe(true);
  });

  it('false on beta (different site url)', () => {
    expect(
      isProdDeploy(asEnv({ NEXT_PUBLIC_SITE_URL: 'https://beta.checklyra.com', VERCEL_ENV: 'production', IS_BETA_DEPLOY: 'true' })),
    ).toBe(false);
  });

  it('false on local (prod url default but no VERCEL_ENV)', () => {
    expect(isProdDeploy(asEnv({ NEXT_PUBLIC_SITE_URL: 'https://checklyra.com' }))).toBe(false);
  });

  it('false on dev', () => {
    expect(isProdDeploy(asEnv({ NEXT_PUBLIC_SITE_URL: 'https://dev.checklyra.com', VERCEL_ENV: 'preview' }))).toBe(false);
  });
});

// KAN-326: the "prod family" = real production OR the beta deploy (shared Supabase + .checklyra.com cookie).
describe('isProdFamily', () => {
  it('true on real production', () => {
    expect(isProdFamily(asEnv({ NEXT_PUBLIC_SITE_URL: 'https://checklyra.com', VERCEL_ENV: 'production' }))).toBe(true);
  });

  it('true on the beta deploy', () => {
    expect(
      isProdFamily(asEnv({ NEXT_PUBLIC_SITE_URL: 'https://beta.checklyra.com', VERCEL_ENV: 'production', IS_BETA_DEPLOY: 'true' })),
    ).toBe(true);
  });

  it('false on dev', () => {
    expect(isProdFamily(asEnv({ NEXT_PUBLIC_SITE_URL: 'https://dev.checklyra.com', VERCEL_ENV: 'preview' }))).toBe(false);
  });

  it('false on stage', () => {
    expect(isProdFamily(asEnv({ NEXT_PUBLIC_SITE_URL: 'https://stage.checklyra.com', VERCEL_ENV: 'preview' }))).toBe(false);
  });
});
