'use server';

import { createClient } from '@/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { sanitiseText, type ActionResult } from '@/lib/sanitise';
import { moderateAndAudit } from '@/lib/moderation-audit';
import { checkProfileWriteRateLimit } from '@/lib/profile-rate-limit';
import { ANSWER_MAX, CUSTOM_PROMPT_MAX } from './conversation-starters-fields';
import { dbErrorFor } from '@/lib/db-error-copy';

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
 * The answer cap is enforced by the DB trigger `pcs_cap`; we surface
 * it as a user-facing error instead of a raw Postgres exception.
 *
 * KAN-445 — a row is now EITHER a seeded prompt (`prompt_id`) OR a question
 * the member wrote themselves (`custom_prompt`), never both and never
 * neither. The database enforces that with `pcs_prompt_source_xor`; these
 * actions enforce it first so the member gets a sentence rather than a 23514.
 *
 * A member-written question renders on the PUBLIC profile exactly like a
 * seeded one, so it goes through the same `sanitiseText` + `moderateAndAudit`
 * pipeline as the answer. Sanitising only the answer would leave the question
 * as an unmoderated public text field.
 *
 * ⚠️ `custom_prompt` is a column added by 20260803160000, and code reaches an
 * environment before its migration runs. PostgREST builds the INSERT/UPDATE
 * column list from the payload KEYS, so sending `custom_prompt: null` against
 * a database that lacks the column fails the WHOLE request with PGRST204 —
 * the value being null does not save you. Every write below therefore adds the
 * key ONLY when there is something to write. `npm run type-check` cannot catch
 * this: `src/lib/supabase-server.ts` builds an untyped client. Pinned by
 * `tests/unit/conversation-starters-custom-prompts.test.ts`.
 */

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

/*
 * `capErrorCopy` lived here until BUGS-87. It moved to
 * src/lib/db-error-copy.ts, where its matchers were ANCHORED per trigger.
 * The generic `/limit \(\d+\) reached/` it used was safe while it was
 * local to this file and became a bug the moment it was shared: it also
 * matches 'Profile file limit (10) reached'. See that module's header.
 */

/**
 * Validate + clean the question a member wrote themselves.
 *
 * Returns the cleaned text, or an error string. Kept separate from the answer
 * so both the add and the update path use identical rules — the sibling-drift
 * shape that BUGS-74 and the eight suspension-guard tickets all share.
 */
function cleanCustomPrompt(raw: string): { text: string } | { error: string } {
  const cleaned = sanitiseText(raw ?? '').slice(0, CUSTOM_PROMPT_MAX);
  if (cleaned.trim().length === 0) {
    return { error: 'Your question cannot be empty' };
  }
  return { text: cleaned };
}

export async function addConversationStarter(input: {
  promptId?: string;
  customPrompt?: string;
  answer: string;
}): Promise<ActionResult> {
  const authed = await getAuthedRequest();
  if ('error' in authed) return { success: false, error: authed.error };
  const { supabase, profileId, userId } = authed;

  // KAN-231 — profile-save rate limiting.
  const rl = await checkProfileWriteRateLimit(userId);
  if (!rl.allowed) return rl.result;

  // KAN-445 — mirror the DB's `pcs_prompt_source_xor`: a seeded prompt or a
  // question of your own, never both and never neither.
  const hasPromptId = typeof input.promptId === 'string' && input.promptId.length > 0;
  const hasCustom = typeof input.customPrompt === 'string' && input.customPrompt.trim().length > 0;
  if (hasPromptId === hasCustom) {
    return { success: false, error: 'Choose a prompt, or write a question of your own' };
  }

  // UUID-ish sanity check on the prompt_id — DB will FK-validate either
  // way, but a clear application-level error is friendlier than a 22P02.
  if (hasPromptId && !/^[0-9a-f-]{36}$/i.test(input.promptId as string)) {
    return { success: false, error: 'Invalid prompt' };
  }

  let customPrompt: string | null = null;
  if (hasCustom) {
    const res = cleanCustomPrompt(input.customPrompt as string);
    if ('error' in res) return { success: false, error: res.error };
    customPrompt = res.text;
  }

  const cleaned = sanitiseText(input.answer ?? '').slice(0, ANSWER_MAX);
  if (cleaned.trim().length === 0) {
    return { success: false, error: 'Answer cannot be empty' };
  }

  // KAN-241 + KAN-244 — content moderation + audit log. A member-written
  // question is public text too, so it is moderated alongside the answer.
  const mod = await moderateAndAudit(supabase, {
    text: customPrompt ? `${customPrompt}\n${cleaned}` : cleaned,
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
      answer: cleaned,
      // Spread-when-present, NOT `?? null`: a key for a column that does not
      // exist yet fails the whole request with PGRST204 even when its value is
      // null (see the module header).
      ...(hasPromptId ? { prompt_id: input.promptId } : {}),
      ...(customPrompt ? { custom_prompt: customPrompt } : {}),
    });

  if (error) {
    // BUGS-87: the cap messages and 23505 (unique_violation on
    // profile_id+prompt_id) both live in src/lib/db-error-copy.ts now, so the
    // add and update paths cannot drift apart — the sibling-drift shape this
    // module's header warns about, previously reproduced right here.
    return { success: false, error: dbErrorFor('add-conversation-starter', error) };
  }

  revalidatePath('/dashboard/profile');
  return { success: true };
}

export async function updateConversationStarter(
  id: string,
  answer: string,
  customPrompt?: string,
): Promise<ActionResult> {
  const authed = await getAuthedRequest();
  if ('error' in authed) return { success: false, error: authed.error };
  const { supabase, profileId, userId } = authed;

  // KAN-231 — profile-save rate limiting.
  const rl = await checkProfileWriteRateLimit(userId);
  if (!rl.allowed) return rl.result;

  // KAN-445 — `undefined` means "the caller did not edit the question", which
  // must leave the column ALONE. Coercing it to null here would blank a
  // member's own question every time they edited only the answer — BUGS-74's
  // exact shape, on a column that is half of an XOR check.
  let cleanedPrompt: string | null = null;
  if (customPrompt !== undefined) {
    const res = cleanCustomPrompt(customPrompt);
    if ('error' in res) return { success: false, error: res.error };
    cleanedPrompt = res.text;
  }

  const cleaned = sanitiseText(answer ?? '').slice(0, ANSWER_MAX);
  if (cleaned.trim().length === 0) {
    return { success: false, error: 'Answer cannot be empty' };
  }

  // KAN-241 + KAN-244 — content moderation + audit, same as the add path.
  const mod = await moderateAndAudit(supabase, {
    text: cleanedPrompt ? `${cleanedPrompt}\n${cleaned}` : cleaned,
    fieldType: 'public',
    field: 'profile_conversation_starters.answer',
    profileId,
    source: 'web_app',
  });
  if (!mod.ok) return { success: false, error: mod.error };

  const { error } = await supabase
    .from('profile_conversation_starters')
    .update({
      answer: cleaned,
      // Same PGRST204 rule as the insert: the key exists only when there is a
      // value for it.
      ...(cleanedPrompt ? { custom_prompt: cleanedPrompt } : {}),
    })
    .eq('id', id)
    .eq('profile_id', profileId);

  if (error) {
    return { success: false, error: dbErrorFor('update-conversation-starter', error) };
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
    return { success: false, error: dbErrorFor('remove-conversation-starter', error) };
  }

  revalidatePath('/dashboard/profile');
  return { success: true };
}
