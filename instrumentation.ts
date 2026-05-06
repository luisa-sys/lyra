/**
 * KAN-104: Sentry server + edge runtime initialization.
 *
 * Next.js 16 routes server-side initialization through this file (replaces
 * the older `sentry.server.config.ts` / `sentry.edge.config.ts` pattern).
 * Each runtime gets its own dynamic import so we don't pull Node-only
 * packages into the edge bundle.
 *
 * Behaviour:
 * - Sentry is initialised only when both NEXT_PUBLIC_SENTRY_DSN is set
 *   AND IS_SENTRY_ENABLED is the literal string "true". The two-flag
 *   gate lets us cleanly disable Sentry without removing the DSN
 *   (e.g. during a noisy incident, when investigating cost, or in
 *   tests that don't want network egress).
 * - The DSN itself is public-by-design — it allows ingestion only,
 *   not data access — but we still keep it in env vars rather than
 *   hard-coding so it can rotate.
 * - The auth token used for source-map upload (sentry-cli, server-side)
 *   is a SEPARATE secret (SENTRY_AUTH_TOKEN) that is sensitive; it must
 *   be a GitHub Actions secret only, never NEXT_PUBLIC_ exposed.
 */

export async function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const enabled = process.env.IS_SENTRY_ENABLED === 'true';

  if (!dsn || !enabled) {
    // Intentionally silent — running without Sentry is the dev-mode
    // default. The CI smoke check in deploy-*.yml verifies this flag's
    // expected value per env.
    return;
  }

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/nextjs');
    Sentry.init({
      dsn,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
      // Trace 10% of requests by default — enough for trends, low enough
      // for free-tier quota. Override via SENTRY_TRACES_SAMPLE_RATE.
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
      // Strip query strings + cookies from breadcrumbs by default.
      // Sensitive params (search queries, slugs of private profiles)
      // shouldn't end up in Sentry events.
      sendDefaultPii: false,
      release: process.env.NEXT_PUBLIC_RELEASE_SHA || undefined,
    });
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    const Sentry = await import('@sentry/nextjs');
    Sentry.init({
      dsn,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
      sendDefaultPii: false,
      release: process.env.NEXT_PUBLIC_RELEASE_SHA || undefined,
    });
  }
}

/**
 * Forward unhandled request errors to Sentry. Required to capture errors
 * from Next.js's request lifecycle (Server Components, Server Actions,
 * Route Handlers) that the global error boundary doesn't otherwise see.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: 'Pages Router' | 'App Router'; routePath: string; routeType: 'render' | 'route' | 'action' | 'middleware' }
) {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const enabled = process.env.IS_SENTRY_ENABLED === 'true';
  if (!dsn || !enabled) return;
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(err, request, context);
}
