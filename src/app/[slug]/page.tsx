import { createClient } from '@supabase/supabase-js';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';

// Use service role to read published profiles (no auth needed for public pages)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ProfileData {
  id: string;
  display_name: string;
  slug: string;
  headline: string | null;
  bio_short: string | null;
  city: string | null;
  country: string | null;
  is_published: boolean;
}

interface ProfileItem {
  id: string;
  category: string;
  title: string;
  description: string | null;
}

interface SchoolAffiliation {
  id: string;
  school_name: string;
  school_location: string | null;
  relationship: string;
}

interface ExternalLink {
  id: string;
  title: string;
  url: string;
  link_type: string;
}

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, headline, bio_short')
    .eq('slug', slug)
    .eq('is_published', true)
    .single();

  if (!profile) {
    return { title: 'Profile not found — Lyra' };
  }

  const description = profile.bio_short || profile.headline || `${profile.display_name}'s Lyra profile`;

  return {
    title: `${profile.display_name} — Lyra`,
    description,
    openGraph: {
      title: `${profile.display_name} — Lyra`,
      description,
      url: `https://checklyra.com/${slug}`,
      siteName: 'Lyra',
      type: 'profile',
    },
  };
}

export default async function PublicProfilePage({ params }: Props) {
  const { slug } = await params;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .single();

  if (!profile) {
    notFound();
  }

  const typedProfile = profile as ProfileData;

  const { data: items } = await supabase
    .from('profile_items')
    .select('*')
    .eq('profile_id', typedProfile.id)
    .eq('visibility', 'public')
    .order('created_at', { ascending: true });

  const { data: schools } = await supabase
    .from('school_affiliations')
    .select('*')
    .eq('profile_id', typedProfile.id);

  const { data: links } = await supabase
    .from('external_links')
    .select('*')
    .eq('profile_id', typedProfile.id);

  const typedItems = (items || []) as ProfileItem[];
  const typedSchools = (schools || []) as SchoolAffiliation[];
  const typedLinks = (links || []) as ExternalLink[];

  const categoryLabels: Record<string, string> = {
    likes: 'Likes',
    dislikes: 'Dislikes',
    gift_ideas: 'Gift ideas',
    gifts_to_avoid: 'Gifts to avoid',
    boundaries: 'Boundaries',
    helpful_to_know: 'Helpful to know',
  };

  const categoryIcons: Record<string, string> = {
    likes: '💚',
    dislikes: '💔',
    gift_ideas: '🎁',
    gifts_to_avoid: '🚫',
    boundaries: '🛑',
    helpful_to_know: '💡',
  };

  const groupedItems = typedItems.reduce((acc: Record<string, ProfileItem[]>, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  // Display order for categories
  const categoryOrder = ['likes', 'dislikes', 'gift_ideas', 'gifts_to_avoid', 'helpful_to_know', 'boundaries'];

  // JSON-LD structured data for AI consumption (Schema.org Person)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: typedProfile.display_name,
    url: `https://checklyra.com/${typedProfile.slug}`,
    ...(typedProfile.headline && { jobTitle: typedProfile.headline }),
    ...(typedProfile.bio_short && { description: typedProfile.bio_short }),
    ...(typedProfile.city && {
      address: {
        '@type': 'PostalAddress',
        addressLocality: typedProfile.city,
        addressCountry: typedProfile.country || 'GB',
      },
    }),
    ...(typedSchools.length > 0 && {
      alumniOf: typedSchools
        .filter((s) => s.relationship === 'alumni')
        .map((s) => ({
          '@type': 'EducationalOrganization',
          name: s.school_name,
          ...(s.school_location && { address: { '@type': 'PostalAddress', addressLocality: s.school_location } }),
        })),
    }),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="min-h-screen bg-stone-50">
      {/* Nav */}
      <nav className="border-b border-stone-200/60 bg-stone-50/80 backdrop-blur-md">
        <div className="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="font-[family-name:var(--font-serif)] text-xl text-[var(--color-ink)]">
            lyra
          </Link>
          <Link
            href="/signup"
            className="text-xs font-medium px-4 py-1.5 rounded-full bg-[var(--color-sage)] text-white hover:opacity-90 transition-opacity"
          >
            Create yours
          </Link>
        </div>
      </nav>

      {/* Profile header */}
      <div className="max-w-2xl mx-auto px-6 pt-10 pb-6 text-center">
        <div className="w-20 h-20 rounded-full bg-[var(--color-sage)] mx-auto mb-4 flex items-center justify-center text-3xl text-white font-[family-name:var(--font-serif)]">
          {typedProfile.display_name.charAt(0).toUpperCase()}
        </div>
        <h1 className="text-3xl font-[family-name:var(--font-serif)] text-[var(--color-ink)]">
          {typedProfile.display_name}
        </h1>
        {typedProfile.headline && (
          <p className="mt-2 text-[var(--color-muted)]">{typedProfile.headline}</p>
        )}
        {typedProfile.city && (
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {typedProfile.city}{typedProfile.country ? `, ${typedProfile.country}` : ''}
          </p>
        )}
      </div>

      {/* Bio */}
      {typedProfile.bio_short && (
        <div className="max-w-2xl mx-auto px-6 pb-6">
          <div className="bg-white rounded-xl border border-stone-200 p-5">
            <p className="text-[var(--color-ink)] leading-relaxed">{typedProfile.bio_short}</p>
          </div>
        </div>
      )}

      {/* Schools */}
      {typedSchools.length > 0 && (
        <div className="max-w-2xl mx-auto px-6 pb-6">
          <div className="bg-white rounded-xl border border-stone-200 p-5">
            <h2 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-3">🏫 Schools</h2>
            <div className="space-y-2">
              {typedSchools.map((s) => (
                <div key={s.id} className="flex items-baseline justify-between">
                  <span className="text-[var(--color-ink)] font-medium">{s.school_name}</span>
                  <span className="text-sm text-[var(--color-muted)]">{s.relationship}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Profile items by category */}
      {categoryOrder.map((cat) => {
        const catItems = groupedItems[cat];
        if (!catItems || catItems.length === 0) return null;
        return (
          <div key={cat} className="max-w-2xl mx-auto px-6 pb-6">
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <h2 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-3">
                {categoryIcons[cat]} {categoryLabels[cat]}
              </h2>
              <div className="flex flex-wrap gap-2">
                {catItems.map((item) => (
                  <div key={item.id} className="group relative">
                    <span className="inline-block px-3 py-1.5 bg-stone-50 border border-stone-200 rounded-full text-sm text-[var(--color-ink)]">
                      {item.title}
                    </span>
                    {item.description && (
                      <div className="hidden group-hover:block absolute bottom-full left-0 mb-1 px-3 py-2 bg-[var(--color-ink)] text-white text-xs rounded-lg max-w-xs z-10">
                        {item.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}

      {/* Links */}
      {typedLinks.length > 0 && (
        <div className="max-w-2xl mx-auto px-6 pb-6">
          <div className="bg-white rounded-xl border border-stone-200 p-5">
            <h2 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-3">🔗 Links</h2>
            <div className="space-y-2">
              {typedLinks.map((l) => (
                <a
                  key={l.id}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-stone-50 transition-colors group"
                >
                  <span className="text-[var(--color-ink)] group-hover:text-[var(--color-sage)]">{l.title}</span>
                  <span className="text-xs text-[var(--color-muted)]">↗</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="max-w-2xl mx-auto px-6 py-8 text-center">
        <p className="text-sm text-[var(--color-muted)]">
          This is a <Link href="/" className="text-[var(--color-sage)] hover:underline">Lyra</Link> profile
        </p>
      </div>
    </main>
    </>
  );
}
