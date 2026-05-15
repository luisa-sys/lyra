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
 *   - Performance     >= 80
 *   - Accessibility   >= 90
 *   - Best Practices  >= 90
 *   - SEO             >= 90
 *
 * Any regression below these thresholds fails the workflow.
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
        'categories:seo': ['error', { minScore: 0.9 }],
      },
    },
    upload: {
      // Public temporary storage — no LHCI server set up yet. Reports are
      // also uploaded as a workflow artifact in staging-tests.yml.
      target: 'temporary-public-storage',
    },
  },
};
