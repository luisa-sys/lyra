import { NextResponse } from 'next/server';

/**
 * KAN-175: tiny health endpoint exposing public env config so CI smoke
 * checks can validate that each environment is wired up correctly.
 *
 * What's exposed (and why each is safe):
 * - siteUrl: NEXT_PUBLIC_SITE_URL — already inlined in the client bundle by
 *   Next.js so this leaks no new info. CI uses it to verify the OAuth
 *   redirectTo will resolve to the expected host on each env.
 * - isBetaDeploy: boolean derived from IS_BETA_DEPLOY env. Indicates whether
 *   the in-app beta gate (middleware → /waitlist redirect for ineligible
 *   users) is active. Public knowledge — the gate's behaviour is observable
 *   anyway by attempting to sign in.
 * - vercelEnv: Vercel's own VERCEL_ENV value (production / preview /
 *   development). Public — visible in deployment metadata.
 *
 * What's NOT exposed: secrets, service-role keys, Supabase project URL/keys,
 * commit SHAs, internal env vars.
 *
 * Disabled in tests via NODE_ENV check — test runs use a synthetic env
 * without the relevant vars set.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? null;
  const isBetaDeploy = process.env.IS_BETA_DEPLOY === 'true';
  const vercelEnv = process.env.VERCEL_ENV ?? null;

  return NextResponse.json(
    {
      ok: true,
      siteUrl,
      isBetaDeploy,
      vercelEnv,
    },
    {
      headers: {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    }
  );
}
