import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import { signOut } from '../(auth)/actions';

export const metadata = {
  title: 'Dashboard — Lyra',
  description: 'Manage your Lyra profile.',
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch the user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single();

  return (
    <main className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="font-[family-name:var(--font-serif)] text-xl text-[var(--color-ink)]">
            Lyra
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-[var(--color-muted)]">
              {user.email}
            </span>
            <form>
              <button
                formAction={signOut}
                className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">
        <h2 className="text-2xl font-medium text-[var(--color-ink)] mb-2">
          Welcome{profile?.display_name ? `, ${profile.display_name}` : ''}
        </h2>
        <p className="text-[var(--color-muted)] mb-8">
          {profile?.onboarding_complete
            ? 'Manage your Lyra profile below.'
            : 'Let\u2019s set up your profile so people in your life can get to know you better.'}
        </p>

        <div className="bg-white rounded-xl border border-stone-200 p-6">
          <h3 className="text-lg font-medium text-[var(--color-ink)] mb-4">
            Your profile
          </h3>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--color-muted)]">Display name</span>
              <span className="text-[var(--color-ink)]">{profile?.display_name || 'Not set'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-muted)]">Profile URL</span>
              <span className="text-[var(--color-ink)]">
                {profile?.slug ? `checklyra.com/${profile.slug}` : 'Not set'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-muted)]">Status</span>
              <span className={profile?.is_published ? 'text-green-600' : 'text-amber-600'}>
                {profile?.is_published ? 'Published' : 'Draft'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-muted)]">Completion</span>
              <span className="text-[var(--color-ink)]">{profile?.completion_score || 0}%</span>
            </div>
          </div>

          {!profile?.onboarding_complete && (
            <button className="mt-6 w-full py-2.5 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 transition-opacity">
              Complete your profile
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
