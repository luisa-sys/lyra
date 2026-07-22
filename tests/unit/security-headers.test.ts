/**
 * SEC-63 (KAN-350, findings web-headers-1/2): header/CSP regression guard.
 *
 * Two jobs:
 *  1. Pin the ENFORCED security-header stack declared in next.config.ts so a
 *     merge/refactor can't silently drop HSTS / CSP / X-Frame-Options etc.
 *     (there was previously no test). We read the config source directly — the
 *     same approach sentry-scaffold.test.ts uses to guard the Sentry CSP hosts.
 *  2. Assert the Report-Only nonce CSP that middleware stages is actually
 *     hardened — script-src carries the nonce + strict-dynamic and NO
 *     'unsafe-inline'/'unsafe-eval', plus object-src/frame-src 'none'.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildCspReportOnly } from '@/lib/security-headers';

const NEXT_CONFIG = readFileSync(resolve(__dirname, '../../next.config.ts'), 'utf-8');

describe('enforced security headers (next.config.ts regression guard)', () => {
  // Every required header + its exact value. A silent drop or weakening of any
  // of these in next.config.ts fails the build.
  const REQUIRED: Record<string, string> = {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': '',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-XSS-Protection': '1; mode=block',
  };

  it.each(Object.entries(REQUIRED))('declares the %s header', (key, value) => {
    expect(NEXT_CONFIG).toContain(`key: "${key}"`);
    if (value) expect(NEXT_CONFIG).toContain(value);
  });

  it("locks the enforced CSP's framing/base/form directives", () => {
    expect(NEXT_CONFIG).toContain("frame-ancestors 'none'");
    expect(NEXT_CONFIG).toContain("base-uri 'self'");
    expect(NEXT_CONFIG).toContain("form-action 'self'");
    expect(NEXT_CONFIG).toContain("default-src 'self'");
  });
});

describe('buildCspReportOnly (SEC-63 target nonce CSP)', () => {
  const NONCE = 'TESTNONCE123==';
  const csp = buildCspReportOnly(NONCE);

  // Pull out a named directive so the unsafe-* assertions can't be fooled by a
  // match in a different directive.
  function directive(name: string): string {
    return (
      csp
        .split(';')
        .map((d) => d.trim())
        .find((d) => d === name || d.startsWith(`${name} `)) ?? ''
    );
  }

  it('carries the per-request nonce and strict-dynamic on script-src', () => {
    const scriptSrc = directive('script-src');
    expect(scriptSrc).toContain(`'nonce-${NONCE}'`);
    expect(scriptSrc).toContain("'strict-dynamic'");
  });

  it("script-src has NO 'unsafe-inline' or 'unsafe-eval'", () => {
    const scriptSrc = directive('script-src');
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("adds object-src 'none' and frame-src 'none'", () => {
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('frame-src')).toBe("frame-src 'none'");
  });

  it("preserves default-src 'self' and frame-ancestors 'none'", () => {
    expect(directive('default-src')).toBe("default-src 'self'");
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
  });

  it('keeps connect-src aligned with the enforced Supabase/Sentry allow-list', () => {
    const connectSrc = directive('connect-src');
    expect(connectSrc).toContain('https://*.supabase.co');
    expect(connectSrc).toContain('https://*.de.sentry.io');
  });

  it('produces a distinct policy per nonce', () => {
    expect(buildCspReportOnly('AAA')).not.toBe(buildCspReportOnly('BBB'));
  });
});
