import { createClient } from '@/modules/platform/supabase-server';
import { redirect } from 'next/navigation';
import { EditProfileForm } from './edit-profile-form';
import type { ManualOfMe } from '@/modules/profile/manual-of-me-fields';
import { MANUAL_OF_ME_FIELDS } from '@/modules/profile/manual-of-me-fields';
import { isConveneEnabledForCurrentUser } from '@/lib/convene/flags-user';
import { env } from '@/modules/platform/env';

export const metadata = {
  title: 'Edit your profile — Lyra',
  description: 'Set up your Lyra profile so people in your life can get to know you better.',
};

const EMPTY_MANUAL_OF_ME: ManualOfMe = {
  communication_style: null,
  working_preferences: null,
  energises_me: null,
  drains_me: null,
  good_to_know: null,
  boundaries: null,
};

/**
 * KAN-220 — single-page profile editor. Replaced the 14-step wizard, which
 * was kept at `/dashboard/profile/legacy` as a rollback path until KAN-487
 * part 3 deleted it (2026-11-23). The reads stay inline here (they match the
 * `conversation_starter_prompts` / `profile_conversation_starters`
 * regression guard in `tests/unit/conversation-starters.test.ts`).
 *
 * KAN-487 (spec v0.8; plan §A "Loader changes") — the v0.8 editor holds all
 * edits client-side and saves them in one `save_profile` call, so the loader
 * only reads what the ten sections show:
 *   - no external-links read (the Links section is retired from the editor;
 *     stored links stay in the database, untouched);
 *   - no KAN-443 gift-suggestion block (the dismissals read and the
 *     recommender call) — §03's AI slot replaces it (step 6);
 *   - items in their stored order (`sort_order`, then `created_at`);
 *   - affiliations in the order they were added (`created_at`);
 *   - each answer carries `sort_order` / `created_at` so custom questions
 *     keep the member's order.
 * KAN-489: `aiGiftsConfigured` (ANTHROPIC_API_KEY set, as a boolean) turns on
 * the §03 AI suggestion controls; without it the slot says they aren't
 * available yet.
 * The profile row is read with `*`, so `slug_confirmed`, `first_published_at`,
 * `billboard` and `updated_at` reach the editor, and items carry `origin` /
 * `approved` (AI suggestions are kept apart from the member's own gifts).
 */
export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');

  const { data: items } = await supabase
    .from('profile_items')
    .select('*')
    .eq('profile_id', profile.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  const { data: schools } = await supabase
    .from('school_affiliations')
    .select('*')
    .eq('profile_id', profile.id)
    .order('created_at', { ascending: true });

  const { data: manualOfMeRow } = await supabase
    .from('profile_manual_of_me')
    // BUGS-74: this select MUST cover every field in MANUAL_OF_ME_FIELDS.
    // It previously listed only the four v1 columns, so the two KAN-263 fields
    // (good_to_know, boundaries) were never loaded — the editor rendered them
    // empty and the section's whole-draft autosave then wrote NULL over saved
    // member text. Derive it from the allowlist so it can never drift again.
    .select(MANUAL_OF_ME_FIELDS.join(', '))
    .eq('profile_id', profile.id)
    .maybeSingle();

  const { data: conversationPrompts } = await supabase
    .from('conversation_starter_prompts')
    .select('*') // KAN-484: `*` so a DB without `answer_max` yet does not 42703 the editor
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  const { data: starterRows } = await supabase
    .from('profile_conversation_starters')
    // KAN-445: `*` rather than a column list, deliberately. `custom_prompt`
    // arrives with migration 20260803160000, and code reaches an environment
    // before its migration runs — PostgREST rejects the WHOLE query with 42703
    // if a named column is absent, which would blank the profile editor. `*`
    // returns the column once it exists and simply omits it before then.
    .select('*, prompt:conversation_starter_prompts!profile_conversation_starters_prompt_id_fkey(*)')
    .eq('profile_id', profile.id)
    .order('created_at', { ascending: true });
  const conversationAnswers = (starterRows ?? []).map((r) => {
    // Supabase typegen sometimes flattens the joined row to an object,
    // sometimes to an array — handle both shapes.
    const promptCandidate = r.prompt as unknown;
    const joinedRow = (Array.isArray(promptCandidate)
      ? (promptCandidate[0] as { prompt?: string; answer_max?: number | null } | undefined)
      : (promptCandidate as { prompt?: string; answer_max?: number | null } | null)) ?? null;
    const joinedPrompt = joinedRow?.prompt ?? '';
    const customPrompt = (r.custom_prompt as string | null | undefined) ?? null;
    return {
      id: r.id as string,
      prompt_id: (r.prompt_id as string | null) ?? null,
      answer: r.answer as string,
      // A member-written question IS the question shown above the answer.
      prompt: customPrompt ?? joinedPrompt,
      custom_prompt: customPrompt,
      answer_max: customPrompt ? null : (joinedRow?.answer_max ?? null),
      // KAN-487: custom questions keep the member's order (§09 Move up/down).
      // Passed through as read — absent columns stay absent, not null.
      sort_order: r.sort_order as number | null | undefined,
      created_at: r.created_at as string | null | undefined,
    };
  });

  return (
    <EditProfileForm
      profile={profile}
      items={items || []}
      schools={schools || []}
      manualOfMe={(manualOfMeRow as ManualOfMe | null) ?? EMPTY_MANUAL_OF_ME}
      conversationPrompts={conversationPrompts || []}
      conversationAnswers={conversationAnswers}
      conveneEnabled={await isConveneEnabledForCurrentUser()}
      // KAN-489: a boolean only — the key itself never leaves the server.
      aiGiftsConfigured={env.aiGiftsConfigured()}
    />
  );
}
