/**
 * KAN-104: Sentry client (browser) initialization.
 *
 * Next.js 16 imports this file on the client; it pairs with the server +
 * edge `register()` in `instrumentation.ts`. Same env-flag gate.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const enabled = process.env.IS_SENTRY_ENABLED === 'true';

if (dsn && enabled) {
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
export const onRouterTransitionStart = dsn && enabled
  ? Sentry.captureRouterTransitionStart
  : () => {};
