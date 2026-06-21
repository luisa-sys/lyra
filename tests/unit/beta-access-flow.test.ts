import { betaRedirectUrl, isProdDeploy } from '@/lib/beta-access/flow';

const asEnv = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

// KAN-278: where a user lands after sign-in.
describe('betaRedirectUrl', () => {
  it('prod + approved -> beta dashboard', () => {
    expect(
      betaRedirectUrl({ origin: 'https://checklyra.com', isProd: true, approved: true, next: '/dashboard' }),
    ).toBe('https://beta.checklyra.com/dashboard');
  });

  it('prod + not approved -> beta waitlist', () => {
    expect(
      betaRedirectUrl({ origin: 'https://checklyra.com', isProd: true, approved: false, next: '/dashboard' }),
    ).toBe('https://beta.checklyra.com/waitlist');
  });

  it('prod preserves a safe nested next path', () => {
    expect(
      betaRedirectUrl({ origin: 'https://checklyra.com', isProd: true, approved: true, next: '/dashboard/profile' }),
    ).toBe('https://beta.checklyra.com/dashboard/profile');
  });

  it('non-prod (beta/dev) stays on the same origin', () => {
    expect(
      betaRedirectUrl({ origin: 'https://beta.checklyra.com', isProd: false, approved: false, next: '/dashboard' }),
    ).toBe('https://beta.checklyra.com/dashboard');
    expect(
      betaRedirectUrl({ origin: 'https://dev.checklyra.com', isProd: false, approved: true, next: '/dashboard' }),
    ).toBe('https://dev.checklyra.com/dashboard');
  });

  it('rejects open-redirect next values (protocol-relative / absolute / userinfo / backslash)', () => {
    // SEC-19/F-12 — all must fall back to the safe default, never an off-site host.
    for (const next of ['//evil.com', 'https://evil.com', '@evil.com', '/\\evil.com']) {
      expect(
        betaRedirectUrl({ origin: 'https://checklyra.com', isProd: true, approved: true, next }),
      ).toBe('https://beta.checklyra.com/dashboard');
    }
    // A genuine relative path is still honoured.
    expect(
      betaRedirectUrl({ origin: 'https://checklyra.com', isProd: true, approved: true, next: '/dashboard/profile' }),
    ).toBe('https://beta.checklyra.com/dashboard/profile');
  });

  it('rejects backslash and userinfo open-redirect tricks (SEC-07)', () => {
    // `/\evil.com` and `/\/evil.com` start with a single "/" so a naive guard
    // would let them through; some browsers normalise "\" to "/" → "//evil.com".
    // `@evil.com` / `.evil.com` would escape the origin via `${origin}${next}`.
    for (const evil of ['/\\evil.com', '/\\/evil.com', '@evil.com', '.evil.com', '\\evil.com']) {
      expect(
        betaRedirectUrl({ origin: 'https://checklyra.com', isProd: true, approved: true, next: evil }),
      ).toBe('https://beta.checklyra.com/dashboard');
    }
  });
});

// KAN-278: only the real production deploy hops users to beta.
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
