import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            // KAN-104: connect-src extended with *.sentry.io and *.de.sentry.io
            // (EU region) so Sentry's browser SDK can POST events. The two
            // wildcards cover both `o<id>.ingest.sentry.io` and the `.de.`
            // EU equivalent.
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://vitals.vercel-insights.com https://*.sentry.io https://*.de.sentry.io https://*.ingest.sentry.io https://*.ingest.de.sentry.io; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
        ],
      },
    ];
  },
};

// KAN-104: wrap with Sentry config for source-map upload + tunnel route.
// `withSentryConfig` is a no-op at runtime if the build doesn't have a
// SENTRY_AUTH_TOKEN set — it gracefully skips source-map upload rather
// than failing the build. So local dev / preview builds without the
// token still work; CI runs with the token populate Sentry releases.
export default withSentryConfig(nextConfig, {
  // Org + project come from env vars set in CI; falling back to the
  // canonical values from KAN-104 setup keeps local builds working.
  org: process.env.SENTRY_ORG || "lyra-q1q",
  project: process.env.SENTRY_PROJECT || "lyra",

  // Suppress source-map upload chatter unless we're in a debug build.
  silent: !process.env.CI,

  // Hide source maps from the public bundle. Source maps still upload
  // to Sentry but the public /_next/static URL doesn't 200 for them.
  // Reduces accidental code exposure on prod.
  sourcemaps: { disable: false, deleteSourcemapsAfterUpload: true },

  // Disable the Sentry tunnel route by default. Tunnel mode proxies
  // event POSTs through Next.js to bypass ad-blockers, but it adds a
  // serverless invocation per event and can blow free-tier quota fast.
  // Enable per-env later if we discover ad-block-related drop-off.
  tunnelRoute: undefined,

  // Don't block the build if Sentry's webpack plugin can't reach
  // sentry.io (e.g. during a Sentry outage). Builds that succeed
  // without source maps are still functionally fine; the missing
  // maps just mean stack traces are minified for that release.
  errorHandler: (err) => {
    console.warn("[sentry] source-map upload skipped:", err.message);
  },
});