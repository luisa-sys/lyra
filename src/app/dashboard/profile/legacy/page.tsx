import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import { ProfileWizard } from '../wizard';
import type { ManualOfMe } from '../manual-of-me-fields';

export const metadata = {
  title: 'Edit your profile (legacy) — Lyra',
  description: 'Step-by-step profile editor — kept for one release as a rollback path. The new single-page editor at /dashboard/profile is the default.',
  robots: { index: false, follow: false },
};

const EMPTY_MANUAL_OF_ME: ManualOfMe = {
  communication_style: null,
  working_preferences: null,
  energises_me: null,
  drains_me: null,
};

/**
 * KAN-220 — preserved legacy wizard route. The new single-page editor
 * at `/dashboard/profile` is the default; this route exists for one
 * release as a rollback path in case the new layout reveals a regression.
 *
 * Data fetching duplicated from `page.tsx` by design — see comment there.
 *
 * Will be removed in a follow-up after one stable release on prod.
 */
export default async function LegacyProfilePage() {
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
    .select('communication_style, working_preferences, energises_me, drains_me')
    .eq('profile_id', profile.id)
    .maybeSingle();

  const { data: files } = await supabase
    .from('profile_files')
    .select('id, storage_path, file_name, mime_type, size_bytes, visibility')
    .eq('profile_id', profile.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

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

  return (
    <ProfileWizard
      profile={profile}
      items={items || []}
      schools={schools || []}
      links={links || []}
      manualOfMe={(manualOfMeRow as ManualOfMe | null) ?? EMPTY_MANUAL_OF_ME}
      files={files || []}
      conversationPrompts={conversationPrompts || []}
      conversationAnswers={conversationAnswers}
    />
  );
}
