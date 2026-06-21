/**
 * KAN-309 follow-on: service-role entitlement reads (no next/headers).
 *
 * Kept separate from entitlements.ts (which imports the cookie client) so the
 * affiliate link service and other service-role code paths can check
 * entitlements without pulling request-scoped APIs into their module graph.
 *
 * SERVICE-ROLE — bypasses RLS. Use only for cross-user checks where the viewer
 * is not the subject (paid gift links gate on the RECIPIENT; recommendation
 * reads are anonymous) and from admin/server-only code.
 */
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { resolveEntitlements, type FeatureKey } from './registry';

function serviceClient() {
  return createServiceClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

/** Any profile's full entitlement map (service-role; bypasses RLS). */
export async function getProfileEntitlements(
  profileId: string,
): Promise<Record<FeatureKey, boolean>> {
  if (!profileId) return resolveEntitlements([]);
  const svc = serviceClient();
  const { data } = await svc
    .from('feature_entitlements')
    .select('feature_key, enabled')
    .eq('profile_id', profileId);
  return resolveEntitlements(data ?? []);
}

/** Cross-user single-feature check (service-role). */
export async function isFeatureEnabledByProfile(
  profileId: string,
  key: FeatureKey,
): Promise<boolean> {
  return (await getProfileEntitlements(profileId))[key];
}

/** Single-feature check keyed by auth user id (resolves the profile first). */
export async function isFeatureEnabledByUserId(
  userId: string,
  key: FeatureKey,
): Promise<boolean> {
  if (!userId) return false;
  const svc = serviceClient();
  const { data: profile } = await svc
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!profile?.id) return false;
  return isFeatureEnabledByProfile(profile.id as string, key);
}

/**
 * Compliance precondition for paid affiliate links (KAN-192 FTC/ASA/CMA
 * disclosure + KAN-193 cookie/GDPR consent). Until disclosure ships, monetised
 * links must not be produced even for entitled recipients. Default: NOT ready.
 */
export function isPaidLinksComplianceReady(): boolean {
  return process.env.PAID_LINKS_COMPLIANCE_READY === 'true';
}

/**
 * The full paid-gift-links gate for a recipient profile:
 *   recipient entitled  AND  affiliate disclosure/consent shipped.
 * (SOVRN_API_KEY — the network switch — is still checked deeper, in trySovrn.)
 * Fail-closed: no recipient id → not allowed.
 */
export async function isPaidLinksAllowedForRecipient(
  recipientId: string | null | undefined,
): Promise<boolean> {
  if (!recipientId) return false;
  if (!isPaidLinksComplianceReady()) return false;
  return isFeatureEnabledByProfile(recipientId, 'paid_gift_links');
}
