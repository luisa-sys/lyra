import {
  parentCookieDomain,
  withParentCookieDomain,
  PARENT_COOKIE_DOMAIN,
} from '@/lib/cookie-domain';

// KAN-274 (epic KAN-273): the session cookie is scoped to the parent domain
// `.checklyra.com` ONLY on prod + beta, so a checklyra.com session carries over
// to beta.checklyra.com. dev/stage MUST stay host-scoped (different Supabase
// projects), so their sessions can never be read cross-environment.

const asEnv = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe('parentCookieDomain', () => {
  it('scopes to .checklyra.com on beta (IS_BETA_DEPLOY=true)', () => {
    expect(parentCookieDomain(asEnv({ IS_BETA_DEPLOY: 'true' }))).toBe(PARENT_COOKIE_DOMAIN);
  });

  it('scopes to .checklyra.com on prod (NEXT_PUBLIC_SITE_URL=https://checklyra.com)', () => {
    expect(parentCookieDomain(asEnv({ NEXT_PUBLIC_SITE_URL: 'https://checklyra.com' }))).toBe(
      PARENT_COOKIE_DOMAIN,
    );
  });

  it('stays host-scoped on dev (dev.checklyra.com)', () => {
    expect(
      parentCookieDomain(asEnv({ NEXT_PUBLIC_SITE_URL: 'https://dev.checklyra.com' })),
    ).toBeUndefined();
  });

  it('stays host-scoped on stage (stage.checklyra.com)', () => {
    expect(
      parentCookieDomain(asEnv({ NEXT_PUBLIC_SITE_URL: 'https://stage.checklyra.com' })),
    ).toBeUndefined();
  });

  it('stays host-scoped with no env (local/preview)', () => {
    expect(parentCookieDomain(asEnv({}))).toBeUndefined();
  });

  it('beta flag wins even if the site url looks like dev (defensive)', () => {
    expect(
      parentCookieDomain(
        asEnv({ IS_BETA_DEPLOY: 'true', NEXT_PUBLIC_SITE_URL: 'https://dev.checklyra.com' }),
      ),
    ).toBe(PARENT_COOKIE_DOMAIN);
  });

  it('does not scope when IS_BETA_DEPLOY is the string "false"', () => {
    expect(parentCookieDomain(asEnv({ IS_BETA_DEPLOY: 'false' }))).toBeUndefined();
  });
});

describe('withParentCookieDomain', () => {
  it('adds domain on prod/beta, preserving existing options', () => {
    expect(
      withParentCookieDomain({ path: '/', sameSite: 'lax', secure: true }, asEnv({ IS_BETA_DEPLOY: 'true' })),
    ).toEqual({ path: '/', sameSite: 'lax', secure: true, domain: PARENT_COOKIE_DOMAIN });
  });

  it('returns the options untouched (no domain) on dev/stage', () => {
    const opts = { path: '/', sameSite: 'lax', secure: true };
    const out = withParentCookieDomain(opts, asEnv({ NEXT_PUBLIC_SITE_URL: 'https://dev.checklyra.com' }));
    expect(out).toEqual(opts);
    expect('domain' in out).toBe(false);
  });
});
