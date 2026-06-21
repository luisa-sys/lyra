'use server';

/**
 * SEC-18 (F-07) — opt-in toggle for sharing calendar busy-times with contacts.
 *
 * Default is OFF (deny). When a user turns this on, hosts who have them as a
 * linked contact can see their busy/free windows (never event details) when
 * organising. The MCP availability tool reads
 * profiles.share_availability_with_contacts (paired SEC-18 change).
 */

import { createClient } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';

export async function setAvailabilitySharing(
  enabled: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('profiles')
    .update({ share_availability_with_contacts: enabled })
    .eq('user_id', user.id);
  if (error) return { ok: false, error: 'Could not update your sharing preference' };

  revalidatePath('/dashboard/convene/connections');
  return { ok: true };
}
