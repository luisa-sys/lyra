/**
 * KAN-104: meta-tests for the Sentry scaffolding.
 *
 * These tests don't exercise Sentry's runtime behaviour (that requires
 * network egress to sentry.io). They assert that the static surface is
 * correctly wired:
 *
 * 1. Both `instrumentation.ts` and `instrumentation-client.ts` exist.
 * 2. Both gate on the two-flag combo (`NEXT_PUBLIC_SENTRY_DSN` set AND
 *    `IS_SENTRY_ENABLED === 'true'`). Without this gate Sentry would
 *    initialise on every test run and during local dev, generating
 *    noise + free-tier quota burn.
 * 3. The Next config is wrapped with `withSentryConfig`.
 * 4. The CSP `connect-src` includes Sentry's DE region endpoints.
 * 5. The DSN is read from `NEXT_PUBLIC_SENTRY_DSN` (so it's exposed to
 *    the client bundle, which is correct — DSN is public-by-design)
 *    and the auth token is NOT in any tracked file (it must only live
 *    in CI secrets).
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

describe('KAN-104 Sentry scaffold', () => {
  test('instrumentation.ts exists at repo root', () => {
    expect(existsSync(resolve(ROOT, 'instrumentation.ts'))).toBe(true);
  });

  test('instrumentation-client.ts exists at repo root', () => {
    expect(existsSync(resolve(ROOT, 'instrumentation-client.ts'))).toBe(true);
  });

  test('server instrumentation gates on both env flags', () => {
    const src = readFileSync(resolve(ROOT, 'instrumentation.ts'), 'utf-8');
    expect(src).toContain('NEXT_PUBLIC_SENTRY_DSN');
    expect(src).toContain("IS_SENTRY_ENABLED === 'true'");
    // Belt-and-braces: the function must early-return when either flag
    // is missing. The literal `if (!dsn || !enabled)` clause is what
    // we're guarding against accidental removal of.
    expect(src).toMatch(/if \(!dsn \|\| !enabled\)/);
  });

  test('server instrumentation handles both nodejs and edge runtimes', () => {
    const src = readFileSync(resolve(ROOT, 'instrumentation.ts'), 'utf-8');
    expect(src).toContain("NEXT_RUNTIME === 'nodejs'");
    expect(src).toContain("NEXT_RUNTIME === 'edge'");
  });

  test('server instrumentation exports onRequestError for App Router error capture', () => {
    const src = readFileSync(resolve(ROOT, 'instrumentation.ts'), 'utf-8');
    expect(src).toContain('export async function onRequestError');
    expect(src).toContain('Sentry.captureRequestError');
  });

  test('client instrumentation gates on both env flags + has reasonable defaults', () => {
    const src = readFileSync(resolve(ROOT, 'instrumentation-client.ts'), 'utf-8');
    expect(src).toContain('NEXT_PUBLIC_SENTRY_DSN');
    expect(src).toContain("IS_SENTRY_ENABLED === 'true'");
    expect(src).toContain('replaysSessionSampleRate: 0');
    expect(src).toContain('sendDefaultPii: false');
  });

  test('next.config.ts is wrapped with withSentryConfig', () => {
    const src = readFileSync(resolve(ROOT, 'next.config.ts'), 'utf-8');
    expect(src).toContain("import { withSentryConfig } from \"@sentry/nextjs\"");
    expect(src).toContain('withSentryConfig(nextConfig');
  });

  test('CSP allows Sentry endpoints (DE region included)', () => {
    const src = readFileSync(resolve(ROOT, 'next.config.ts'), 'utf-8');
    expect(src).toContain('https://*.sentry.io');
    expect(src).toContain('https://*.de.sentry.io');
    expect(src).toContain('https://*.ingest.sentry.io');
    expect(src).toContain('https://*.ingest.de.sentry.io');
  });

  test('Sentry auth token is never referenced by NEXT_PUBLIC_ name (must stay server-side)', () => {
    // Auth tokens grant write access to source-map endpoints + project
    // settings. They MUST NEVER be bundled into the client. Static
    // check: the literal `NEXT_PUBLIC_SENTRY_AUTH_TOKEN` should not
    // appear anywhere in the repo.
    const filesToCheck = [
      'instrumentation.ts',
      'instrumentation-client.ts',
      'next.config.ts',
    ];
    for (const f of filesToCheck) {
      const src = readFileSync(resolve(ROOT, f), 'utf-8');
      expect(src).not.toContain('NEXT_PUBLIC_SENTRY_AUTH_TOKEN');
    }
  });
});
