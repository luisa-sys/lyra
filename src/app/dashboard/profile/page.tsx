import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import { EditProfileForm } from './edit-profile-form';
import type { ManualOfMe } from './manual-of-me-fields';
import { MANUAL_OF_ME_FIELDS } from './manual-of-me-fields';
import { isConveneEnabledForCurrentUser } from '@/lib/convene/flags-user';
import { getRecommendations } from '@/lib/recommend';
import { keyForRecommendation } from '@/lib/recommend/dismissals';
import type { GiftSuggestionView } from './sections';

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
 * KAN-220 — single-page profile editor. Replaces the 14-step wizard,
 * which is preserved one route over at `/dashboard/profile/legacy` for
 * one release as a rollback path. Data fetching duplicated across both
 * routes by design (small price for keeping each route independent —
 * also matches `conversation_starter_prompts` / `profile_conversation_starters`
 * regression guard in `tests/unit/conversation-starters.test.ts`).
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
    .order('created_at', { ascending: true });

  const { data: schools } = await supabase
    .from('school_affiliations')
    .select('*')
    .eq('profile_id', profile.id);

  const { data: links } = await supabase
    .from('external_links')
    .select('*')
    .eq('profile_id', profile.id);

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
    .select('id, prompt, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  const { data: starterRows } = await supabase
    .from('profile_conversation_starters')
    .select('id, prompt_id, answer, prompt:conversation_starter_prompts!profile_conversation_starters_prompt_id_fkey(prompt)')
    .eq('profile_id', profile.id)
    .order('created_at', { ascending: true });
  const conversationAnswers = (starterRows ?? []).map((r) => {
    // Supabase typegen sometimes flattens the joined row to an object,
    // sometimes to an array — handle both shapes.
    const promptCandidate = r.prompt as unknown;
    const joinedPrompt = Array.isArray(promptCandidate)
      ? ((promptCandidate[0] as { prompt: string } | undefined)?.prompt ?? '')
      : ((promptCandidate as { prompt: string } | null)?.prompt ?? '');
    return {
      id: r.id as string,
      prompt_id: r.prompt_id as string,
      answer: r.answer as string,
      prompt: joinedPrompt,
    };
  });

  // KAN-443 — the auto-generated gift suggestions, so the member can say "not
  // for me" to any of them. `getRecommendations` is pure and runs over data
  // this page has already loaded, so this costs no extra query. The limit
  // matches the public profile's concept window, so what the member curates
  // here is what visitors are offered.
  //
  // `gift_suggestion_dismissals` is created by
  // 20260803170000_kan443_gift_redesign.sql, and code reaches an environment
  // before its migration does. Only `data` is read (as every other read on this
  // page does), so a not-yet-migrated environment degrades to "nothing
  // dismissed" — the member sees every suggestion — rather than failing to
  // render their editor.
  const { data: dismissalRows } = await supabase
    .from('gift_suggestion_dismissals')
    .select('suggestion_key')
    .eq('profile_id', profile.id);
  const dismissedKeys = new Set(
    ((dismissalRows ?? []) as { suggestion_key: string }[]).map((r) => r.suggestion_key),
  );

  const giftSuggestions: GiftSuggestionView[] = getRecommendations(
    {
      bio: profile.bio_short,
      headline: profile.headline,
      items: (items ?? []).map((i) => ({
        category: i.category,
        title: i.title,
        description: i.description,
      })),
    },
    { limit: 8 },
  ).map((r) => {
    const key = keyForRecommendation(r);
    return { key, title: r.title, description: r.description, dismissed: dismissedKeys.has(key) };
  });

  return (
    <EditProfileForm
      profile={profile}
      giftSuggestions={giftSuggestions}
      items={items || []}
      schools={schools || []}
      links={links || []}
      manualOfMe={(manualOfMeRow as ManualOfMe | null) ?? EMPTY_MANUAL_OF_ME}
      conversationPrompts={conversationPrompts || []}
      conversationAnswers={conversationAnswers}
      conveneEnabled={await isConveneEnabledForCurrentUser()}
    />
  );
}
