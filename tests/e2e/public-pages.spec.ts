import { test, expect } from '@playwright/test';

/**
 * KAN-114: E2E coverage for public pages that don't require auth.
 *
 * These tests target pages that:
 *   - render server-side without a Supabase session, AND
 *   - are reachable both on stage.checklyra.com (via Vercel bypass header)
 *     and on `npm run dev` for local runs.
 *
 * Each test asserts on at least one visible element (title, heading, or
 * known body text) so a "page rendered an empty 200" regression is caught.
 *
 * Do NOT add auth-gated routes here — Vercel SSO would 401 them on staging.
 */

test.describe('Login page', () => {
  test('renders the sign-in form', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/Sign in to Lyra/i);
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });
});

test.describe('Signup page', () => {
  test('renders the create-account form', async ({ page }) => {
    await page.goto('/signup');
    await expect(page).toHaveTitle(/Create your Lyra profile/i);
    await expect(page.getByRole('heading', { name: /create your profile/i })).toBeVisible();
    await expect(page.getByLabel(/full name/i)).toBeVisible();
  });
});

test.describe('Privacy policy', () => {
  test('renders the GDPR privacy content', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page).toHaveTitle(/Privacy Policy/i);
    await expect(page.getByRole('heading', { name: /privacy policy/i, level: 1 })).toBeVisible();
    // Content sanity-check: the GDPR section header must be present so
    // we know the article body actually rendered, not just the nav.
    await expect(page.getByRole('heading', { name: /your rights/i })).toBeVisible();
  });
});

test.describe('Terms of service', () => {
  test('renders the terms content', async ({ page }) => {
    await page.goto('/terms');
    await expect(page).toHaveTitle(/Terms of Service/i);
    await expect(page.getByRole('heading', { name: /terms of service/i, level: 1 })).toBeVisible();
    // Section 5 references MCP — a known stable phrase on this page.
    await expect(page.getByText(/AI companion access/i)).toBeVisible();
  });
});

test.describe('Public profile 404', () => {
  test('shows the not-found page for an unknown slug', async ({ page }) => {
    const response = await page.goto('/this-profile-does-not-exist-kan114');
    // Next.js renders the [slug]/not-found.tsx — should be a 404 status
    // and the friendly profile-not-found copy.
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
    await expect(page.getByText(/This profile doesn['’]t exist/i)).toBeVisible();
  });
});

test.describe('Waitlist page', () => {
  test('renders the beta waitlist message', async ({ page }) => {
    await page.goto('/waitlist');
    await expect(page).toHaveTitle(/waitlist/i);
    await expect(page.getByRole('heading', { name: /you['’]re on the list/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /go to lyra/i })).toBeVisible();
  });
});
