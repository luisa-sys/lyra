/**
 * 18+ self-declaration — replaces the Didit provider age check (KAN-282/KAN-319).
 *
 * Lyra is an adults-only (18+) service. Establishing that is now a plain
 * self-declaration at sign-up: the user must tick an explicit "I confirm I am
 * 18 or over" box before an account can be created, on BOTH the email and the
 * Google path. There is no provider check and no publish-time gate.
 *
 * This is an ATTESTATION, not a verification. Its value is that the 18+ rule
 * was put to the user plainly and they affirmed it, with a timestamp we can
 * evidence. Do not treat `age_declared_18_at` as proof of age, and do not build
 * a security control on it — a self-declaration is by construction something
 * any user can assert.
 *
 * Privacy: this stores no date of birth, no selfie, and no biometric. Removing
 * the provider check removed ALL Article 9 special-category processing from
 * Lyra (see docs/compliance/DPIA.md).
 */

/** Checkbox `name` on the sign-up form. Shared so the form and actions can't drift. */
export const AGE_DECLARATION_FIELD = 'age_confirm';

/**
 * The Google path has no sign-up form to carry the tick, so — exactly as
 * KAN-337 does for the beta-invite code — we drop it in a short-lived httpOnly
 * cookie before the OAuth redirect and read it back at the shared post-login
 * chokepoint. Scoped to one sign-up round trip.
 */
export const AGE_DECLARATION_COOKIE = 'lyra_age_18';
export const AGE_DECLARATION_COOKIE_MAX_AGE = 60 * 30; // 30 minutes

/** Shown when someone tries to sign up without ticking the box. */
export const AGE_DECLARATION_REQUIRED_MESSAGE =
  'Please confirm you are 18 or over to create a Lyra profile.';

/**
 * True ONLY for an explicitly ticked checkbox. Absent, blank, or any other
 * value → false, so a malformed or stripped field fails closed rather than
 * silently counting as a declaration.
 */
export function isAgeDeclared(value: FormDataEntryValue | null | undefined): boolean {
  return value === 'on' || value === 'true';
}
