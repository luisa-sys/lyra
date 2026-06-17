/**
 * KAN-225 — Forgot/Reset password flow.
 *
 * Two layers:
 *
 *  1. **Behavioural** — `requestPasswordReset` and `updateRecoveryPassword`
 *     server actions, with Supabase Auth mocked. Confirms (a) the
 *     no-enumeration guarantee (always-same redirect), (b) the redirectTo
 *     URL points at /auth/callback?next=/reset-password, (c) password
 *     complexity check, (d) the post-update sign-out so the user
 *     re-authenticates with the new password.
 *
 *  2. **Static-grep regression guards** — pages exist, login has the
 *     "Forgot password?" link, auth/callback still handles the recovery
 *     redirect path. Same cheap-coverage pattern as KAN-181 / KAN-182.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

// ───────────── Mocks ─────────────

// `redirect` throws to short-circuit the rest of the action (Next.js
// convention). The mock captures the redirect URL so tests can assert
// on it.
class RedirectError extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT: ${url}`);
  }
}
const mockRedirect = jest.fn((url: string) => {
  throw new RedirectError(url);
});
jest.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}));

// env.siteUrl() is used to construct redirectTo for the recovery email.
jest.mock('@/lib/env', () => ({
  env: {
    siteUrl: () => 'https://dev.checklyra.com',
  },
}));

// next/headers is used by signInWithGoogle but not by the two actions
// we're testing — stub anyway so the import doesn't blow up.
jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue(new Map()),
}));

// Supabase Auth mock — covers resetPasswordForEmail, getUser, updateUser, signOut.
const mockResetPasswordForEmail = jest.fn().mockResolvedValue({ error: null });
const mockGetUser = jest.fn();
const mockUpdateUser = jest.fn().mockResolvedValue({ error: null });
const mockSignOut = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      resetPasswordForEmail: (
        email: string,
        opts: { redirectTo: string },
      ) => mockResetPasswordForEmail(email, opts),
      getUser: () => mockGetUser(),
      updateUser: (data: { password: string }) => mockUpdateUser(data),
      signOut: () => mockSignOut(),
    },
  }),
}));

import { requestPasswordReset, updateRecoveryPassword } from '@/app/(auth)/actions';

beforeEach(() => {
  mockRedirect.mockClear();
  mockResetPasswordForEmail.mockClear();
  mockGetUser.mockClear();
  mockUpdateUser.mockClear();
  mockSignOut.mockClear();
});

// Helper — call an action, catch the redirect, return the destination URL.
async function callAndCaptureRedirect(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof RedirectError) return err.url;
    throw err;
  }
  throw new Error('action did not redirect');
}

// ───────────── 1. requestPasswordReset behaviour ─────────────

describe('KAN-225: requestPasswordReset', () => {
  test('calls resetPasswordForEmail with the lowercased + trimmed email', async () => {
    const fd = new FormData();
    fd.set('email', '  USER@Example.com  ');
    await callAndCaptureRedirect(() => requestPasswordReset(fd));
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
      'user@example.com',
      expect.any(Object),
    );
  });

  test('redirectTo points at /auth/callback?next=/reset-password', async () => {
    const fd = new FormData();
    fd.set('email', 'user@example.com');
    await callAndCaptureRedirect(() => requestPasswordReset(fd));
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith(
      'user@example.com',
      expect.objectContaining({
        redirectTo: 'https://dev.checklyra.com/auth/callback?next=/reset-password',
      }),
    );
  });

  test('always redirects to the same generic message — no enumeration', async () => {
    const fd = new FormData();
    fd.set('email', 'user@example.com');
    const url = await callAndCaptureRedirect(() => requestPasswordReset(fd));
    expect(url).toMatch(/^\/forgot-password\?message=/);
    expect(decodeURIComponent(url)).toMatch(/if that email is registered/i);
  });

  test('same redirect even when Supabase signals an error (no enumeration on transport failure)', async () => {
    mockResetPasswordForEmail.mockResolvedValueOnce({
      error: { message: 'Email not found' },
    });
    const fd = new FormData();
    fd.set('email', 'maybe-real@example.com');
    const url = await callAndCaptureRedirect(() => requestPasswordReset(fd));
    expect(url).toMatch(/^\/forgot-password\?message=/);
    // Critically: no error path that leaks "Email not found"
    expect(url).not.toMatch(/error=/);
  });

  test('missing email redirects with error', async () => {
    const fd = new FormData();
    const url = await callAndCaptureRedirect(() => requestPasswordReset(fd));
    expect(url).toMatch(/^\/forgot-password\?error=/);
    expect(decodeURIComponent(url)).toMatch(/email is required/i);
    expect(mockResetPasswordForEmail).not.toHaveBeenCalled();
  });
});

// ───────────── 2. updateRecoveryPassword behaviour ─────────────

describe('KAN-225: updateRecoveryPassword', () => {
  function authenticatedSession() {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-id', email: 'user@example.com' } },
    });
  }

  function noSession() {
    mockGetUser.mockResolvedValue({ data: { user: null } });
  }

  test('redirects to /forgot-password when no recovery session', async () => {
    noSession();
    const fd = new FormData();
    fd.set('password', 'longenough123');
    fd.set('confirm_password', 'longenough123');
    const url = await callAndCaptureRedirect(() => updateRecoveryPassword(fd));
    expect(url).toMatch(/^\/forgot-password\?error=/);
    expect(decodeURIComponent(url)).toMatch(/reset link has expired/i);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  test('rejects passwords under 8 characters', async () => {
    authenticatedSession();
    const fd = new FormData();
    fd.set('password', '1234567');
    fd.set('confirm_password', '1234567');
    const url = await callAndCaptureRedirect(() => updateRecoveryPassword(fd));
    expect(url).toMatch(/^\/reset-password\?error=/);
    expect(decodeURIComponent(url)).toMatch(/at least 8 characters/i);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  test('rejects mismatched confirm', async () => {
    authenticatedSession();
    const fd = new FormData();
    fd.set('password', 'longenough123');
    fd.set('confirm_password', 'longenough124');
    const url = await callAndCaptureRedirect(() => updateRecoveryPassword(fd));
    expect(url).toMatch(/^\/reset-password\?error=/);
    expect(decodeURIComponent(url)).toMatch(/do not match/i);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  test('happy path: updates password, signs out, redirects to /login with success message', async () => {
    authenticatedSession();
    const fd = new FormData();
    fd.set('password', 'longenough123');
    fd.set('confirm_password', 'longenough123');
    const url = await callAndCaptureRedirect(() => updateRecoveryPassword(fd));
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'longenough123' });
    expect(mockSignOut).toHaveBeenCalled();
    expect(url).toMatch(/^\/login\?message=/);
    expect(decodeURIComponent(url)).toMatch(/password updated/i);
  });

  test('surfaces Supabase error on updateUser failure', async () => {
    authenticatedSession();
    mockUpdateUser.mockResolvedValueOnce({ error: { message: 'New password is too weak' } });
    const fd = new FormData();
    fd.set('password', 'longenough123');
    fd.set('confirm_password', 'longenough123');
    const url = await callAndCaptureRedirect(() => updateRecoveryPassword(fd));
    expect(url).toMatch(/^\/reset-password\?error=/);
    expect(decodeURIComponent(url)).toMatch(/too weak/i);
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});

// ───────────── 3. Static-grep regression guards ─────────────

describe('KAN-225: surface-area regression guards', () => {
  test('forgot-password page exists in the (auth) route group', () => {
    const p = resolve(ROOT, 'src/app/(auth)/forgot-password/page.tsx');
    expect(existsSync(p)).toBe(true);
    const src = readFileSync(p, 'utf-8');
    expect(src).toMatch(/requestPasswordReset/);
    // robots: no-index — recovery surfaces don't belong in search results
    expect(src).toMatch(/index:\s*false/);
  });

  test('reset-password page exists and guards against missing session', () => {
    const p = resolve(ROOT, 'src/app/(auth)/reset-password/page.tsx');
    expect(existsSync(p)).toBe(true);
    const src = readFileSync(p, 'utf-8');
    expect(src).toMatch(/updateRecoveryPassword/);
    // Redirects to /forgot-password when no session — the security gate
    expect(src).toMatch(/redirect\(\s*['"]\/forgot-password\?error=/);
    expect(src).toMatch(/index:\s*false/);
  });

  test('login page is passwordless: no password field or reset link, offers a magic-link', () => {
    // KAN-258: sign-in is passwordless — the login form emails a one-time
    // sign-in link, so there is no password field and (since there is no
    // password to reset) no "Forgot password?" link. The /forgot-password
    // and /reset-password routes remain in place but unlinked, pending a
    // follow-up that removes the vestigial password-reset flow.
    const src = readFileSync(
      resolve(ROOT, 'src/app/(auth)/login/page.tsx'),
      'utf-8',
    );
    expect(src).not.toMatch(/name=["']password["']/);
    expect(src).not.toMatch(/href=["']\/forgot-password["']/);
    expect(src).toMatch(/sign-in link/i);
  });

  test('login page surfaces the post-reset success message', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/(auth)/login/page.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/params\.message/);
  });

  test('auth/callback continues to handle the `next` query param (recovery redirect)', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/auth/callback/route.ts'),
      'utf-8',
    );
    // The recovery flow piggybacks on the existing callback behaviour:
    // resetPasswordForEmail redirectTo includes ?next=/reset-password and
    // the callback honours that param. This guard prevents a regression
    // where someone removes the `next` handling.
    expect(src).toMatch(/searchParams\.get\(['"]next['"]\)/);
    expect(src).toMatch(/exchangeCodeForSession/);
  });

  test('actions.ts exports both recovery actions', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/(auth)/actions.ts'),
      'utf-8',
    );
    expect(src).toMatch(/export async function requestPasswordReset/);
    expect(src).toMatch(/export async function updateRecoveryPassword/);
  });

  test('actions.ts uses Supabase-side rate limiting (no custom token table)', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/(auth)/actions.ts'),
      'utf-8',
    );
    // Critical: we lean on Supabase Auth for the email + token lifecycle.
    // No custom `password_reset_tokens` table like the Python predecessor.
    expect(src).toMatch(/resetPasswordForEmail/);
    expect(src).not.toMatch(/password_reset_tokens/);
  });
});
