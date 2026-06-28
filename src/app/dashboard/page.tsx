import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { signOut } from '../(auth)/actions';
import ShareProfile from './share-profile';
import ShareBeta from './share-beta';
import { betaInviteLink } from '@/lib/beta-access/invite-link';
import { isConveneEnabledForCurrentUser } from '@/lib/convene/flags-user';
import { canPublishWithAge } from '@/lib/age/gate';

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

  // KAN-303 — Convene nav + landing card are gated on the feature flag so they
  // stay hidden until Convene is enabled (beta).
  const conveneEnabled = await isConveneEnabledForCurrentUser();
  const isPublished = !!profile?.is_published;
  // KAN-326: publish-status hub — show the age step only when the gate blocks publishing.
  const needsAgeCheck = !canPublishWithAge(
    (profile as { age_status?: string | null } | null)?.age_status,
  );
  // KAN-337 — beta-invite deep-link to share (null unless LYRA_INVITE_CODE is set).
  const inviteLink = betaInviteLink();

  return (
    <main className="min-h-screen">
      <header className="border-b border-[var(--color-border)] bg-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center" aria-label="Lyra home">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" />
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-[var(--color-muted)]">
              {user.email}
            </span>
            {conveneEnabled && (
              <Link href="/dashboard/convene/gatherings" className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors">
                Convene
              </Link>
            )}
            <Link href="/dashboard/settings" className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors">
              Settings
            </Link>
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
        <div className="mb-6">
          <h2 className="text-2xl font-medium text-[var(--color-ink)]">
            Welcome{profile?.display_name ? `, ${profile.display_name}` : ''}
          </h2>
          <p className="text-[var(--color-muted)] mt-1">
            {isPublished
              ? 'Your profile is live — here’s your Lyra at a glance.'
              : 'A few steps to get your profile live.'}
          </p>
        </div>

        {/* KAN-326: next-steps hub — lead with what to do next while unpublished. */}
        {!isPublished && (
          <div className="bg-white rounded-xl border border-[var(--color-border)] p-6 mb-6">
            <h3 className="text-lg font-medium text-[var(--color-ink)] mb-4">Get your profile live</h3>
            <ol className="space-y-3">
              <li className="flex items-center justify-between gap-3">
                <span className="text-sm text-[var(--color-ink)]">
                  <span className="font-medium">1. Build your profile</span>
                  <span className="text-[var(--color-muted)]"> · {profile?.completion_score || 0}% complete</span>
                </span>
                <Link href="/dashboard/profile" className="shrink-0 px-4 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 transition-opacity">
                  Edit profile →
                </Link>
              </li>
              {needsAgeCheck && (
                <li className="flex items-center justify-between gap-3">
                  <span className="text-sm text-[var(--color-ink)]">
                    <span className="font-medium">2. Verify your age</span>
                    <span className="text-[var(--color-muted)]"> · required before publishing</span>
                  </span>
                  <Link href="/verify-age" className="shrink-0 px-4 py-2 rounded-lg bg-[#f4efe7] text-[var(--color-ink)] text-sm font-medium hover:bg-[#ece7df] transition-colors">
                    Verify age →
                  </Link>
                </li>
              )}
              <li className="flex items-center justify-between gap-3">
                <span className="text-sm text-[var(--color-ink)]">
                  <span className="font-medium">{needsAgeCheck ? '3' : '2'}. Publish</span>
                  <span className="text-[var(--color-muted)]"> · make your profile public</span>
                </span>
                <Link href="/dashboard/profile" className="shrink-0 px-4 py-2 rounded-lg bg-[#f4efe7] text-[var(--color-ink)] text-sm font-medium hover:bg-[#ece7df] transition-colors">
                  Open editor →
                </Link>
              </li>
            </ol>
          </div>
        )}

        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6">
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
                {profile?.slug ? `${(process.env.NEXT_PUBLIC_SITE_URL || 'https://checklyra.com').replace('https://', '')}/${profile.slug}` : 'Not set'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-muted)]">Status</span>
              <span className={isPublished ? 'text-green-600' : needsAgeCheck ? 'text-amber-600' : 'text-[var(--color-muted)]'}>
                {isPublished ? 'Public' : needsAgeCheck ? 'Age check' : 'Private'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-muted)]">Completion</span>
              <span className="text-[var(--color-ink)]">{profile?.completion_score || 0}%</span>
            </div>
          </div>

          {isPublished && (
            <Link href="/dashboard/profile" className="mt-6 block w-full py-3 rounded-lg bg-[#f4efe7] text-[var(--color-ink)] text-base font-medium hover:bg-[#ece7df] transition-colors text-center">
              Edit your profile →
            </Link>
          )}

          {/* KAN-154-B: shareable invite. Only shown once the profile has
              a slug — before that there's nothing to share, and the
              fallback CTA would just point at the public landing page. */}
          {profile?.slug && (
            <ShareProfile
              profileUrl={`${process.env.NEXT_PUBLIC_SITE_URL || 'https://checklyra.com'}/${profile.slug}`}
              displayName={profile.display_name}
              betaLink={inviteLink}
            />
          )}
        </div>

        {inviteLink && <ShareBeta inviteLink={inviteLink} />}

        {conveneEnabled && (
          <div className="bg-white rounded-xl border border-[var(--color-border)] p-6 mt-6">
            <h3 className="text-lg font-medium text-[var(--color-ink)] mb-1">Convene</h3>
            <p className="text-sm text-[var(--color-muted)] mb-4">
              Organise gatherings with the people in your life — pick a time that works, suggest a
              place, and send invites.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/dashboard/convene/gatherings"
                className="px-4 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Your gatherings
              </Link>
              <Link
                href="/dashboard/convene/contacts"
                className="px-4 py-2 rounded-lg bg-[#f4efe7] text-[var(--color-ink)] text-sm font-medium hover:bg-[#ece7df] transition-colors"
              >
                People
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
