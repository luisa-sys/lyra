/**
 * The middleware composition root — KAN-415 D4 C8.
 *
 * ⚠️ THIS FILE HAS NO FUNCTION BODY, AND THAT IS THE POINT.
 *
 * It reads the environment, and wires that reader to the access pipeline. The
 * request path itself lives in src/modules/access/pipeline.ts as an ordered
 * list of named gates, each in its own file with its own reasoning.
 *
 * Through D5-D9 the neighbouring code gets rewritten repeatedly, and the
 * cheapest way to "just handle one more case" would be to open this file and
 * insert `if (x) return y;` above the pipeline. Every ordering test would still
 * pass — the gates would still run in order, they would simply no longer be the
 * only thing that runs. With no body there is nowhere to put it, and adding one
 * is a visible structural change rather than a one-line edit.
 *
 * WHAT USED TO BE HERE: 326 lines doing six unrelated jobs, two sequential
 * `profiles` reads, and two overlapping inline exemption arrays. The gate ORDER
 * and the fail-open/fail-closed asymmetry were behavioural contracts with no
 * test at all — that is why D4 began by writing 61 characterisation assertions
 * and only then moved anything.
 *
 * WHERE THINGS WENT:
 *   the gates            src/modules/access/gates/*.ts
 *   their order          src/modules/access/pipeline.ts (PRE_AUTH_ORDER, AUTHED_ORDER)
 *   path exemptions      src/modules/access/exemptions.ts (one declarative table)
 *   the SEC-36 surface   src/modules/access/oauth-server-paths.ts (an INCLUSION set,
 *                        deliberately NOT in the exemption table — see its header)
 *   session + cookies    src/modules/access/session.ts
 *   the CSP nonce        src/modules/access/csp.ts
 */
import { createAccessMiddleware } from '@/modules/access/pipeline';
import type { MiddlewareEnvRaw } from '@/modules/access/context';

/**
 * The seven env reads, in one place, as data.
 *
 * They stay in THIS file deliberately. CTL-037's baseline
 * (env-access-baseline.json) records `src/middleware.ts` with exactly these
 * seven variables; relocating the reads would change that baseline without
 * changing anything about what is actually read. Handing the values on as a
 * plain object also makes every consumer testable without the ambient
 * environment.
 */
function readMiddlewareEnv(): MiddlewareEnvRaw {
  return {
    IS_BETA_DEPLOY: process.env.IS_BETA_DEPLOY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    ADMIN_HOST: process.env.ADMIN_HOST,
    ADMIN_HOST_ENFORCED: process.env.ADMIN_HOST_ENFORCED,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export const middleware = createAccessMiddleware(readMiddlewareEnv);

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
