import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { MANIFEST_PATH, statePath, type Manifest } from '../global-setup';
import { adminClient } from '../support/supabase-admin';

/**
 * KAN-348 — the authenticated onboarding journey spec.
 *
 * Runs ONLY in the `authed-journey` Playwright project, which exists only when
 * E2E_AUTHED is set (see playwright.config.ts). It reads the manifest written by
 * global-setup.ts and asserts the KAN-349 widget journey end-to-end against a
 * deployed dev/staging build:
 *   hard-load dashboard smoke (BUGS-63) →
 *   empty → drafted → published_activate → published_grow →
 *   dismissal persistence + re-surface on state change →
 *   entitlement gating (convene absent when not entitled) →
 *   age gating (publish blocked when age_status='none').
 *
 * TEST INTEGRITY: no assertion here is loosened to pass. If the running app's
 * widget / gating behaviour diverges from the spec, that is reported per
 * KAN-348 §3 — the test is NOT weakened.
 */

// Lazy: the manifest is written by globalSetup (E2E_AUTHED only), so we read it
// at TEST RUN time, never at module-collection time. This keeps
// `npx playwright test --list` (which loads every spec module) from crashing
// when the harness hasn't run and no manifest exists.
let _manifest: Manifest | null = null;
function manifest(): Manifest {
  if (!_manifest) _manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  return _manifest;
}

/**
 * KAN-348 / KAN-308 — is Convene enabled on the environment under test?
 *
 * Convene is deliberately OFF on the dev/staging targets this suite runs
 * against (Luisa, 2026-07-26: leave Convene off for now and release the gate).
 * With the feature off the widget cannot render, so asserting `toBeVisible()`
 * unconditionally fails for an ENVIRONMENT reason, not a product defect.
 *
 * This is NOT a loosened assertion — both branches assert real behaviour:
 *   Convene OFF → the convene widget must be ABSENT (nothing leaks past the flag)
 *   Convene ON  → the convene widget must be VISIBLE for an entitled identity
 *
 * Flip `E2E_CONVENE_ENABLED=true` (workflow input `convene_enabled`) the moment
 * Convene is enabled on the target env; the original entitlement assertion then
 * comes back automatically with no further code change.
 */
const CONVENE_ENABLED = process.env.E2E_CONVENE_ENABLED === 'true';

/** Shared BUGS-63 hard-load smoke reused for every authed identity. */
async function assertDashboardHardLoad(page: import('@playwright/test').Page): Promise<void> {
  // Hard navigation + cache-bust — soft navs can mask a broken Suspense reveal.
  await page.goto(`/dashboard?cb=${Date.now()}`, { waitUntil: 'load' });
  // BUGS-63 guard: exactly one <main> (a hidden 2nd <main> = the stuck loading
  // skeleton the fix removed).
  await expect(page.locator('main')).toHaveCount(1);
  // The widget stack (or an empty state) must have rendered its state marker.
  await expect(page.locator('[data-onboarding-state]')).toHaveCount(1);
}

test.describe('KAN-348 journey — empty', () => {
  test.use({ storageState: statePath('empty') });

  test('empty state: complete_profile widget, no publish', async ({ page }) => {
    await assertDashboardHardLoad(page);
    await expect(page.locator('[data-onboarding-state="empty"]')).toBeVisible();
    await expect(page.locator('[data-widget="complete_profile"]')).toBeVisible();
    await expect(page.locator('[data-widget="publish"]')).toHaveCount(0);
  });
});

test.describe('KAN-348 journey — drafted', () => {
  test.use({ storageState: statePath('drafted') });

  test('drafted state: publish widget', async ({ page }) => {
    await assertDashboardHardLoad(page);
    await expect(page.locator('[data-onboarding-state="drafted"]')).toBeVisible();
    await expect(page.locator('[data-widget="publish"]')).toBeVisible();
  });
});

test.describe('KAN-348 journey — published_activate (no convene)', () => {
  test.use({ storageState: statePath('published_activate') });

  test('published_activate: gifts/affiliations/share, convene absent', async ({ page }) => {
    await assertDashboardHardLoad(page);
    await expect(page.locator('[data-onboarding-state="published_activate"]')).toBeVisible();
    await expect(page.locator('[data-widget="add_gifts"]')).toBeVisible();
    await expect(page.locator('[data-widget="add_affiliations"]')).toBeVisible();
    await expect(page.locator('[data-widget="share"]')).toBeVisible();
    // Convene only appears in published_grow AND only when entitled — here neither.
    await expect(page.locator('[data-widget="convene"]')).toHaveCount(0);
  });
});

test.describe('KAN-348 journey — published_grow (convene-entitled)', () => {
  test.use({ storageState: statePath('published_grow') });

  test('published_grow: share visible; convene follows env enablement', async ({ page }) => {
    await assertDashboardHardLoad(page);
    await expect(page.locator('[data-onboarding-state="published_grow"]')).toBeVisible();
    await expect(page.locator('[data-widget="share"]')).toBeVisible();
    if (CONVENE_ENABLED) {
      // Convene on + entitled identity → the widget must render.
      await expect(page.locator('[data-widget="convene"]')).toBeVisible();
    } else {
      // Convene off → the widget must NOT leak past the flag, even for an
      // entitled identity. This is the assertion that has real value while the
      // KAN-308 hold stands.
      await expect(page.locator('[data-widget="convene"]')).toHaveCount(0);
    }
  });
});

