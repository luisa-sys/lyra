/**
 * Auth error helpers. Lives outside the `'use server'` actions module so it can
 * export a plain (non-async) function and be unit-tested (BUGS-12 / gotcha #18).
 */

/**
 * Supabase enforces a short per-email resend cooldown and returns
 * "For security purposes, you can only request this after N seconds."
 * (code `over_email_send_rate_limit`). This only fires when a magic link was
 * ALREADY sent to that address moments ago — so rather than surfacing a
 * momentum-killing security scold, callers should treat it like success and
 * show the normal "check your email" message (the link is already on its way).
 */
export function isEmailResendCooldown(
  error: { message?: string; code?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === 'over_email_send_rate_limit') return true;
  return /for security purposes|only request this after/i.test(error.message ?? '');
}
