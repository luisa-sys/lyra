/**
 * KAN-408: provider age-verification gate, keyed on the global switch.
 *
 * Background: KAN-407 replaced the provider (Didit) age check with an 18+
 * self-declaration at sign-up and deleted the old env-var gate (`gate.ts`). This
 * module reintroduces the provider check as an OPT-IN, environment-scoped
 * capability: it is active only where the `age_verification` global switch is ON
 * (default OFF). The self-declaration remains the always-on baseline; when the
 * switch is ON we ALSO require a passed provider check before a profile may
 * publish.
 *
 * The Didit machinery (didit.ts, age-service.ts, /verify-age, the webhook, the
 * `age_status` column) was retained by KAN-407 — this is only the gate that
 * decides whether it is enforced.
 */
import { isFeatureGloballyEnabled } from '@/lib/features/global-switches-service';

export type AgeStatus = 'none' | 'pending' | 'passed' | 'failed' | 'manual_review';

/**
 * Is provider (Didit) age verification active in this environment? True iff the
 * `age_verification` global switch is ON. Async (reads the switch table);
 * fail-safe to the switch default (OFF) on a read error.
 */
export async function isProviderAgeCheckActive(): Promise<boolean> {
  return isFeatureGloballyEnabled('age_verification');
}

/** Pure: with the provider check active, only `age_status='passed'` may publish. */
export function passedProviderAgeCheck(
  ageStatus: AgeStatus | string | null | undefined,
): boolean {
  return ageStatus === 'passed';
}

/** User-facing reason shown when publishing is blocked by the provider age gate. */
export const AGE_GATE_BLOCK_MESSAGE =
  'You need to verify your age before publishing your profile. Visit /verify-age to continue.';
