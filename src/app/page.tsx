import Link from "next/link";
import Image from "next/image";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { isProdDeploy } from "@/lib/beta-access/flow";

/**
 * KAN-272 — minimal, Google-like homepage (June-2026 redesign).
 * KAN-273 follow-up — on the PUBLIC PRODUCTION deploy (checklyra.com), the
 * homepage is a "sign up → join the waitlist" front door instead of the full
 * product homepage: prod is the doorway into the gated beta app (KAN-278), so
 * the public should be greeted with the waitlist framing, not a browseable
 * directory. Beta/dev/stage keep the normal product homepage. Add
 * `?preview=waitlist` on any deploy to preview the prod landing.
 *
 * Product homepage (beta/dev/stage):
 *   1. A vertically-centred hero: the green Lyra logo, the tagline
 *      "Be understood.", and two CTAs (primary "Find someone", ghost
 *      "See example profiles").
 *   2. A bottom band — "A few people to meet" — showing up to 6 published
 *      profiles queried live from the database.
 *
 * The site-wide <Footer/> is rendered once in the root layout, so this page
 * deliberately has NO inline footer (no double-footer).
 */

// Render fresh so newly-published profiles appear without a redeploy, and so
// the prod/preview waitlist branch is evaluated per request.
export const dynamic = "force-dynamic";

interface HomeProfile {
  display_name: string;
  slug: string;
  headline: string | null;
  avatar_url: string | null;
}

function getSupabase() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey());
}

async function getPublishedProfiles(): Promise<HomeProfile[]> {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("profiles")
      .select("display_name, slug, headline, avatar_url")
      .eq("is_published", true)
      .order("updated_at", { ascending: false })
      .limit(6);
    return (data || []) as HomeProfile[];
  } catch {
    // The homepage must still render if the DB is briefly unreachable — the
    // "people to meet" band just won't appear. Never 500 the landing page.
    return [];
  }
}

function Nav({ minimal = false }: { minimal?: boolean }) {
  return (
    <nav
      aria-label="Main navigation"
      className="fixed top-0 left-0 right-0 z-50 bg-[var(--color-paper)]/85 backdrop-blur-md border-b border-[var(--color-border)]/60"
    >
      <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center" aria-label="Lyra home">
          <Image
            src="/lyra-logo.png"
            alt="Lyra"
            width={80}
            height={80}
            className="h-8 w-auto"
            priority
          />
        </Link>
        <div className="flex items-center gap-5 sm:gap-6">
          {!minimal && (
            <>
              <Link
                href="/"
                className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
              >
                Home
              </Link>
              <Link
                href="/search"
                className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
              >
                Find someone
              </Link>
              <Link
                href="/signup"
                className="text-sm text-[var(--color-sage)] hover:text-[var(--color-sage-hover)] transition-colors"
              >
                Create your profile
              </Link>
            </>
          )}
          {/* De-emphasised sign-in, per the mock-up. On the waitlist front door
              this is the only nav action (for already-approved users). */}
          <Link
            href="/login"
            className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    </nav>
  );
}

/**
 * Production front door (checklyra.com): "sign up → you're on the waitlist".
 * Prod is the public doorway into the gated beta app — signing up records the
 * request and routes the user to the beta waitlist (KAN-273/KAN-278). No
 * browseable directory or real profiles are surfaced here pre-launch.
 */
function WaitlistLanding() {
  return (
    <>
      <Nav minimal />
      <main role="main" className="px-6">
        <div className="max-w-2xl mx-auto">
          <section className="min-h-[80vh] flex flex-col items-center justify-center text-center pt-24 pb-12">
            <Image
              src="/lyra-logo.png"
              alt="Lyra"
              width={320}
              height={92}
              className="h-[92px] w-auto"
              priority
            />
            <p className="text-base sm:text-lg text-[var(--color-muted)] mt-4">
              Be understood.
            </p>
            <h1 className="text-2xl sm:text-[28px] font-medium text-[var(--color-ink)] font-[family-name:var(--font-serif)] mt-8 mb-4 leading-snug">
              We&rsquo;re opening Lyra a few people at a time.
            </h1>
            <p className="text-[15px] sm:text-base text-[var(--color-muted)] leading-relaxed max-w-md mb-8">
              Lyra is a calm place to share who you are &mdash; the things you
              love, the gifts that land, the boundaries that matter &mdash; with
              the people in your life. Join the waitlist and we&rsquo;ll email
              you the moment your spot opens up.
            </p>
            <Link
              href="/signup"
              className="px-6 py-3 rounded-[10px] bg-[var(--color-sage)] text-white font-semibold text-[15px] hover:bg-[var(--color-sage-hover)] transition-colors"
            >
              Join the waitlist
            </Link>
            <p className="text-[13px] text-[var(--color-muted)] mt-5">
              Already have access?{" "}
              <Link
                href="/login"
                className="text-[var(--color-sage)] hover:underline"
              >
                Sign in
              </Link>
            </p>
          </section>
        </div>
      </main>
    </>
  );
}