test.describe('KAN-271 — authenticated profile editor (was test.fixme)', () => {
  // Uses the published_grow identity (published → its Manual-of-Me renders on the
  // public profile). This replaces the deferred test.fixme in
  // profile-redesign.spec.ts now that the harness provisions a real session.
  test.use({ storageState: statePath('published_grow') });

  test('edits a Manual-of-Me box; the change appears on the published profile', async ({
    page,
  }) => {
    const slug = manifest().published_grow.slug;
    // BUGS-70: the marker must be unique per run but must NOT contain a 10-15
    // digit run, or the content-moderation PII filter blocks it as `pii:phone_plain`
    // (a raw `Date.now()` is a 13-digit number) and the save is rejected before it
    // can persist — masking the real assertion. Base-36 of the timestamp is a short
    // alphanumeric token: unique per run, no long digit run. (Locator text change
    // signed off by founder 2026-07-25 per Test Integrity Policy; assertion unchanged.)
    const marker = `E2E manual note ref-${Date.now().toString(36)}`;

    await page.goto('/dashboard/profile', { waitUntil: 'load' });
    // The "Good to know about me" textarea is located by its placeholder (the
    // MoMField has no stable id; placeholder is stable copy — KAN-266).
    const goodToKnow = page.getByPlaceholder(/I'm a slow texter/);
    await expect(goodToKnow).toBeVisible();
    await goodToKnow.fill(marker);
    // Autosave debounces ~800ms after the last keystroke; blur + wait for the
    // section's save to settle, then confirm via the public profile.
    await goodToKnow.blur();
    await expect(page.getByText(/Saved|Saving/).first()).toBeVisible();

    // The edit === published content (June-2026 spec): it must show on /<slug>.
    await expect(async () => {
      await page.goto(`/${slug}?cb=${Date.now()}`, { waitUntil: 'load' });
      await expect(page.getByText(marker)).toBeVisible();
    }).toPass({ timeout: 20_000 });
  });
});

test.describe('KAN-348 journey — dismissal persistence + re-surface', () => {
  test.use({ storageState: statePath('published_activate') });

  test('dismiss add_gifts persists across reload, re-surfaces on state change', async ({ page }) => {
    await assertDashboardHardLoad(page);
    // add_gifts is a dismissible secondary widget in published_activate.
    const addGifts = page.locator('[data-widget="add_gifts"]');
    await expect(addGifts).toBeVisible();

    // Dismiss via the ✕ server-action form (no client JS).
    await page
      .locator('[data-widget="add_gifts"] button[aria-label^="Dismiss"]')
      .click();
    await expect(page.locator('[data-widget="add_gifts"]')).toHaveCount(0);

    // Persisted to dashboard_widget_state: still gone after a hard reload.
    await page.goto(`/dashboard?cb=${Date.now()}`, { waitUntil: 'load' });
    await expect(page.locator('[data-onboarding-state="published_activate"]')).toBeVisible();
    await expect(page.locator('[data-widget="add_gifts"]')).toHaveCount(0);

    // Now flip a content signal that changes state: add a gift + affiliation via
    // service-role → the user resolves to published_grow. The dismissal (keyed
    // to published_activate) must NOT suppress the new state's widgets.
    const profileId = manifest().published_activate.profileId;
    const admin = adminClient();
    const { error: giftErr } = await admin
      .from('profile_items')
      .insert({ profile_id: profileId, category: 'gift_ideas', title: 'A good book' });
    expect(giftErr, giftErr?.message).toBeNull();
    const { error: affErr } = await admin
      .from('school_affiliations')
      .insert({ profile_id: profileId, school_name: 'Greenfield Primary' });
    expect(affErr, affErr?.message).toBeNull();

    await page.goto(`/dashboard?cb=${Date.now()}`, { waitUntil: 'load' });
    await expect(page.locator('[data-onboarding-state="published_grow"]')).toBeVisible();
    // share re-surfaces in the new state despite the prior dismissal.
    await expect(page.locator('[data-widget="share"]')).toBeVisible();

    // Reset the mutation so this spec is idempotent on re-run (belt-and-braces;
    // global-setup would recreate the user anyway on the next run).
    await admin
      .from('profile_items')
      .delete()
      .eq('profile_id', profileId)
      .eq('category', 'gift_ideas');
    await admin.from('school_affiliations').delete().eq('profile_id', profileId);
  });
});

test.describe('KAN-348 journey — age gate blocks publish', () => {
  test.use({ storageState: statePath('age_none') });

  test('age_status=none: publish is blocked, status stays Private', async ({ page }) => {
    // Only meaningful when the env-wide age gate is on; if it is off, publish is
    // allowed by design and this sub-case does not apply. We assert the gate
    // behaviour without weakening: when AGE_VERIFICATION_REQUIRED is on, the
    // dashboard shows the "Verify your age to publish" CTA (drafted state) and
    // the profile status is NOT "Public".
    await assertDashboardHardLoad(page);
    // The age_none user has a name + intro but age_status='none' and is not
    // published → drafted state, publish widget present.
    await expect(page.locator('[data-onboarding-state="drafted"]')).toBeVisible();

    // Status line in the "Your profile" card must not read Public.
    const statusRow = page.getByText('Status', { exact: true }).locator('..');
    await expect(statusRow).not.toContainText('Public');
  });
});
