import { test, expect } from '@playwright/test';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { adminClient } from '../support/supabase-admin';
import { mintSession } from '../support/mint-session';
import {
  ensureSoakUser,
  resetSoakUserToInitial,
  assertInitialBaseline,
  SOAK_EMAIL,
  SOAK_DISPLAY_NAME,
  type SoakUser,
} from '../support/soak-user';

/**
 * KAN-413 — the daily Staging Soak read-write journey (layer C3 of
 * docs/STAGING_SOAK_ROUTINE.md). Runs ONLY in the `soak-journey` Playwright
 * project, which exists only when SOAK_JOURNEY=1 (see playwright.config.ts), so
 * it never runs in the anon PR gate or the KAN-348 authed suite.
 *
 * It drives ONE persistent account (soak@seed.checklyra.com) — NOT a fresh
 * signup — through the post-signup lifecycle against the deployed staging build,
 * then resets it to initial account setup and asserts the reset was complete.
 * Sign-up itself is covered by the un-skippable promotion gate, not here.
 *
 * TEST INTEGRITY: no assertion here is loosened to pass. A divergence from the
 * release contract is reported as a soak finding — the test is not weakened. The
 * state transitions are applied via the service-role admin client (a real
 * staging DB write); the app render + one real UI edit round-trip are the reads.
 */

const AUTH_DIR = path.join(__dirname, '..', '.auth');
const SOAK_STATE = path.join(AUTH_DIR, 'soak.json');

let soak: SoakUser;

test.describe.configure({ mode: 'serial' }); // one user, ordered state transitions

test.beforeAll(async () => {
  const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';
  soak = await ensureSoakUser();
  // Start from a known-clean baseline even if a prior run crashed mid-journey.
  await resetSoakUserToInitial(soak);
  const dirty = await assertInitialBaseline(soak);
  expect(dirty, `soak reset left rows behind at start: ${dirty.join('; ')}`).toEqual([]);
  mkdirSync(AUTH_DIR, { recursive: true });
  await mintSession(baseURL, SOAK_EMAIL, SOAK_STATE);
});

test.afterAll(async () => {
  // Cleanup: return the account to initial account setup and PROVE it is clean.
  // A dirty baseline here means DERIVED_PROFILE_TABLES is stale for a table a
  // release started writing to — fail loudly rather than silently accumulate.
  if (!soak) return;
  await resetSoakUserToInitial(soak);
  const dirty = await assertInitialBaseline(soak);
  expect(dirty, `soak reset incomplete after journey: ${dirty.join('; ')}`).toEqual([]);
});

test.use({ storageState: SOAK_STATE });

/** Shared BUGS-63 hard-load smoke reused across states. */
async function assertDashboardHardLoad(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`/dashboard?cb=${Date.now()}`, { waitUntil: 'load' });
  await expect(page.locator('main')).toHaveCount(1); // BUGS-63: no stuck skeleton
  await expect(page.locator('[data-onboarding-state]')).toHaveCount(1);
}

test('C3.1 baseline — initial account setup resolves to empty state', async ({ page }) => {
  await assertDashboardHardLoad(page);
  await expect(page.locator('[data-onboarding-state="empty"]')).toBeVisible();
  await expect(page.locator('[data-widget="complete_profile"]')).toBeVisible();
  await expect(page.locator('[data-widget="publish"]')).toHaveCount(0);
});

test('C3.2 build — adding an intro advances empty → drafted', async () => {
  const admin = adminClient();
  const { error } = await admin
    .from('profiles')
    .update({ bio_short: 'A short intro so this profile reads as drafted.' })
    .eq('id', soak.profileId);
  expect(error, error?.message).toBeNull();
});

test('C3.3 drafted — publish widget appears', async ({ page }) => {
  await assertDashboardHardLoad(page);
  await expect(page.locator('[data-onboarding-state="drafted"]')).toBeVisible();
  await expect(page.locator('[data-widget="publish"]')).toBeVisible();
});

test('C3.4 publish — profile publishes and the public page renders', async ({ page }) => {
  const admin = adminClient();
  const { error } = await admin.from('profiles').update({ is_published: true }).eq('id', soak.profileId);
  expect(error, error?.message).toBeNull();

  await assertDashboardHardLoad(page);
  await expect(page.locator('[data-onboarding-state="published_activate"]')).toBeVisible();

  // The published public profile must render within the page budget.
  await page.goto(`/${soak.slug}?cb=${Date.now()}`, { waitUntil: 'load' });
  await expect(page.getByText(SOAK_DISPLAY_NAME)).toBeVisible();
});

test('C3.5 grow — gift + affiliation, and a Manual-of-Me edit round-trips', async ({ page }) => {
  const admin = adminClient();
  const { error: giftErr } = await admin
    .from('profile_items')
    .insert({ profile_id: soak.profileId, category: 'gift_ideas', title: 'A good book' });
  expect(giftErr, giftErr?.message).toBeNull();
  const { error: affErr } = await admin
    .from('school_affiliations')
    .insert({ profile_id: soak.profileId, school_name: 'Greenfield Primary' });
  expect(affErr, affErr?.message).toBeNull();

  await assertDashboardHardLoad(page);
  await expect(page.locator('[data-onboarding-state="published_grow"]')).toBeVisible();

  // A real user-driven write through the app: edit a Manual-of-Me box and
  // confirm it appears on the published profile (reuses the KAN-271 pattern).
  const marker = `Soak note ${Date.now()}`;
  await page.goto('/dashboard/profile', { waitUntil: 'load' });
  const goodToKnow = page.getByPlaceholder(/I'm a slow texter/);
  await expect(goodToKnow).toBeVisible();
  await goodToKnow.fill(marker);
  await goodToKnow.blur();
  await expect(page.getByText(/Saved|Saving/).first()).toBeVisible();

  await expect(async () => {
    await page.goto(`/${soak.slug}?cb=${Date.now()}`, { waitUntil: 'load' });
    await expect(page.getByText(marker)).toBeVisible();
  }).toPass({ timeout: 20_000 });
});
