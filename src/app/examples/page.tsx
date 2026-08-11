import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createServiceRoleClient } from "@/modules/platform/supabase-service";
import { isProdDeploy } from "@/lib/beta-access/flow";

/**
 * "See example profiles" gallery.
 *
 * The homepage hero's ghost CTA ("See example profiles") points here. This page
 * lists EVERY curated example profile (the "A few people to meet" band on the
 * homepage only shows the first 6) so a visitor can browse the full set of
 * demo profiles and see what a finished Lyra profile looks like.
 *
 * Like the homepage band, this is gated to `is_homepage_example` profiles only
 * — a DB-trigger-enforced allowlist restricted to @seed.checklyra.com demo
 * accounts (KAN-334), so no real user (incl. Ben/Luisa) can ever appear here.
 *
 * Prod front-door parity (KAN-273): on the real production deploy
 * (checklyra.com) the public site is the waitlist doorway and deliberately
 * surfaces NO browseable directory, so this page redirects home there — exactly
 * as the homepage renders the waitlist landing instead of the product home.
 * Beta/dev/stage (where isProdDeploy() is false) show the full gallery. To lift
 * this once prod launches publicly, remove the redirect guard below.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Example profiles — Lyra",
  description:
    "Browse example Lyra profiles — honest pages about people, in their own words. See what a finished profile looks like before you create your own.",
};

interface ExampleProfile {
  id: string;
  display_name: string;
  slug: string;
  headline: string | null;
  city: string | null;
  country: string | null;
  avatar_url: string | null;
}

function getSupabase() {
  // KAN-352: the service-role client must come from the one hardened factory.
  return createServiceRoleClient();
}

async function getExampleProfiles(): Promise<ExampleProfile[]> {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      // SEC-104: the view carries the published + not-suspended predicate, so a
      // service-role read (which bypasses RLS) is still constrained.
      .from("public_profiles")
      .select("id, display_name, slug, headline, city, country, avatar_url")
      .eq("is_homepage_example", true)
      .order("homepage_example_order", { ascending: true })
      .limit(60);
    return (data || []) as ExampleProfile[];
  } catch {
    // The page must still render if the DB is briefly unreachable — the grid
    // just shows the empty state rather than 500-ing.
    return [];
  }
}

function ProfileCard({ profile }: { profile: ExampleProfile }) {
  return (
    <Link
      href={`/${profile.slug}`}
      className="block bg-white rounded-xl border border-[var(--color-border)] p-5 hover:shadow-sm hover:border-[var(--color-sage)] transition-all group"
    >
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-full bg-[var(--color-sage)] flex items-center justify-center text-lg text-white font-[family-name:var(--font-serif)] shrink-0 overflow-hidden">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- KAN-410: avatar lives in Supabase Storage, not the Vercel image pipeline
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
          <h3 className="font-medium text-[var(--color-ink)] group-hover:text-[var(--color-sage)] transition-colors truncate">
            {profile.display_name}
          </h3>
          {profile.headline && (
            <p className="text-sm text-[var(--color-muted)] mt-0.5 line-clamp-2">
              {profile.headline}
            </p>
          )}
          {profile.city && (
            <p className="text-xs text-[var(--color-muted)] mt-1">
              {profile.city}
              {profile.country ? `, ${profile.country}` : ""}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

export default async function ExamplesPage() {
  // Prod (checklyra.com) is the public waitlist doorway — no browseable
  // directory pre-launch. LYRA_FORCE_WAITLIST lets a non-prod env mirror that.
  if (isProdDeploy() || process.env.LYRA_FORCE_WAITLIST === "true") {
    redirect("/");
  }

  const people = await getExampleProfiles();

  return (
    <main className="min-h-screen bg-[var(--color-paper)]">
      {/* Nav — matches the /search public page */}
      <nav
        aria-label="Examples navigation"
        className="border-b border-[var(--color-border)]/60 bg-[var(--color-paper)]/80 backdrop-blur-md"
      >
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center" aria-label="Lyra home">
            <Image
              src="/lyra-logo.png"
              alt="Lyra"
              width={32}
              height={32}
              className="h-8 w-auto"
              priority
            />
          </Link>
          <Link
            href="/signup"
            className="text-xs font-medium px-4 py-1.5 rounded-full bg-[var(--color-sage)] text-white hover:opacity-90 transition-opacity"
          >
            Create yours
          </Link>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 pt-10 pb-16">
        <h1 className="text-3xl font-[family-name:var(--font-serif)] text-[var(--color-ink)] mb-2">
          Example profiles
        </h1>
        <p className="text-[var(--color-muted)] mb-8 max-w-xl">
          A few example profiles to show what Lyra looks like &mdash; honest
          pages about people, in their own words. Open any one to see the whole
          thing.
        </p>

        {people.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {people.map((p) => (
              <ProfileCard key={p.id} profile={p} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="text-4xl mb-4">👤</p>
            <h3 className="text-lg font-medium text-[var(--color-ink)] mb-2">
              No example profiles yet
            </h3>
            <p className="text-sm text-[var(--color-muted)]">
              Check back soon.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
