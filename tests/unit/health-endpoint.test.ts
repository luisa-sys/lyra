/**
 * KAN-175: health endpoint contract tests.
 *
 * The endpoint at /api/__health__ is exposed for CI smoke checks. Tests
 * here assert the response shape (so deploy workflows can rely on it)
 * and that no secrets sneak in.
 */

describe('GET /api/__health__', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('returns ok=true with the expected fields', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://beta.checklyra.com';
    process.env.IS_BETA_DEPLOY = 'true';
    process.env.VERCEL_ENV = 'preview';

    const { GET } = await import('@/app/api/__health__/route');
    const res = await GET();
    const body = await res.json();

    expect(body).toEqual({
      ok: true,
      siteUrl: 'https://beta.checklyra.com',
      isBetaDeploy: true,
      vercelEnv: 'preview',
    });
  });

  test('isBetaDeploy is false when env var is unset', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://checklyra.com';
    delete process.env.IS_BETA_DEPLOY;
    process.env.VERCEL_ENV = 'production';

    const { GET } = await import('@/app/api/__health__/route');
    const res = await GET();
    const body = await res.json();

    expect(body.isBetaDeploy).toBe(false);
    expect(body.siteUrl).toBe('https://checklyra.com');
    expect(body.vercelEnv).toBe('production');
  });

  test('isBetaDeploy is false for any value other than the literal string "true"', async () => {
    for (const val of ['false', '1', 'yes', 'TRUE', '']) {
      process.env.IS_BETA_DEPLOY = val;
      jest.resetModules();
      const { GET } = await import('@/app/api/__health__/route');
      const res = await GET();
      const body = await res.json();
      expect(body.isBetaDeploy).toBe(false);
    }
  });

  test('returns nulls when env vars are absent', async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.IS_BETA_DEPLOY;
    delete process.env.VERCEL_ENV;

    const { GET } = await import('@/app/api/__health__/route');
    const res = await GET();
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.siteUrl).toBeNull();
    expect(body.vercelEnv).toBeNull();
  });

  test('does not leak any secret-shaped env keys', async () => {
    // Belt-and-braces: even if someone accidentally adds a process.env
    // reference to the route, this asserts the response only ever
    // contains the documented public fields.
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'NEVER_LEAK_THIS';
    process.env.LYRA_RELEASE_PAT = 'NEVER_LEAK_THIS_EITHER';

    const { GET } = await import('@/app/api/__health__/route');
    const res = await GET();
    const body = await res.json();

    const allowedKeys = ['ok', 'siteUrl', 'isBetaDeploy', 'vercelEnv'];
    expect(Object.keys(body).sort()).toEqual(allowedKeys.sort());

    const text = JSON.stringify(body);
    expect(text).not.toContain('NEVER_LEAK_THIS');
  });

  test('sends no-cache headers (so smoke checks always see fresh state)', async () => {
    const { GET } = await import('@/app/api/__health__/route');
    const res = await GET();

    const cacheControl = res.headers.get('cache-control') || '';
    expect(cacheControl).toContain('no-cache');
    expect(cacheControl).toContain('no-store');
  });
});
