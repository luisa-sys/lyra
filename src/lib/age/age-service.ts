/**
 * KAN-282: service-role writes for age verification.
 *
 * age_status is admin/service-role-only (the prevent_beta_self_elevation trigger
 * blocks user-context writes), so the Didit webhook + callback persist results
 * through the service client. We store ONLY the status + provider reference +
 * timestamp — never a DOB, selfie, or raw biometric.
 */
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { AgeStatusResult } from './didit';

function serviceClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

/** Persist a verification outcome onto a profile (idempotent for a given session). */
export async function setProfileAgeStatus(
  profileId: string,
  status: AgeStatusResult,
  sessionRef: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!profileId) return { ok: false, error: 'missing profile id' };
  const svc = serviceClient();
  const { error } = await svc
    .from('profiles')
    .update({
      age_status: status,
      age_checked_at: new Date().toISOString(),
      age_provider: 'didit',
      age_provider_ref: sessionRef,
    })
    .eq('id', profileId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Resolve the current user's profile id (service-role; used by the verify flow). */
export async function profileIdForUser(userId: string): Promise<string | null> {
  if (!userId) return null;
  const svc = serviceClient();
  const { data } = await svc.from('profiles').select('id').eq('user_id', userId).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/** Confirm a vendor_data value is a real profile id (webhook safety). */
export async function profileExists(profileId: string): Promise<boolean> {
  if (!profileId) return false;
  const svc = serviceClient();
  const { data } = await svc.from('profiles').select('id').eq('id', profileId).maybeSingle();
  return Boolean((data as { id?: string } | null)?.id);
}
