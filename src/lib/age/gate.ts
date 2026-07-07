/**
 * KAN-319 / KAN-255 / KAN-282: age-verification publish gate (framework).
 *
 * Environment-wide switch `AGE_VERIFICATION_REQUIRED`. When 'true', a profile
 * may only be PUBLISHED if its `age_status === 'passed'`. Off (default) → no
 * gate. Used in conjunction with admin unpublish: flip the switch on → unpublish
 * unverified profiles → they can still edit (private) but cannot re-publish
 * until verified.
 *
 * NOTE: the Didit hosted selfie flow that actually moves a user to 'passed'
 * ships as the immediate follow-up (KAN-282). This module is the enforcement
 * framework + the env switch; until the flow exists, only an admin override
 * sets 'passed'. Enforcement over the MCP publish tool is part of the MCP
 * follow-up (KAN-317).
 */
export type AgeStatus = 'none' | 'pending' | 'passed' | 'failed' | 'manual_review';

/**
 * KAN-404: reversible age-gate PAUSE flag (TEST-ONLY, SECURITY-SENSITIVE).
 *
 * TEMPORARY TEST FLAG. Defaults to enabled/re-gated. Never set
 * AGE_GATE_PAUSED=true on prod. Unset before any real user traffic.
 *
 * Fail-safe by construction: paused ONLY on the exact string 'true'. Any
 * absence, typo, empty string, or other value → NOT paused (gate stays on).
 * This is the single chokepoint — because `isAgeVerificationRequired` consults
 * it, every downstream consumer (publishProfile, the `is_published` field
 * update path, the dashboard, /verify-age, admin) inherits the pause with no
 * per-site edits.
 */
export function isAgeGatePaused(e: NodeJS.ProcessEnv = process.env): boolean {
  return e.AGE_GATE_PAUSED === 'true';
}

export function isAgeVerificationRequired(e: NodeJS.ProcessEnv = process.env): boolean {
  return e.AGE_VERIFICATION_REQUIRED === 'true' && !isAgeGatePaused(e);
}

/**
 * Whether a profile with the given age_status may publish under the current
 * environment switch. Pure — env passed in for testability.
 */
export function canPublishWithAge(
  ageStatus: AgeStatus | string | null | undefined,
  e: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isAgeVerificationRequired(e)) return true;
  return ageStatus === 'passed';
}

/** User-facing reason shown when publishing is blocked by the age gate. */
export const AGE_GATE_BLOCK_MESSAGE =
  'You need to verify your age before publishing your profile. Visit /verify-age to continue.';