function PersonCard({ profile }: { profile: HomeProfile }) {
  return (
    <Link
      href={`/${profile.slug}`}
      className="flex items-center gap-3 bg-white border border-[var(--color-border)] rounded-xl px-4 py-3 hover:border-[var(--color-sage)] hover:shadow-sm transition-all group"
    >
      <div className="w-11 h-11 rounded-full bg-[var(--color-sage)] flex items-center justify-center text-white font-semibold shrink-0 overflow-hidden">
        {profile.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- KAN-272: avatar lives in Supabase Storage, not the Vercel image pipeline
          <img
            src={profile.avatar_url}
            alt={profile.display_name}
            className="w-full h-full object-cover"
          />
        ) : (
          profile.display_name.charAt(0).toUpperCase()
        )}
      </div>
      <div className="min-w-0">
        <span className="block font-medium text-[var(--color-ink)] group-hover:text-[var(--color-sage)] transition-colors truncate">
          {profile.display_name}
        </span>
        {profile.headline && (
          <span className="block text-[12.5px] text-[var(--color-muted)] truncate">
            {profile.headline}
          </span>
        )}
      </div>
    </Link>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string | string[] }>;
}) {
  // Prod (checklyra.com) is the public waitlist doorway. `?preview=waitlist`
  // renders it on any deploy so it can be verified before reaching prod.
  const sp = await searchParams;
  if (isProdDeploy() || sp?.preview === "waitlist") {
    return <WaitlistLanding />;
  }

  const people = await getPublishedProfiles();
  // Ghost CTA — "See example profiles" — points at the first published
  // profile when one exists, otherwise falls back to search.
  const exampleHref = people.length > 0 ? `/${people[0].slug}` : "/search";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Lyra",
    url: "https://checklyra.com",
    description:
      "A place to be understood — honest pages about people you already know, in their own words. For your offline life: no feed, no likes, no DMs.",
    potentialAction: {
      "@type": "SearchAction",
      target: "https://checklyra.com/{slug}",
      "query-input": "required name=slug",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Nav />
      <main role="main" className="px-6">
        <div className="max-w-3xl mx-auto">
          {/* Vertically-centred hero */}
          <section className="min-h-[62vh] flex flex-col items-center justify-center text-center pt-24 pb-10">
            <Image
              src="/lyra-logo.png"
              alt="Lyra"
              width={320}
              height={92}
              className="h-[92px] w-auto"
              priority
            />
            <p className="text-base sm:text-lg text-[var(--color-muted)] mt-4 mb-7">
              Be understood.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link
                href="/search"
                className="px-5 py-3 rounded-[10px] bg-[var(--color-sage)] text-white font-semibold text-[15px] hover:bg-[var(--color-sage-hover)] transition-colors"
              >
                Find someone
              </Link>
              <Link
                href={exampleHref}
                className="px-5 py-3 rounded-[10px] bg-white text-[var(--color-sage)] border border-[var(--color-border)] text-[15px] hover:border-[var(--color-sage)] transition-colors"
              >
                See example profiles
              </Link>
            </div>
          </section>

          {/* A few people to meet — up to 6 published profiles */}
          {people.length > 0 && (
            <section className="pb-20">
              <h2 className="text-lg font-semibold text-[var(--color-ink)] text-center mb-4">
                A few people to meet
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {people.map((p) => (
                  <PersonCard key={p.slug} profile={p} />
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
