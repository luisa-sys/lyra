/**
 * OAuth client trust surface — SEC-76 (web-oauth-7), DCR anti-phishing.
 *
 * Dynamic Client Registration (RFC 7591) lets any party self-register an
 * OAuth client with an arbitrary client_name. A phishing client can register
 * as "Lyra Official"; the consent screen renders client_name verbatim, so the
 * user has no way to tell a look-alike apart from a real first-party app.
 *
 * These are pure helpers (no I/O) that drive the anti-phishing UI on
 * /oauth/authorize: a trust verdict (verified vs unverified) and the redirect
 * host the user would actually be returned to, so the destination is visible
 * before they click Allow. Kept in their own module so the logic is unit-
 * testable independently of the server-component render path.
 */

export interface ClientTrust {
  verified: boolean;
  /** Short label for the consent-screen badge. */
  label: string;
}

/**
 * A client is trusted only when an admin has explicitly marked it first-party.
 * Every DCR-registered client defaults to unverified. Fail closed: anything
 * other than a strict boolean `true` is treated as unverified.
 */
export function clientTrust(isFirstParty: unknown): ClientTrust {
  const verified = isFirstParty === true;
  return {
    verified,
    label: verified ? 'Verified app' : 'Unverified app',
  };
}

/**
 * The host (host[:port]) the user would be redirected back to. Surfaced on the
 * consent screen so a look-alike client cannot hide where the authorization
 * code is sent. Redirect URIs are validated upstream, but this must never
 * throw in a render path — fall back to the raw string if it cannot be parsed.
 */
export function redirectHost(redirectUri: string): string {
  try {
    return new URL(redirectUri).host;
  } catch {
    return redirectUri;
  }
}
