/**
 * KAN-272 — Cloudflare Turnstile human-check helper.
 *
 * Turnstile is a privacy-friendly CAPTCHA alternative. It is wired into the
 * Contact form (the only public, unauthenticated form that reaches the team),
 * but it ACTIVATES ONLY when BOTH keys are provisioned:
 *
 *   - NEXT_PUBLIC_TURNSTILE_SITE_KEY  (public — rendered in the browser widget)
 *   - TURNSTILE_SECRET_KEY            (server-only — used to verify the token)
 *
 * When either is absent, the check degrades gracefully: the widget is not
 * rendered and `verifyTurnstile` returns ok=true (skip), so the form still
 * works in dev / preview / any env where the keys aren't set. Keys are read
 * from the environment — never hardcoded.
 */

/** True only when both the public site key and the secret key are present. */
export function isTurnstileEnabled(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY &&
    !!process.env.TURNSTILE_SECRET_KEY
  );
}

/** The public site key, or null when not configured. Safe to send to the client. */
export function turnstileSiteKey(): string | null {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null;
}

export type TurnstileResult =
  | { ok: true; skipped?: boolean }
  | { ok: false; reason: "missing_token" | "failed" | "error" };

const VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Turnstile token server-side. When Turnstile isn't configured this
 * returns `{ ok: true, skipped: true }` so callers don't have to special-case
 * the disabled path — the gate simply isn't enforced.
 *
 * @param token   the `cf-turnstile-response` value submitted with the form
 * @param remoteIp optional caller IP for Cloudflare's records
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string | null,
): Promise<TurnstileResult> {
  if (!isTurnstileEnabled()) {
    // Not provisioned — degrade gracefully, don't block the form.
    return { ok: true, skipped: true };
  }
  if (!token) {
    return { ok: false, reason: "missing_token" };
  }

  const secret = process.env.TURNSTILE_SECRET_KEY as string;
  const body = new URLSearchParams();
  body.append("secret", secret);
  body.append("response", token);
  if (remoteIp) body.append("remoteip", remoteIp);

  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body });
    if (!res.ok) return { ok: false, reason: "error" };
    const data = (await res.json()) as { success?: boolean };
    return data.success ? { ok: true } : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "error" };
  }
}
