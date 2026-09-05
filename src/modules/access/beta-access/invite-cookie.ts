/**
 * KAN-337 — beta-invite deep-link cookie name + TTL.
 *
 * Kept in a leaf module with NO imports so the auth / sign-up paths
 * (resolvePostLoginRedirect, signUp, the /join route, the signup page) can
 * reference the cookie without pulling in the heavier beta-access/flow graph.
 * The link builder (betaInviteLink) lives in ./invite-link.
 */
export const INVITE_COOKIE = 'lyra_invite';
export const INVITE_COOKIE_MAX_AGE = 60 * 30; // 30 minutes
