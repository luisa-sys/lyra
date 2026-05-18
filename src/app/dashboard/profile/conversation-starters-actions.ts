'use server';

import { createClient } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { sanitiseText, type ActionResult } from '@/lib/sanitise';
import { moderateAndAudit } from '@/lib/moderation-audit';
import { checkProfileWriteRateLimit } from '@/lib/profile-rate-limit';

/**
 * KAN-181: server actions for `profile_conversation_starters`.
 *
 * Three rules baked into every action:
 *
 *  1. **Auth required.** No anonymous mutations.
 *  2. **Own profile only.** Each action joins `profiles` on
 *     `user_id = auth.uid()`. RLS enforces the same at the DB layer
 *     but the application checks too so error messages are useful.
 *  3. **Answer sanitised + length-capped.** `sanitiseText` strips HTML;
 *     length cap mirrors the DB CHECK (≤500 chars). Empty / whitespace-
 *     only answers rejected client- and server-side.
 *
 * The 5-answer cap is enforced by the DB trigger `pcs_cap`; we surface
 * it as a user-facing error instead of a raw Postgres exception.
 */

const ANSWER_MAX = 500;

interface AuthedRequest {
  supabase: Awaited<ReturnType<typeof createClient>>;
  profileId: string;
  userId: string;
}

async function getAuthedRequest(): Promise<AuthedRequest | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .single();
  if (!profile) return { error: 'No profile for current user' };
  return { supabase, profileId: profile.id as string, userId: user.id };
}

export async function addConversationStarter(input: {
  promptId: string;
  answer: string;
}): Promise<ActionResult> {
  const authed = await getAuthedRequest();
  if ('error' in authed) return { success: false, error: authed.error };
  const { supabase, profileId, userId } = authed;

  // KAN-231 — profile-save rate limiting.
  const rl = await checkProfileWriteRateLimit(userId);
  if (!rl.allowed) return rl.result;

  // UUID-ish sanity check on the prompt_id — DB will FK-validate either
  // way, but a clear application-level error is friendlier than a 22P02.
  if (typeof input.promptId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.promptId)) {
    return { success: false, error: 'Invalid prompt' };
  }

  const cleaned = sanitiseText(input.answer ?? '').slice(0, ANSWER_MAX);
  if (cleaned.trim().length === 0) {
    return { success: false, error: 'Answer cannot be empty' };
  }

  // KAN-241 + KAN-244 — content moderation + audit log.
  const mod = await moderateAndAudit(supabase, {
    text: cleaned,
    fieldType: 'public',
    field: 'profile_conversation_starters.answer',
    profileId,
    source: 'web_app',
  });
  if (!mod.ok) return { success: false, error: mod.error };

  const { error } = await supabase
    .from('profile_conversation_starters')
    .insert({
      profile_id: profileId,
      prompt_id: input.promptId,
      answer: cleaned,
    });

  if (error) {
    // The DB trigger raises a custom message for the 5-cap; surface it
    // verbatim so the UI can show a clean toast.
    if (error.message.includes('limit (5)')) {
      return { success: false, error: 'You can answer up to 5 prompts. Remove one to add another.' };
    }
    // 23505 = unique_violation on (profile_id, prompt_id)
    if (error.code === '23505') {
      return { success: false, error: 'You already answered this prompt — edit your existing answer instead.' };
    }
    return { success: false, error: error.message };
  }

  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function updateConversationStarter(
  id: string,
  answer: string,
): Promise<ActionResult> {
  const authed = await getAuthedRequest();
  if ('error' in authed) return { success: false, error: authed.error };
  const { supabase, profileId, userId } = authed;

  // KAN-231 — profile-save rate limiting.
  const rl = await checkProfileWriteRateLimit(userId);
  if (!rl.allowed) return rl.result;

  const cleaned = sanitiseText(answer ?? '').slice(0, ANSWER_MAX);
  if (cleaned.trim().length === 0) {
    return { success: false, error: 'Answer cannot be empty' };
  }

  // KAN-241 + KAN-244 — content moderation + audit, same as the add path.
  const mod = await moderateAndAudit(supabase, {
    text: cleaned,
    fieldType: 'public',
    field: 'profile_conversation_starters.answer',
    profileId,
    source: 'web_app',
  });
  if (!mod.ok) return { success: false, error: mod.error };

  const { error } = await supabase
    .from('profile_conversation_starters')
    .update({ answer: cleaned })
    .eq('id', id)
    .eq('profile_id', profileId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function removeConversationStarter(id: string): Promise<ActionResult> {
  const authed = await getAuthedRequest();
  if ('error' in authed) return { success: false, error: authed.error };
  const { supabase, profileId } = authed;

  const { error } = await supabase
    .from('profile_conversation_starters')
    .delete()
    .eq('id', id)
    .eq('profile_id', profileId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/dashboard/profile');
  return { success: true };
}
