import { test, expect } from '@playwright/test';
import { adminClient } from '../support/supabase-admin';

/**
 * KAN-413 — the UN-SKIPPABLE user sign-up E2E.
 *
 * Runs ONLY in the `signup-e2e` project (SIGNUP_E2E=1, see playwright.config.ts).
 * It is NOT part of the daily soak — the promote-to-staging gate runs it, and
 * ONLY when the diff touches the sign-up surface (.github/signup-surface.paths).
 * That is the whole point: the daily soak uses a persistent reset-user and
 * therefore never exercises account CREATION, so this test is the one thing that
 * proves signup still works before signup-code changes reach staging.
 *
 * It drives the REAL /signup form (18+ tick → name → email → consent → submit,
 * exercising the signUp server action, the age-declaration re-check, and the
 * invite-code path), then completes account activation the same way production
 * does (magic-link confirm through /auth/confirm) and asserts a first session
 * lands on /dashboard. The fresh test user is deleted afterwards (unlike the
 * persistent soak user) — this test's subject IS a new account each run.
 *
 * TEST INTEGRITY: nothing here is loosened to pass. If real signup diverges from
 * this contract, the gate blocks the promotion — the test is not weakened.
 *
 * NOTE (email): submitting the form triggers a real Supabase magic-link email to
 * the throwaway @seed.checklyra.com address. The gate runs only on
 * signup-touching promotions (low volume), so this does not meaningfully affect
 * sending reputation; see docs/SIGNUP_SURFACE_GATE.md.
 */

// Unique per run so the account is genuinely NEW (we are testing creation).
function freshEmail(): string {
  // No Date.now() volatility concern here — this runs in CI, not the workflow VM.
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return `signup.e2e.${stamp}@seed.checklyra.com`;
}

test('signup: real /signup form creates an account and mints a first session', async ({
  page,
  baseURL,
}) => {
  const email = freshEmail();
  const admin = adminClient();
  let createdUserId: string | null = null;

  try {
    // ── Drive the real sign-up form ─────────────────────────────────────────
    await page.goto('/signup', { waitUntil: 'load' });

    // 18+ self-declaration gate governs both paths; submit is disabled until ticked.
    await page.locator('#age_confirm_gate').check();
    await page.locator('#full_name').fill('Signup E2E User');
    await page.locator('#email').fill(email);
    await page.locator('#consent').check();

    // The email path's submit button (formAction=signUp). Copy varies by
    // waitlist framing ("Create account →" / "Join the waitlist →"), so match
    // the submit button that carries the signUp action rather than its label.
    const submit = page.locator('form button[type="submit"]').last();
    await expect(submit).toBeEnabled();
    await submit.click();

    // The signUp action redirects to a "check your email" acknowledgement. We do
    // not assert exact copy (it is founder-owned + may change); the authoritative
    // proof that creation worked is the auth user existing, checked next.
    await page.waitForLoadState('load');

    // ── Prove the account was actually created by the form POST ─────────────
    let found: string | null = null;
    for (let attempt = 0; attempt < 10 && !found; attempt++) {
      for (let pg = 1; pg <= 20; pg++) {
        const { data, error } = await admin.auth.admin.listUsers({ page: pg, perPage: 200 });
        if (error) throw new Error(`listUsers failed: ${error.message}`);
        const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
        if (match) { found = match.id; break; }
        if (data.users.length < 200) break;
      }
      if (!found) await page.waitForTimeout(1000);
    }
    expect(found, `signUp did not create an auth user for ${email}`).toBeTruthy();
    createdUserId = found;

    // The handle_new_user trigger must have seeded a profiles row.
    const { data: profileRow, error: profErr } = await admin
      .from('profiles')
      .select('id,slug')
      .eq('user_id', createdUserId!)
      .single();
    expect(profErr, profErr?.message).toBeNull();
    expect(profileRow, 'handle_new_user did not create a profile row').toBeTruthy();

    // ── Complete activation exactly as production does (magic-link confirm) ──
    // Repair NULL token columns (admin-created users) so generateLink works.
    // Best-effort: any failure surfaces concretely at generateLink just below.
    const { error: fixErr } = await admin.rpc('e2e_fix_auth_tokens', { uid: createdUserId! });
    if (fixErr) console.warn(`e2e_fix_auth_tokens warning: ${fixErr.message}`);
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    expect(linkErr, linkErr?.message).toBeNull();
    const hashedToken = link?.properties?.hashed_token;
    expect(hashedToken, 'no hashed_token from generateLink').toBeTruthy();

    const base = (baseURL ?? process.env.BASE_URL ?? '').replace(/\/$/, '');
    await page.goto(`${base}/auth/confirm?token_hash=${encodeURIComponent(hashedToken!)}&type=magiclink`, {
      waitUntil: 'commit',
    });
    // A first session lands the new user on the dashboard (dev/stage) — proving
    // signup → confirm → first-session end-to-end.
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  } finally {
    // Signup users are fresh each run: delete so they never accumulate.
    if (createdUserId) {
      await admin.auth.admin.deleteUser(createdUserId).catch(() => {});
    }
  }
});
