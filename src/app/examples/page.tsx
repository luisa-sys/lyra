import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { isProdDeploy } from "@/lib/beta-access/flow";

/**
 * BUGS-67 — "See example profiles" gallery.
 *
 * The homepage ghost CTA "See example profiles" used to jump straight to the
 * FIRST example profile (`/${people[0].slug}`), so a visitor who wanted to
 * browse the examples only ever saw one person. This page is the real
 * destination: EVERY curated example profile, as a grid of cards, so people
 * can pick the ones they want to explore.
 *
 * Same curation rule as the homepage band (KAN-334): only
 * `is_homepage_example = true` published profiles — a DB-trigger-enforced
 * allowlist of @seed.checklyra.com demo accounts — ever appear here, never a
 * real user. Unlike the homepage band this page is NOT capped at 6: it shows
 * the whole curated set.
 *
 * Prod parity: checklyra.com is the gated waitlist doorway (KAN-273/278) with
 * no browseable directory, so on the prod-family deploy this route redirects to
 * the homepage (which itself renders the waitlist landing), exactly like the
 * homepage showcase is hidden there.
 */

// Render fresh so newly-curated examples appear without a redeploy, and so the
// prod redirect is evaluated per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Example profiles — Lyra",
  description:
    "Browse example Lyra profiles. See what an honest page about a person looks like, then pick any to explore.",
};

interface ExampleProfile {
  display_name: string;
  slug: string;
  headline: string | null;
  avatar_url: string | null;
}

function getSupabase() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey());
}

async function getExampleProfiles(): Promise<ExampleProfile[]> {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("profiles")
      .select("display_name, slug, headline, avatar_url")
      .eq("is_published", true)
      .eq("is_homepage_example", true)
      .order("homepage_example_order", { ascending: true })
      .limit(60);
    return (data || []) as ExampleProfile[];
  } catch {
    // Never 500 the gallery if the DB is briefly unreachable — render the empty
    // state instead.
    return [];
  }
}

function ExampleCard({ profile }: { profile: ExampleProfile }) {
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

export default async function ExamplesPage() {
  // Prod (checklyra.com) is the waitlist doorway — no browseable directory.
  // Mirror the homepage's own guard so /examples is a beta/dev/stage feature.
  if (isProdDeploy() || process.env.LYRA_FORCE_WAITLIST === "true") {
    redirect("/");
  }

  const people = await getExampleProfiles();

  return (
    <main role="main" className="min-h-screen bg-[var(--color-paper)]">
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
        <p className="text-[var(--color-muted)] mb-8">
          A few example pages so you can see what Lyra looks like. Pick anyone to
          explore their profile.
        </p>

        {people.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {people.map((p) => (
              <ExampleCard key={p.slug} profile={p} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="text-4xl mb-4">👤</p>
            <h2 className="text-lg font-medium text-[var(--color-ink)] mb-2">
              No example profiles yet
            </h2>
            <p className="text-sm text-[var(--color-muted)]">
              Check back soon — or{" "}
              <Link href="/search" className="text-[var(--color-sage)] hover:underline">
                find someone
              </Link>
              .
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
