'use server';

import { createClient } from '@/lib/supabase-server';
import { getAdminServiceClient } from '@/lib/admin';
import { getAccountStanding, shouldRefuseIssuance } from '@/lib/account-status';
import { redirect } from 'next/navigation';
import { randomBytes, createHash } from 'crypto';
import * as Sentry from '@sentry/nextjs';

// SEC-75 leg (b): external systems that may still hold a copy of a deleted
// user's data after the Postgres cascade runs. On deletion we RECORD (not call)
// an erasure obligation naming these so an ops follow-up — which holds the KV /
// processor write credentials — can action and close each one. Not exported:
// a 'use server' file may only export async functions (BUGS-12 / gotcha #18).
const ERASURE_PROCESSORS = ['cloudflare_kv_waitlist', 'resend', 'didit', 'google'];

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function exportUserData(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return JSON.stringify({ error: 'Not authenticated' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (!profile) return JSON.stringify({ error: 'Profile not found' });

  const { data: items } = await supabase
    .from('profile_items')
    .select('*')
    .eq('profile_id', profile.id);

  const { data: schools } = await supabase
    .from('school_affiliations')
    .select('*')
    .eq('profile_id', profile.id);

  const { data: links } = await supabase
    .from('external_links')
    .select('*')
    .eq('profile_id', profile.id);

  const { data: apiKeys } = await supabase
    .from('api_keys')
    .select('id, key_prefix, name, created_at, last_used_at, revoked_at')
    .eq('user_id', user.id);

  return JSON.stringify({
    exported_at: new Date().toISOString(),
    account: { email: user.email, created_at: user.created_at },
    profile,
    items: items || [],
    schools: schools || [],
    links: links || [],
    api_keys: apiKeys || [],
  }, null, 2);
}

export async function deleteAccount() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  const userId = user.id;

  // True erasure (GDPR). Hard-delete the auth user with the service-role
  // client: profiles.user_id -> auth.users(id) is ON DELETE CASCADE, and
  // every profile-owned table cascades from profiles(id), so this removes
  // ALL of the person's data in one step — profile, items, links, schools,
  // files, manual-of-me, conversation starters, moderation reports, api
  // keys, oauth tokens, convene rows. (The previous version only deleted
  // the profile and left the auth user, and their email, behind.)
  const admin = getAdminServiceClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    // The only expected failure is an account with non-deletable audit
    // rows (a moderator's moderation_logs are ON DELETE RESTRICT). Don't
    // half-delete anything — leave the account intact and ask them to
    // contact us.
    return redirect(
      '/dashboard/settings?error=' +
        encodeURIComponent(
          "We couldn't delete your account automatically. Please contact us and we'll remove it for you.",
        ),
    );
  }

  // SEC-75 leg (b): the auth cascade erased everything in Postgres, but copies
  // may persist in external processors (Resend/Didit/Google) and Cloudflare KV
  // (waitlist email). Record a durable erasure obligation for an ops follow-up
  // to action. Best-effort: a logging failure must NOT block the user's erasure
  // right — capture it to Sentry so the missed obligation is still surfaced.
  try {
    const { error: obligationError } = await admin.rpc('record_erasure_obligation', {
      p_subject_user_id: userId,
      p_subject_email: user.email ?? null,
      p_processors: ERASURE_PROCESSORS,
      p_notes: 'Account hard-deleted; external processor / KV copies pending erasure (SEC-75 leg b).',
    });
    if (obligationError) {
      Sentry.captureException(new Error(`record_erasure_obligation failed: ${obligationError.message}`), {
        tags: { area: 'erasure-obligation', ticket: 'SEC-75' },
      });
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { area: 'erasure-obligation', ticket: 'SEC-75' } });
  }

  // Best-effort: remove now-orphaned storage objects (the DB cascade
  // doesn't touch storage). Non-fatal — the account and all rows are gone.
  for (const bucket of ['profile-photos', 'profile-files']) {
    try {
      const { data: files } = await admin.storage.from(bucket).list(userId);
      if (files?.length) {
        await admin.storage.from(bucket).remove(files.map((f) => `${userId}/${f.name}`));
      }
    } catch {
      // ignore — orphaned-object cleanup isn't worth failing the flow
    }
  }

  // Clear the now-invalid session cookie and send them home.
  await supabase.auth.signOut();
  redirect('/');
}

export async function generateApiKey(name: string = 'Default'): Promise<{ key?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // SEC-57: refuse to mint credentials for a suspended (or unverifiable)
  // account. Fail closed — a suspended user must not be able to obtain a new
  // MCP API key even if they reach this action directly (the middleware
  // redirect that normally catches them fails open on a lookup error).
  const standing = await getAccountStanding(supabase, user.id);
  if (shouldRefuseIssuance(standing)) {
    return { error: 'Your account is suspended. API keys cannot be generated.' };
  }

  // Generate a secure random API key
  const rawKey = `lyra_${randomBytes(24).toString('base64url')}`;
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.substring(0, 12);

  const { error } = await supabase.from('api_keys').insert({
    user_id: user.id,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    name,
  });

  if (error) return { error: error.message };

  // Return the raw key — this is the ONLY time it's visible
  return { key: rawKey };
}

export async function listApiKeys(): Promise<{ keys?: Array<{ id: string; key_prefix: string; name: string; created_at: string; last_used_at: string | null }>; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, key_prefix, name, created_at, last_used_at')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  if (error) return { error: error.message };
  return { keys: data || [] };
}

export async function revokeApiKey(keyId: string): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('user_id', user.id);

  if (error) return { error: error.message };
  return { success: true };
}

export async function updateEmail(newEmail: string): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { error } = await supabase.auth.updateUser({
    email: newEmail,
  });

  if (error) return { error: error.message };
  return { success: true };
}

export async function updatePassword(currentPassword: string, newPassword: string): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  if (newPassword.length < 6) return { error: 'New password must be at least 6 characters' };

  // Verify current password by re-authenticating
  if (user.email) {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (signInError) return { error: 'Current password is incorrect' };
  }

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) return { error: error.message };
  return { success: true };
}
