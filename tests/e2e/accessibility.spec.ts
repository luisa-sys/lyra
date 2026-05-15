import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * KAN-176: Accessibility scan via axe-core for the public, no-auth-required
 * surface area of stage.checklyra.com.
 *
 * Policy:
 *   - `serious` and `critical` violations FAIL the run (assertion).
 *   - `moderate` and `minor` violations are logged to the run summary
 *     (and trace in CI) but do NOT fail the run — they're tracked for
 *     follow-up.
 *
 * The Vercel SSO + Cloudflare bot-challenge bypass header is injected
 * via `playwright.config.ts` (`extraHTTPHeaders`) when `BASE_URL` points
 * at the direct Vercel deploy URL and `VERCEL_AUTOMATION_BYPASS` is set.
 *
 * This file is additive — it does NOT duplicate the page-content
 * assertions in `public-pages.spec.ts` (KAN-114, PR #162). It only
 * checks the WCAG-related issues axe-core can detect statically.
 */

type AxePage = {
  name: string;
  path: string;
};

const PUBLIC_PAGES: AxePage[] = [
  { name: 'homepage', path: '/' },
  { name: 'login', path: '/login' },
  { name: 'signup', path: '/signup' },
  { name: 'privacy', path: '/privacy' },
  { name: 'terms', path: '/terms' },
  { name: 'waitlist', path: '/waitlist' },
];

// axe-core tags we run. Aligned with WCAG 2.1 AA + best-practice rules.
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

test.describe('Accessibility (axe-core) — public pages', () => {
  // Self-contained Vercel SSO bypass: if the env var is set, attach the
  // protection-bypass header to every request from this suite. This makes
  // the spec robust to whether playwright.config.ts has the global
  // `extraHTTPHeaders` change from PR #162 yet or not — no merge conflict
  // either way.
  test.beforeEach(async ({ page }) => {
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS;
    if (bypass) {
      await page.setExtraHTTPHeaders({ 'x-vercel-protection-bypass': bypass });
    }
  });

  for (const { name, path } of PUBLIC_PAGES) {
    test(`${name} (${path}) has no serious or critical axe violations`, async ({ page }, testInfo) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      // Give client-side hydration a beat to settle. We deliberately
      // don't use networkidle here — that's brittle on pages with
      // long-lived analytics requests.
      await page.waitForLoadState('load');

      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();

      const bySeverity = {
        critical: results.violations.filter((v) => v.impact === 'critical'),
        serious: results.violations.filter((v) => v.impact === 'serious'),
        moderate: results.violations.filter((v) => v.impact === 'moderate'),
        minor: results.violations.filter((v) => v.impact === 'minor'),
      };

      // Attach the full JSON to the Playwright report so a maintainer can
      // drill in regardless of pass/fail.
      await testInfo.attach(`axe-${name}.json`, {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });

      // Log moderate/minor to the GitHub Actions step summary AND the
      // console so the workflow run page shows them inline.
      if (bySeverity.moderate.length > 0 || bySeverity.minor.length > 0) {
        const summary = [
          `### axe-core: ${name} (${path}) — non-blocking findings`,
          `- moderate: ${bySeverity.moderate.length}`,
          `- minor: ${bySeverity.minor.length}`,
          '',
          ...bySeverity.moderate.map(
            (v) => `- (moderate) ${v.id}: ${v.help} — ${v.nodes.length} node(s)`
          ),
          ...bySeverity.minor.map(
            (v) => `- (minor) ${v.id}: ${v.help} — ${v.nodes.length} node(s)`
          ),
          '',
        ].join('\n');
        // eslint-disable-next-line no-console
        console.log(summary);
      }

      // FAIL the test on any serious or critical violation. The message
      // is constructed to be readable in the GitHub Actions failure log.
      const blocking = [...bySeverity.critical, ...bySeverity.serious];
      if (blocking.length > 0) {
        const detail = blocking
          .map(
            (v) =>
              `  - [${v.impact}] ${v.id}: ${v.help}\n      help: ${v.helpUrl}\n      nodes: ${v.nodes.length}`
          )
          .join('\n');
        expect(
          blocking,
          `axe-core found ${blocking.length} serious/critical violation(s) on ${path}:\n${detail}`
        ).toEqual([]);
      }
    });
  }
});
