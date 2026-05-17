/**
 * KAN-104: Sentry client (browser) initialization.
 *
 * Next.js 16 imports this file on the client; it pairs with the server +
 * edge `register()` in `instrumentation.ts`.
 *
 * Gate is DSN-presence only, NOT the two-flag combo that
 * `instrumentation.ts` uses. Why the asymmetry: Webpack/Next.js only
 * inlines `process.env.NEXT_PUBLIC_*` env vars into client bundles. The
 * server kill-switch `IS_SENTRY_ENABLED` (no `NEXT_PUBLIC_` prefix)
 * resolves to `undefined` at browser runtime, which means
 * `"true" === undefined` was always false and Sentry never initialised
 * in the browser regardless of what was set in Vercel. This was the
 * root cause of KAN-104 not "lighting up" after the env vars were
 * configured — diagnosed 2026-05-17.
 *
 * The kill switch for the client is therefore: clear or unset
 * `NEXT_PUBLIC_SENTRY_DSN`. If the DSN env var is empty, no SDK
 * initialises and no events ship. Equivalent safety to the previous
 * design, just expressed through a single visible env var.
 *
 * The server-side `instrumentation.ts` retains its two-flag gate
 * because Node has access to all env vars at runtime, including the
 * non-prefixed `IS_SENTRY_ENABLED`.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || 'development',
    tracesSampleRate: parseFloat(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || '0.1'
    ),
    // Replay is OFF by default — has cost implications and can capture
    // form input PII. Enable per-incident, not blanket.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
    release: process.env.NEXT_PUBLIC_RELEASE_SHA || undefined,
  });
}

// Required for Next.js navigation tracing (App Router).
export const onRouterTransitionStart = dsn
  ? Sentry.captureRouterTransitionStart
  : () => {};
