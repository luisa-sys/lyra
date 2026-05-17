'use server';

import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

import { env } from '@/lib/env';

function getSiteUrl() {
  return env.siteUrl();
}

export async function signUp(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const fullName = formData.get('full_name') as string;

  if (!email || !password || !fullName) {
    return redirect('/signup?error=' + encodeURIComponent('All fields are required'));
  }

  if (password.length < 6) {
    return redirect('/signup?error=' + encodeURIComponent('Password must be at least 6 characters'));
  }

  const siteUrl = getSiteUrl();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback`,
      data: {
        full_name: fullName,
      },
    },
  });

  if (error) {
    return redirect('/signup?error=' + encodeURIComponent(error.message));
  }

  return redirect('/signup?message=' + encodeURIComponent('Check your email to confirm your account'));
}

export async function signIn(formData: FormData) {
  const supabase = await createClient();

  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return redirect('/login?error=' + encodeURIComponent('Email and password are required'));
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return redirect('/login?error=' + encodeURIComponent(error.message));
  }

  return redirect('/dashboard');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return redirect('/');
}

/**
 * KAN-225 — request a password-reset email.
 *
 * Fires `supabase.auth.resetPasswordForEmail`; Supabase rate-limits per
 * address. We deliberately ALWAYS return the same redirect message
 * regardless of whether the email exists in `auth.users` — preventing
 * an account-enumeration attack where an attacker can fish for
 * registered emails by watching error vs. success responses.
 *
 * The email Supabase sends contains a recovery link to
 * `{siteUrl}/auth/callback?code=...&next=/reset-password`. The
 * existing callback exchanges the code for a (short-lived) recovery
 * session and redirects to /reset-password where the user sets a new
 * password.
 *
 * Site-URL allowlist note: `{siteUrl}/auth/callback` must be in
 * Supabase Auth → URL Configuration → Redirect URLs for each env
 * (dev / staging / prod). signUp already uses the same callback so
 * the allowlist entry should be in place; verify when this lands.
 */
export async function requestPasswordReset(formData: FormData) {
  const supabase = await createClient();
  const email = (formData.get('email') as string | null)?.toLowerCase().trim();

  if (!email) {
    return redirect('/forgot-password?error=' + encodeURIComponent('Email is required'));
  }

  const siteUrl = getSiteUrl();

  // Fire-and-forget on the result — we don't reveal whether the email
  // is registered. Errors are logged server-side only.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
  });

  // Same message whether the email exists or not (no enumeration).
  return redirect(
    '/forgot-password?message=' +
      encodeURIComponent(
        "If that email is registered, you'll receive a reset link shortly. Check your inbox (and the spam folder).",
      ),
  );
}

/**
 * KAN-225 — set a new password while in a recovery session.
 *
 * Called from the /reset-password form. The user is already
 * authenticated at this point — the callback has exchanged their
 * recovery code for a session. We sign them out after the update so
 * they have to re-authenticate with the new password (matches what
 * users expect after a password change, and invalidates the
 * recovery session).
 *
 * Server-side complexity floor: 8 chars (settings.updatePassword uses
 * 6; we strengthen here because reset is the higher-stakes flow).
 * Supabase's own minimum is 6, so 8 is the binding constraint.
 */
export async function updateRecoveryPassword(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return redirect(
      '/forgot-password?error=' +
        encodeURIComponent('Your reset link has expired. Please request a new one.'),
    );
  }

  const password = formData.get('password') as string | null;
  const confirmPassword = formData.get('confirm_password') as string | null;

  if (!password || password.length < 8) {
    return redirect(
      '/reset-password?error=' + encodeURIComponent('Password must be at least 8 characters'),
    );
  }
  if (password !== confirmPassword) {
    return redirect(
      '/reset-password?error=' + encodeURIComponent('Passwords do not match'),
    );
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return redirect('/reset-password?error=' + encodeURIComponent(error.message));
  }

  // Sign out to invalidate the recovery session and force a clean
  // re-authentication with the new password.
  await supabase.auth.signOut();
  return redirect(
    '/login?message=' +
      encodeURIComponent('Password updated. Please sign in with your new password.'),
  );
}

export async function signInWithGoogle() {
  const supabase = await createClient();
  const requestHeaders = await headers();
  const origin = requestHeaders.get('origin') || getSiteUrl();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    return redirect('/login?error=' + encodeURIComponent(error.message));
  }

  if (data.url) {
    return redirect(data.url);
  }
}

// Apple Sign-In deferred — no Apple Developer account. See KAN-37.
// export async function signInWithApple() {
//   const supabase = await createClient();
//   const requestHeaders = await headers();
//   const origin = requestHeaders.get('origin') || getSiteUrl();
//
//   const { data, error } = await supabase.auth.signInWithOAuth({
//     provider: 'apple',
//     options: {
//       redirectTo: `${origin}/auth/callback`,
//     },
//   });
//
//   if (error) {
//     return redirect('/login?error=' + encodeURIComponent(error.message));
//   }
//
//   if (data.url) {
//     return redirect(data.url);
//   }
// }
