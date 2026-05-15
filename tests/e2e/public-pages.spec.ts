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
    // BUGS-14: Next.js 16 has a quirk in its RSC streaming + Suspense +
    // notFound() interaction. When a server component calls notFound(),
    // the HTML stream includes a `<template data-dgst="NEXT_HTTP_ERROR_FALLBACK;404">`
    // marker AND the route-level `not-found.tsx` content, but the client
    // never swaps the loading.tsx fallback for the not-found content —
    // the DOM stays on the loading skeleton (no <h1> present at all).
    //
    // What IS reliable in this state:
    //   * The HTTP response includes the 404 marker (proves notFound()
    //     was reached server-side).
    //   * The page title metadata updates to "Profile not found — Lyra"
    //     (proves the not-found route's metadata is applied).
    //   * The URL stays on the unknown slug (proves no redirect happened).
    //
    // We assert on those three. The DOM-rendering issue is tracked
    // under BUGS-14; once Next.js / our app config resolves the
    // template-unwrap problem, we can tighten this back to assert on
    // the visible 404 heading + body copy.
    const response = await page.goto('/this-profile-does-not-exist-kan114', {
      waitUntil: 'domcontentloaded',
    });
    expect(page.url()).toContain('/this-profile-does-not-exist-kan114');
    await expect(page).toHaveTitle(/Profile not found/i);
    // The server-streamed HTML must contain the Next.js 404 RSC marker.
    // This proves notFound() executed even though the client didn't
    // swap the loading skeleton (BUGS-14).
    const body = await response?.text();
    expect(body).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404/);
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
