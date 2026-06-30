import { createClient } from '@/lib/supabase-server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { signOut } from '../(auth)/actions';
import ShareBeta from './share-beta';
import DashboardWidgets, { type WidgetContext } from './widgets/dashboard-widgets';
import { betaInviteLink, publicSignupUrl } from '@/lib/beta-access/invite-link';
import { isConveneEnabledForCurrentUser } from '@/lib/convene/flags-user';
import { canPublishWithAge } from '@/lib/age/gate';
import { resolveWidgets, resolveOnboardingState } from '@/lib/dashboard/resolve-widgets';
import { dismissedForState, type DashboardWidgetState } from '@/lib/dashboard/dismissal';

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

  // KAN-344/346 — onboarding-progress signals → the status-driven widget journey.
  const profileId = (profile as { id?: string } | null)?.id;
  let hasGifts = false;
  let hasAffiliations = false;
  if (profileId) {
    const [gifts, affs] = await Promise.all([
      supabase
        .from('profile_items')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', profileId)
        .eq('category', 'gift_ideas'),
      supabase
        .from('school_affiliations')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', profileId),
    ]);
    hasGifts = (gifts.count ?? 0) > 0;
    hasAffiliations = (affs.count ?? 0) > 0;
  }
  const completionScore = Number(
    (profile as { completion_score?: number } | null)?.completion_score ?? 0,
  );
  const storedDismissals =
    (profile as { dashboard_widget_state?: DashboardWidgetState } | null)?.dashboard_widget_state ?? {};
  const onboardingState = resolveOnboardingState({
    isPublished,
    completionScore,
    hasGifts,
    hasAffiliations,
  });
  const widgetResolution = resolveWidgets({
    isPublished,
    completionScore,
    hasGifts,
    hasAffiliations,
    conveneEntitled: conveneEnabled,
    dismissed: dismissedForState(storedDismissals, onboardingState),
  });
  const widgetCtx: WidgetContext = {
    state: widgetResolution.state,
    completionScore,
    canPublishAge: !needsAgeCheck,
    profileUrl: profile?.slug
      ? `${process.env.NEXT_PUBLIC_SITE_URL || 'https://checklyra.com'}/${profile.slug}`
      : null,
    displayName: profile?.display_name ?? null,
    betaLink: inviteLink,
    signupUrl: publicSignupUrl(),
  };

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

        {/* KAN-340/346 — status-driven widget journey (replaces the KAN-326 next-steps hub).
            One primary CTA in empty/drafted; a gifts/affiliations/share/convene stack once published. */}
        <DashboardWidgets resolution={widgetResolution} ctx={widgetCtx} />

        <div className="bg-white rounded-xl border border-[var(--color-border)] p-6 mt-6">
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
          {/* Profile-sharing moved to the "Share your profile" widget (W5); Convene
              moved to the Convene widget (W6); both rendered by DashboardWidgets above. */}
        </div>

        {/* KAN-337/349 — beta-invite share. Once published it lives in the W5 widget;
            before publishing, show it here too so beta users can invite friends straight
            away (no duplication — W5's share only appears in the published states). */}
        {inviteLink && !isPublished && <ShareBeta inviteLink={inviteLink} />}
      </div>
    </main>
  );
}
