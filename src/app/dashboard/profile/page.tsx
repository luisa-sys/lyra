import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import { ProfileWizard } from './wizard';
import type { ManualOfMe } from './manual-of-me-fields';

export const metadata = {
  title: 'Edit your profile — Lyra',
  description: 'Set up your Lyra profile so people in your life can get to know you better.',
};

const EMPTY_MANUAL_OF_ME: ManualOfMe = {
  communication_style: null,
  working_preferences: null,
  energises_me: null,
  drains_me: null,
};

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

  // KAN-154: Manual of Me is a 1-1 table. If the user has never saved it,
  // the row simply doesn't exist — render an empty form rather than failing.
  const { data: manualOfMeRow } = await supabase
    .from('profile_manual_of_me')
    .select('communication_style, working_preferences, energises_me, drains_me')
    .eq('profile_id', profile.id)
    .maybeSingle();

  // KAN-142: profile files (up to 10, fetched in display order).
  const { data: files } = await supabase
    .from('profile_files')
    .select('id, storage_path, file_name, mime_type, size_bytes, visibility')
    .eq('profile_id', profile.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  return (
    <ProfileWizard
      profile={profile}
      items={items || []}
      schools={schools || []}
      links={links || []}
      manualOfMe={(manualOfMeRow as ManualOfMe | null) ?? EMPTY_MANUAL_OF_ME}
      files={files || []}
    />
  );
}
