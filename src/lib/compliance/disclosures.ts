/**
 * KAN-408: which feature-gated legal disclosures are ACTIVE for this environment.
 *
 * The public privacy / cookie policies disclose a third-party processor only
 * when the feature that uses it is enabled here, driven by the admin GLOBAL
 * feature-switch table. Currently this gates the affiliate (Sovrn) disclosure on
 * the `paid_gift_links` switch:
 *   - paid referrals off (or its default) → omit the Sovrn affiliate disclosure
 *   - paid referrals on                    → show it
 *
 * NOTE on age verification: the provider (Didit) disclosure is deliberately NOT
 * served from here. develop's baseline (KAN-407) is a self-declaration with no
 * provider check, and the compliance-locking privacy test asserts the policy
 * makes no provider/biometric claim. Re-introducing that disclosure when the
 * `age_verification` switch is ON requires reworking that locked test — tracked
 * as a compliance follow-up (needs sign-off), so it's out of scope here.
 *
 * Safe by construction: the underlying read (getGlobalSwitches) fails safe to
 * each key's default, so a DB hiccup falls back to the default disclosure state.
 */
import { getGlobalSwitches } from '@/lib/features/global-switches-service';
import { getDeployEnv } from '@/modules/platform/deploy-env';
import type { GlobalFeatureKey } from '@/lib/features/global-features';

export interface DisclosureFlags {
  /** Sovrn affiliate / paid-referral disclosures. */
  affiliate: boolean;
}

/** Pure: global-switch state (the admin table) → which disclosures are active. */
export function disclosuresFromSwitches(
  sw: Record<GlobalFeatureKey, boolean>,
): DisclosureFlags {
  return {
    affiliate: sw.paid_gift_links,
  };
}

/** Active disclosures for the current environment (reads the global switch table). */
export async function getActiveDisclosures(): Promise<DisclosureFlags> {
  return disclosuresFromSwitches(await getGlobalSwitches(getDeployEnv()));
}
