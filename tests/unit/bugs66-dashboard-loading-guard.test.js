/**
 * BUGS-66 — dashboard streaming-reveal regression guard.
 *
 * Follow-up to BUGS-63 (PR #409). A route-segment `loading.tsx` wraps that
 * segment's `page` in an implicit React <Suspense> boundary whose streamed
 * content can fail to reveal on a HARD page load (typed URL / refresh) on the
 * deployed Next 16.2.x build: the real page <main> stays inside React's hidden
 * streaming holder (`<div hidden>`) while the fallback skeleton shows, so the
 * route renders blank except the site footer. Soft (client-side) navigation is
 * unaffected — no fresh server Suspense boundary — which is why manual testing
 * misses it. See CLAUDE.md "Known Technical Gotchas" #22 and
 * docs/DEV_E2E_REGRESSION.md §4.
 *
 * This is the ALWAYS-ON layer of the regression guard. It runs in the cred-free
 * unit suite on every PR (no deploy, no auth, no secrets), so a reintroduced
 * `loading.tsx` is caught at PR-review time. The complementary DEPLOYED-BUILD
 * layer is the hard-load `querySelectorAll('main').length === 1` assertion in
 * tests/e2e/authed/journey.authed.spec.ts (assertDashboardHardLoad), which only
 * runs in the founder-gated authed E2E harness (e2e-authed.yml — dispatch-only
 * until the E2E_SUPABASE_* secrets + Cloudflare WAF bypass are provisioned).
 * Because that layer is dormant in CI today, this repo-guard is the reliable
 * backstop.
 *
 * Net-new coverage; changes no existing test. Pure file-system assertions in the
 * style of doc-dod.test.js / test-regression-guard.test.js.
 *
 * ESCAPE HATCH (do NOT weaken this test): if a future Next/Sentry upgrade fixes
 * the upstream reveal bug and a segment `loading.tsx` is verified working on a
 * real deployed build (per docs/DEV_E2E_REGRESSION.md §1 checks #2/#3), append
 * the literal marker to the loading file to allow-list it —
 *   // loading-tsx-ok: <reason + deployed-build verification ref>
 * — same convention as `// server-action-exports-ok:` and `# integrity-ok:`.
 */
const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '../../src/app');
const ALLOW_MARKER = 'loading-tsx-ok';
const LOADING_RE = /^loading\.(tsx|ts|jsx|js)$/;

/** Recursively collect every route-segment loading.* file under src/app. */
function findLoadingFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findLoadingFiles(full));
    } else if (LOADING_RE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('BUGS-66: dashboard streaming-reveal regression guard', () => {
  test('src/app/dashboard/loading.tsx stays removed (BUGS-63 / PR #409)', () => {
    const p = path.join(APP_DIR, 'dashboard', 'loading.tsx');
    expect(fs.existsSync(p)).toBe(false);
  });

  test('no src/app/**/loading.* is reintroduced without an explicit sign-off marker', () => {
    // Any segment loading.tsx re-opens the BUGS-63 reveal risk on deployed
    // Next 16 builds until the upstream cause is understood. Allow only files
    // that carry the `// loading-tsx-ok: <reason>` escape-hatch marker.
    const offenders = findLoadingFiles(APP_DIR)
      .filter((f) => !fs.readFileSync(f, 'utf8').includes(ALLOW_MARKER))
      .map((f) => path.relative(APP_DIR, f));
    expect(offenders).toEqual([]);
  });

  test('the deployed-build hard-load main-count guard is still present in the authed E2E', () => {
    // Meta-guard: the deployed-build layer (assertDashboardHardLoad) must not be
    // silently deleted. If the authed harness is ever wired into CI, it is the
    // check that actually observes a stuck Suspense reveal in a real browser.
    const spec = fs.readFileSync(
      path.join(__dirname, '../e2e/authed/journey.authed.spec.ts'),
      'utf8',
    );
    expect(spec).toContain('assertDashboardHardLoad');
    // The core BUGS-63 assertion: exactly one <main> after a hard load.
    expect(spec).toMatch(/locator\('main'\)\)\.toHaveCount\(1\)/);
    expect(spec).toContain('BUGS-63');
  });
});
