import {
  parentCookieDomain,
  withParentCookieDomain,
  PARENT_COOKIE_DOMAIN,
} from '@/lib/cookie-domain';

// SEC-40 (epic SEC-37): the session cookie is scoped to the parent domain
// `.checklyra.com` on EVERY real checklyra.com env (dev/stage/beta/prod) so the
// app host and its sibling admin host (admin-dev.checklyra.com etc.) share one
// session. Cross-ENVIRONMENT isolation is preserved by the Supabase cookie NAME
// (it embeds the project ref). Previews (*.vercel.app) and local (localhost)
// stay host-scoped — a `.checklyra.com` domain wouldn't match those hosts.

const asEnv = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe('parentCookieDomain', () => {
  it('scopes to .checklyra.com on beta (IS_BETA_DEPLOY=true)', () => {
    expect(parentCookieDomain(asEnv({ IS_BETA_DEPLOY: 'true' }))).toBe(PARENT_COOKIE_DOMAIN);
  });

  it('scopes to .checklyra.com on prod (https://checklyra.com)', () => {
    expect(parentCookieDomain(asEnv({ NEXT_PUBLIC_SITE_URL: 'https://checklyra.com' }))).toBe(
      PARENT_COOKIE_DOMAIN,
    );
  });

  it('scopes to .checklyra.com on dev (https://dev.checklyra.com) — SEC-40', () => {
    expect(parentCookieDomain(asEnv({ NEXT_PUBLIC_SITE_URL: 'https://dev.checklyra.com' }))).toBe(
      PARENT_COOKIE_DOMAIN,
    );
  });

  it('scopes to .checklyra.com on stage (https://stage.checklyra.com) — SEC-40', () => {
    expect(parentCookieDomain(asEnv({ NEXT_PUBLIC_SITE_URL: 'https://stage.checklyra.com' }))).toBe(
      PARENT_COOKIE_DOMAIN,
    );
  });

  it('stays host-scoped with no env (unset → PR preview)', () => {
    expect(parentCookieDomain(asEnv({}))).toBeUndefined();
  });

  it('stays host-scoped on a *.vercel.app preview', () => {
    expect(
      parentCookieDomain(asEnv({ NEXT_PUBLIC_SITE_URL: 'https://lyra-abc123.vercel.app' })),
    ).toBeUndefined();
  });

  it('stays host-scoped on localhost', () => {
    expect(
      parentCookieDomain(asEnv({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' })),
    ).toBeUndefined();
  });

  it('does not scope when IS_BETA_DEPLOY is the string "false" and no site url', () => {
    expect(parentCookieDomain(asEnv({ IS_BETA_DEPLOY: 'false' }))).toBeUndefined();
  });

  it('rejects suffix-spoofing hostnames (defensive)', () => {
    expect(
      parentCookieDomain(asEnv({ NEXT_PUBLIC_SITE_URL: 'https://evilchecklyra.com' })),
    ).toBeUndefined();
    expect(
      parentCookieDomain(asEnv({ NEXT_PUBLIC_SITE_URL: 'https://checklyra.com.evil.com' })),
    ).toBeUndefined();
  });

  it('returns undefined for a malformed NEXT_PUBLIC_SITE_URL', () => {
    expect(parentCookieDomain(asEnv({ NEXT_PUBLIC_SITE_URL: 'not a url' }))).toBeUndefined();
  });

  it('beta flag wins even with no NEXT_PUBLIC_SITE_URL (defensive short-circuit)', () => {
    expect(
      parentCookieDomain(asEnv({ IS_BETA_DEPLOY: 'true', NEXT_PUBLIC_SITE_URL: '' })),
    ).toBe(PARENT_COOKIE_DOMAIN);
  });
});

describe('withParentCookieDomain', () => {
  it('adds domain on a checklyra.com env, preserving existing options', () => {
    expect(
      withParentCookieDomain(
        { path: '/', sameSite: 'lax', secure: true },
        asEnv({ NEXT_PUBLIC_SITE_URL: 'https://dev.checklyra.com' }),
      ),
    ).toEqual({ path: '/', sameSite: 'lax', secure: true, domain: PARENT_COOKIE_DOMAIN });
  });

  it('returns the options untouched (no domain) on preview/local', () => {
    const opts = { path: '/', sameSite: 'lax', secure: true };
    const out = withParentCookieDomain(
      opts,
      asEnv({ NEXT_PUBLIC_SITE_URL: 'https://lyra-x.vercel.app' }),
    );
    expect(out).toEqual(opts);
    expect('domain' in out).toBe(false);
  });
});
