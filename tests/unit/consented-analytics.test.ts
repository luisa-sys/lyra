/**
 * SEC-72 — cookie-consent must actually gate analytics.
 *
 * Before SEC-72 the banner's "Essential only" button was consent theatre:
 * <Analytics/> + <SpeedInsights/> mounted unconditionally in layout.tsx. These
 * tests lock in the gate (analytics runs ONLY on explicit accept) and the
 * wiring (layout renders the gated component, not the raw Vercel components).
 */

import fs from 'fs';
import path from 'path';
import {
  analyticsAllowed,
  getConsentSnapshot,
  getServerConsentSnapshot,
  CONSENT_STORAGE_KEY,
  type ConsentValue,
} from '@/app/consent-state';

const root = path.join(__dirname, '../..');

describe('SEC-72 analytics consent gate', () => {
  describe('analyticsAllowed', () => {
    test('only "accepted" enables analytics', () => {
      expect(analyticsAllowed('accepted')).toBe(true);
    });

    test.each<ConsentValue>(['pending', 'none', 'declined'])(
      'blocks analytics for "%s"',
      (value) => {
        expect(analyticsAllowed(value)).toBe(false);
      },
    );

    test('"Essential only" (declined) never enables analytics', () => {
      // The whole point of the ticket: declining must change something.
      expect(analyticsAllowed('declined')).toBe(false);
    });
  });

  describe('snapshots', () => {
    test('server snapshot is always pending (SSR-safe, no analytics)', () => {
      expect(getServerConsentSnapshot()).toBe('pending');
      expect(analyticsAllowed(getServerConsentSnapshot())).toBe(false);
    });

    test('client snapshot is pending when window is undefined (SSR)', () => {
      // Node test env has no window, so this exercises the SSR branch.
      expect(getConsentSnapshot()).toBe('pending');
    });
  });

  describe('shared storage key', () => {
    test('gate reads the same localStorage key the banner writes', () => {
      expect(CONSENT_STORAGE_KEY).toBe('lyra-cookie-consent');
      const banner = fs.readFileSync(
        path.join(root, 'src/app/cookie-consent.tsx'),
        'utf8',
      );
      expect(banner).toContain(CONSENT_STORAGE_KEY);
    });
  });

  describe('layout wiring', () => {
    const layout = fs.readFileSync(
      path.join(root, 'src/app/layout.tsx'),
      'utf8',
    );

    test('layout renders the gated ConsentedAnalytics component', () => {
      expect(layout).toContain('ConsentedAnalytics');
      expect(layout).toContain('<ConsentedAnalytics />');
    });

    test('layout no longer mounts Analytics/SpeedInsights directly', () => {
      // Ungated mounts would re-open the consent-theatre hole.
      expect(layout).not.toContain('<Analytics />');
      expect(layout).not.toContain('<SpeedInsights />');
      expect(layout).not.toContain("from \"@vercel/analytics/react\"");
      expect(layout).not.toContain("from \"@vercel/speed-insights/next\"");
    });

    test('the gate component owns the Vercel analytics imports', () => {
      const gate = fs.readFileSync(
        path.join(root, 'src/app/consented-analytics.tsx'),
        'utf8',
      );
      expect(gate).toContain('@vercel/analytics/react');
      expect(gate).toContain('@vercel/speed-insights/next');
      expect(gate).toContain('analyticsAllowed');
    });
  });
});
