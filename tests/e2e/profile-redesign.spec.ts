import { test, expect, type Page } from '@playwright/test';

/**
 * KAN-271: E2E assertions for the June-2026 profile redesign (the warm
 * cream/sage "Notebook" theme + green logo wordmark), shipped to
 * origin/develop across KAN-263..KAN-269.
 *
 * Design of this suite — what runs WHERE, and why:
 *
 *  • The assertions in `describe('Redesign — warm palette + green logo …')`
 *    run on UNAUTHENTICATED, DATABASE-INDEPENDENT surfaces: the homepage,
 *    the public legal pages, and the `[slug]` not-found page. These render
 *    server-side WITHOUT a Supabase row, so they are reliable both:
 *      - locally / in the PR gate (`next build && next start`, dummy env), and
 *      - against a deployed staging URL (`BASE_URL` + Vercel bypass header).
 *    These are the GREEN, always-on guard for the redesign chrome.
 *
 *  • The assertions in `describe('Redesign — populated public profile …')`
 *    assert the new STRUCTURE of a *populated* profile: the "To understand
 *    me a little better" section, the humanised section headings, the 3px
 *    sage left-rule on headings, and that affiliations stay hidden unless
 *    `show_on_profile` is set. A populated public profile requires a real,
 *    published `profiles` row in Supabase — there is no local seed harness
 *    in this repo (the existing KAN-114 suite runs against a deployed URL
 *    with a real DB, not a locally-served build). So these tests are gated
 *    on `PROFILE_FIXTURE_SLUG`: they RUN against staging where a seeded
 *    profile exists, and are SKIPPED (not failed, not flaky) in the local /
 *    PR-gate run where no DB-backed profile can be served. This keeps the
 *    PR gate green while still exercising the full structure on staging.
 *
 * The Vercel SSO + Cloudflare bot-challenge bypass header is injected via
 * `playwright.config.ts` (`extraHTTPHeaders`) when `VERCEL_AUTOMATION_BYPASS`
 * is set — same pattern as `public-pages.spec.ts` and `accessibility.spec.ts`.
 */

// The warm "paper" page background — --color-paper: #FDFCF8 (globals.css).
// Browsers report computed background-color as rgb(253, 252, 248).
const PAPER_RGB = 'rgb(253, 252, 248)';
// The actionable sage — --color-sage: #4a7359 → rgb(74, 115, 89) (retuned to the
// mock-up green in KAN-272; was #5F7256 / rgb(95, 114, 86) before).
const SAGE_RGB = 'rgb(74, 115, 89)';

/**
 * Assert the page's <body> paints the warm "paper" background. This is the
 * single most load-bearing signal that the warm-chrome sweep (KAN-268/269)
 * is live: the old theme used the cold stone-50 (#FAFAF9 → rgb(250,250,249)).
 *
 * Used for pages that inherit the global body background (homepage, legal
 * pages). The `[slug]` routes instead paint the paper background on their
 * own <main> (the body computes transparent there) — assert on <main> for
 * those via `expectWarmMainBackground`.
 */
async function expectWarmBodyBackground(page: Page) {
  const bodyBg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(bodyBg).toBe(PAPER_RGB);
}

/**
 * Assert the page's primary <main> paints the warm "paper" background. The
 * public profile and its not-found peer set the paper token on <main> rather
 * than relying on the global body rule, so the body itself is transparent.
 */
async function expectWarmMainBackground(page: Page) {
  const mainBg = await page
    .locator('main')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(mainBg).toBe(PAPER_RGB);
}

/**
 * Assert the green Lyra logo wordmark is present. public/lyra-logo.png is now
 * the green wordmark (KAN-269); every public chrome renders it with alt="Lyra".
 * Next/Image rewrites the src through the image optimizer, so we assert the
 * optimizer URL still references the lyra-logo source asset.
 */
async function expectGreenLogo(page: Page) {
  const logo = page.getByRole('img', { name: 'Lyra' }).first();
  await expect(logo).toBeVisible();
  const src = await logo.getAttribute('src');
  expect(src).toBeTruthy();
  // next/image emits /_next/image?url=%2Flyra-logo.png&... — the decoded
  // source must point at the lyra-logo asset.
  expect(decodeURIComponent(src ?? '')).toContain('/lyra-logo.png');
}

test.describe('Redesign — warm palette + green logo on public chrome', () => {
  test('homepage paints the warm paper background and shows the green logo', async ({
    page,
  }) => {
    await page.goto('/');
    await expectWarmBodyBackground(page);
    await expectGreenLogo(page);
    // Sage is the redesign's accent — the hero eyebrow uses it. Assert at
    // least one element computes to the sage colour so a palette regression
    // (e.g. reverting to the old indigo/blue accent) is caught.
    const sageCount = await page.evaluate((sage) => {
      return Array.from(document.querySelectorAll('*')).filter(
        (el) => getComputedStyle(el).color === sage,
      ).length;
    }, SAGE_RGB);
    expect(sageCount).toBeGreaterThan(0);
  });

  test('privacy page uses the warm chrome and green logo', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page).toHaveTitle(/Privacy Policy/i);
    await expectWarmBodyBackground(page);
    await expectGreenLogo(page);
  });

  test('terms page uses the warm chrome and green logo', async ({ page }) => {
    await page.goto('/terms');
    await expect(page).toHaveTitle(/Terms of Service/i);
    await expectWarmBodyBackground(page);
    await expectGreenLogo(page);
  });

  test('the [slug] not-found page uses the redesigned warm chrome', async ({
    page,
  }) => {
    // Shares the public `[slug]` render path. BUGS-14: force-dynamic makes
    // notFound() emit a real 404. The not-found UI uses --color-paper +
    // --color-sage + the serif display face — all redesign tokens.
    const response = await page.goto('/__redesign-probe-no-such-profile', {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status()).toBe(404);
    // The not-found.tsx peer paints the paper token on its <main> (the body
    // is transparent on this route), so assert the warm bg there.
    await expectWarmMainBackground(page);
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
    // The "Go to Lyra" CTA paints the sage button background (KAN-269 token).
    const cta = page.getByRole('link', { name: /Go to Lyra/i });
    await expect(cta).toBeVisible();
    const ctaBg = await cta.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(ctaBg).toBe(SAGE_RGB);
  });
});

