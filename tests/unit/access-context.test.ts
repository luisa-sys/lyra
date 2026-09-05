/**
 * DeployContext derives exactly what src/middleware.ts derived inline.
 * KAN-415 D4 C3.
 *
 * `deployTier` decides whether the tier gate runs at all, and it is a
 * THREE-valued result from a two-branch conditional over three env variables.
 * That is the shape most likely to be got subtly wrong in a move — so it is
 * checked as a cross-product against a literal transcription of the original,
 * not by inspection.
 */
import { buildDeployContext, DEFAULT_ADMIN_HOST } from '@/modules/access/context';

/** src/middleware.ts, transcribed. Does not import the implementation. */
function originalDeployTier(env: Record<string, string | undefined>): 'beta' | 'prod' | null {
  const isBetaDeploy = env.IS_BETA_DEPLOY === 'true';
  const isProdSite =
    env.NEXT_PUBLIC_SITE_URL === 'https://checklyra.com' && env.VERCEL_ENV === 'production';
  return isBetaDeploy ? 'beta' : isProdSite ? 'prod' : null;
}

const BETA = [undefined, 'true', 'false', 'TRUE', ''];
const SITE = [undefined, 'https://checklyra.com', 'https://beta.checklyra.com', ''];
const VERCEL = [undefined, 'production', 'preview', ''];

describe('deployTier — every combination, against the original', () => {
  test('agrees on all 80 combinations of the three inputs', () => {
    const disagreements: string[] = [];
    for (const b of BETA) {
      for (const s of SITE) {
        for (const v of VERCEL) {
          const env = { IS_BETA_DEPLOY: b, NEXT_PUBLIC_SITE_URL: s, VERCEL_ENV: v };
          const got = buildDeployContext(env).deployTier;
          const want = originalDeployTier(env);
          if (got !== want) disagreements.push(`${b}/${s}/${v}: got ${got} want ${want}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  test('the cross-product actually produces all three outcomes', () => {
    // Otherwise the agreement above could be agreement on a single value.
    const seen = new Set<string>();
    for (const b of BETA) for (const s of SITE) for (const v of VERCEL) {
      seen.add(String(buildDeployContext({ IS_BETA_DEPLOY: b, NEXT_PUBLIC_SITE_URL: s, VERCEL_ENV: v }).deployTier));
    }
    expect([...seen].sort()).toEqual(['beta', 'null', 'prod']);
  });

  test('beta wins over prod when both would qualify', () => {
    // The ternary order is behaviour: a deploy that is somehow both must be
    // treated as beta, never as production.
    expect(
      buildDeployContext({
        IS_BETA_DEPLOY: 'true',
        NEXT_PUBLIC_SITE_URL: 'https://checklyra.com',
        VERCEL_ENV: 'production',
      }).deployTier,
    ).toBe('beta');
  });

  test('prod requires BOTH the site URL and VERCEL_ENV', () => {
    expect(buildDeployContext({ NEXT_PUBLIC_SITE_URL: 'https://checklyra.com' }).deployTier).toBeNull();
    expect(buildDeployContext({ VERCEL_ENV: 'production' }).deployTier).toBeNull();
  });
});

describe('the rest of the snapshot', () => {
  test('adminHost defaults, and an explicit value wins', () => {
    expect(buildDeployContext({}).adminHost).toBe(DEFAULT_ADMIN_HOST);
    expect(buildDeployContext({ ADMIN_HOST: 'x.example' }).adminHost).toBe('x.example');
  });

  test('adminHostEnforced is strictly the string "true"', () => {
    // Not truthiness: 'false' and '1' must both be false, or enabling admin
    // isolation by typo becomes possible.
    expect(buildDeployContext({ ADMIN_HOST_ENFORCED: 'true' }).adminHostEnforced).toBe(true);
    expect(buildDeployContext({ ADMIN_HOST_ENFORCED: 'false' }).adminHostEnforced).toBe(false);
    expect(buildDeployContext({ ADMIN_HOST_ENFORCED: '1' }).adminHostEnforced).toBe(false);
    expect(buildDeployContext({}).adminHostEnforced).toBe(false);
  });

  test('isBetaDeploy is strictly the string "true" too', () => {
    expect(buildDeployContext({ IS_BETA_DEPLOY: 'true' }).isBetaDeploy).toBe(true);
    expect(buildDeployContext({ IS_BETA_DEPLOY: 'TRUE' }).isBetaDeploy).toBe(false);
  });

  test('supabase credentials pass through untouched, including absent', () => {
    const c = buildDeployContext({ NEXT_PUBLIC_SUPABASE_URL: 'u', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' });
    expect(c.supabaseUrl).toBe('u');
    expect(c.supabaseAnonKey).toBe('k');
    expect(buildDeployContext({}).supabaseUrl).toBeUndefined();
  });
});
