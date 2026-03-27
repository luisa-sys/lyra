import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import { ProfileWizard } from './wizard';

export const metadata = {
  title: 'Edit your profile — Lyra',
  description: 'Set up your Lyra profile so people in your life can get to know you better.',
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

  return (
    <ProfileWizard
      profile={profile}
      items={items || []}
      schools={schools || []}
      links={links || []}
    />
  );
}
