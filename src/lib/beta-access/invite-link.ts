/**
 * KAN-337 — shareable beta-invite deep-link.
 *
 * A beta user shares `https://checklyra.com/join?code=<INVITE_CODE>`. The /join
 * route validates the code and stows it in a short-lived httpOnly cookie so the
 * secret survives the Google-OAuth round-trip (resolveBetaAccess reads it on the
 * callback); the email magic-link path also carries it in user_metadata. Either
 * way the code is re-validated server-side before any grant — possessing the
 * link is the authorisation, and it only ever grants BETA.
 */
import { env } from '@/lib/env';
import { isProdFamily } from '@/lib/beta-access/flow';

export { INVITE_COOKIE, INVITE_COOKIE_MAX_AGE } from './invite-cookie';

/** Pure: build the public /join link for a given origin + code. */
export function buildBetaInviteLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/join?code=${encodeURIComponent(code)}`;
}

/**
 * The public beta-invite link to surface on the dashboard, or null when the
 * feature is off (no LYRA_INVITE_CODE). Invitees always sign up at the public
 * front door — checklyra.com on the prod family (beta + prod share it), or the
 * env's own origin on dev/stage.
 */
export function betaInviteLink(): string | null {
  const code = env.inviteCode();
  if (!code) return null;
  const origin = isProdFamily() ? 'https://checklyra.com' : env.siteUrl();
  return buildBetaInviteLink(origin, code);
}