/**
 * Populated public-profile structure. Gated on PROFILE_FIXTURE_SLUG — a slug
 * of a published profile seeded in the target environment's Supabase. Set it
 * in the staging run (where a seeded fixture profile exists); leave it unset
 * locally / in the PR gate, where the suite is skipped rather than failed.
 *
 * Recommended fixture: a published profile whose owner has filled in the
 * Manual-of-Me ("To understand me") boxes and has at least one affiliation
 * with show_on_profile = false (to prove affiliations stay hidden by default).
 */
const FIXTURE_SLUG = process.env.PROFILE_FIXTURE_SLUG;

test.describe('Redesign — populated public profile structure', () => {
  test.skip(
    !FIXTURE_SLUG,
    'Set PROFILE_FIXTURE_SLUG to a published profile slug to run the populated-profile structural assertions (requires a real Supabase row; runs on staging, skipped in the local/PR-gate build).',
  );

  test.beforeEach(async ({ page }) => {
    await page.goto(`/${FIXTURE_SLUG}`, { waitUntil: 'domcontentloaded' });
  });

  test('renders the warm profile chrome and green logo', async ({ page }) => {
    // The public profile <main> sets the paper bg inline (#fdfcf8).
    await expectWarmMainBackground(page);
    await expectGreenLogo(page);
  });

  test('shows the "To understand me a little better" humanised section', async ({
    page,
  }) => {
    // KAN-264/265: the Manual-of-Me section heading, rendered by <SectionQ>
    // with the 3px sage left-rule.
    const heading = page.getByRole('heading', {
      name: /To understand me a little better/i,
    });
    await expect(heading).toBeVisible();
    // Assert the 3px sage left-rule that defines a redesign section heading.
    const borderLeftWidth = await heading.evaluate(
      (el) => getComputedStyle(el).borderLeftWidth,
    );
    const borderLeftColor = await heading.evaluate(
      (el) => getComputedStyle(el).borderLeftColor,
    );
    expect(borderLeftWidth).toBe('3px');
    expect(borderLeftColor).toBe(SAGE_RGB);
  });

  test('uses humanised, first-person section headings (not old field labels)', async ({
    page,
  }) => {
    // The redesign replaced terse field labels with warm, first-person
    // questions. At least one of the humanised headings must be present.
    const humanised = [
      /A few of my favourite things/i,
      /To understand me a little better/i,
      /A few more things about me/i,
      /Things I love/i,
    ];
    const matches = await Promise.all(
      humanised.map((re) => page.getByText(re).count()),
    );
    expect(matches.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  test('hides affiliations that are not opted in to the public profile', async ({
    page,
  }) => {
    // KAN-263/267: affiliations are hidden on the public profile unless
    // show_on_profile = true. The "Where you might know me from" section is
    // only rendered when at least one affiliation is opted in. We assert the
    // section is ABSENT for the default fixture (whose affiliations are not
    // opted in). If your fixture intentionally opts one in, set
    // PROFILE_FIXTURE_HAS_VISIBLE_AFFILIATION=true to invert this.
    const affiliationsHeading = page.getByRole('heading', {
      name: /Where you might know me from/i,
    });
    if (process.env.PROFILE_FIXTURE_HAS_VISIBLE_AFFILIATION === 'true') {
      await expect(affiliationsHeading).toBeVisible();
    } else {
      await expect(affiliationsHeading).toHaveCount(0);
    }
  });

  test('never renders the removed "Files & media" section', async ({ page }) => {
    // KAN-404: the "Files & media" surface was removed from the editor (#416),
    // so it must never render on the public profile either — otherwise
    // edit != published. The section heading must be absent for every profile.
    const filesHeading = page.getByRole('heading', {
      name: /Files & media/i,
    });
    await expect(filesHeading).toHaveCount(0);
  });
});

/**
 * AUTHENTICATED EDITOR (create/edit/save profile) — NOW IMPLEMENTED (KAN-348).
 *
 * This describe was a `test.fixme` placeholder while no session harness existed.
 * The KAN-348 authenticated E2E harness (option (b): a seeded test user + a
 * programmatic session mint wired into a Playwright globalSetup project) now
 * provisions exactly that. The real editor test — "edits a Manual-of-Me box and
 * the change appears on the published profile" — lives in the AUTHED project so
 * this anon suite stays credential-free and DB-independent:
 *
 *   tests/e2e/authed/journey.authed.spec.ts
 *     → describe('KAN-271 — authenticated profile editor (was test.fixme)')
 *
 * It runs only when E2E_AUTHED is set (globalSetup no-ops otherwise), so the
 * PR gate that runs THIS file is untouched. Nothing to run here.
 */
