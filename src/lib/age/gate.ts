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

export function isAgeVerificationRequired(e: NodeJS.ProcessEnv = process.env): boolean {
  return e.AGE_VERIFICATION_REQUIRED === 'true';
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
