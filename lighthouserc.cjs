/**
 * KAN-176: Lighthouse CI configuration for the staging testing program.
 *
 * Single run against the staging Vercel direct URL (not stage.checklyra.com
 * — Cloudflare bot challenge blocks CI runner IPs). The `LHCI_TARGET_URL`
 * env var is set by `.github/workflows/staging-tests.yml` to the homepage
 * of the latest staging deploy.
 *
 * Vercel SSO bypass: the `x-vercel-protection-bypass` header is injected
 * into Lighthouse's network requests via `settings.extraHeaders`. Without
 * this, every request would 401 and every score would be ~0.
 *
 * Budgets (assert thresholds):
 *   - Performance     >= 80    (error)
 *   - Accessibility   >= 90    (error)
 *   - Best Practices  >= 90    (error)
 *   - SEO             >= 90    (error on indexable hosts only — see below)
 *
 * SEO assertion is conditional on the target being indexable. Per KAN-175,
 * staging/dev/Vercel-preview URLs emit `<meta name="robots" content=
 * "noindex,…">` by design (the `is-page-indexable` audit then drops the
 * SEO category to ~0.69). Asserting SEO ≥ 0.9 on a deliberately-noindex
 * target is a false-positive failure that fired daily through May 2026.
 * We only enforce SEO when LHCI_TARGET_URL is on `checklyra.com` (prod
 * + beta); on Vercel preview hosts SEO drops to `warn` (reported, not
 * failing). A separate prod-Lighthouse job is the right place for hard
 * SEO assertions and is tracked as a follow-up.
 *
 * CommonJS (.cjs) because the rest of the repo is ESM-by-default
 * (`"type": "module"` would otherwise force ESM parsing) and lhci's
 * config loader prefers CJS.
 */

const targetUrl = process.env.LHCI_TARGET_URL;
const bypass = process.env.VERCEL_AUTOMATION_BYPASS;

if (!targetUrl) {
  // Fail loudly at config-load time rather than letting lhci pick a
  // default and pretend success.
  throw new Error(
    '[lighthouserc] LHCI_TARGET_URL is not set — refusing to run Lighthouse against an undefined target.'
  );
}

if (!bypass) {
  throw new Error(
    '[lighthouserc] VERCEL_AUTOMATION_BYPASS is not set — Lighthouse would 401 on every request and report fake-zero scores.'
  );
}

// Is the target an indexable host? Only checklyra.com (prod + beta) is.
// Vercel preview URLs and dev/staging custom domains are noindex by design.
let targetIsIndexable = false;
try {
  targetIsIndexable = new URL(targetUrl).hostname.endsWith('checklyra.com');
} catch {
  // Malformed URL — let lhci's collect step surface that error; for the
  // assertion gate, treat as non-indexable to avoid a false positive.
  targetIsIndexable = false;
}

const seoAssertLevel = targetIsIndexable ? 'error' : 'warn';

module.exports = {
  ci: {
    collect: {
      url: [targetUrl],
      numberOfRuns: 1,
      settings: {
        preset: 'desktop',
        // Inject the Vercel protection bypass header so the run hits the
        // actual app instead of the SSO redirect page.
        extraHeaders: JSON.stringify({
          'x-vercel-protection-bypass': bypass,
        }),
        // Chrome flags appropriate for headless GitHub Actions runners.
        chromeFlags: '--no-sandbox --headless=new --disable-gpu',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.8 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        'categories:seo': [seoAssertLevel, { minScore: 0.9 }],
      },
    },
    upload: {
      // Public temporary storage — no LHCI server set up yet. Reports are
      // also uploaded as a workflow artifact in staging-tests.yml.
      target: 'temporary-public-storage',
    },
  },
};
