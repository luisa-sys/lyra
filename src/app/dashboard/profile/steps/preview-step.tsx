'use client';

import { SaveButton, type WizardProfile, type WizardItem, type WizardSchool, type WizardLink } from './types';

export function PreviewStep({ profile, items, schools, links, onPublish, isPending }: {
  profile: WizardProfile; items: WizardItem[]; schools: WizardSchool[];
  links: WizardLink[]; onPublish: () => void; isPending: boolean;
}) {
  const categoryLabels: Record<string, string> = {
    likes: 'Likes', dislikes: 'Dislikes',
    gift_ideas: 'Gift ideas', gifts_to_avoid: 'Gifts to avoid',
    boundaries: 'Boundaries', helpful_to_know: 'Helpful to know',
  };

  const groupedItems = items.reduce((acc: Record<string, WizardItem[]>, item: WizardItem) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-ink)]">Preview your profile</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">This is how people will see you on Lyra.</p>
      </div>
      <div className="bg-white rounded-xl border border-stone-200 p-6 space-y-6">
        <div className="text-center">
          <h3 className="text-2xl font-[family-name:var(--font-serif)] text-[var(--color-ink)]">{profile.display_name}</h3>
          {profile.headline && <p className="text-sm text-[var(--color-muted)] mt-1">{profile.headline}</p>}
          {profile.city && <p className="text-xs text-[var(--color-muted)]">{profile.city}{profile.country ? `, ${profile.country}` : ''}</p>}
        </div>
        {profile.bio_short && (
          <p className="text-sm text-[var(--color-ink)] text-center">{profile.bio_short}</p>
        )}
        {schools.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-2">Schools</h4>
            <div className="space-y-1">
              {schools.map((s: WizardSchool) => (
                <p key={s.id} className="text-sm text-[var(--color-ink)]">{s.school_name} <span className="text-[var(--color-muted)]">({s.relationship})</span></p>
              ))}
            </div>
          </div>
        )}
        {Object.entries(groupedItems).map(([cat, catItems]: [string, WizardItem[]]) => (
          <div key={cat}>
            <h4 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-2">{categoryLabels[cat] || cat}</h4>
            <div className="flex flex-wrap gap-2">
              {catItems.map((item: WizardItem) => (
                <span key={item.id} className="inline-block px-3 py-1 bg-stone-100 rounded-full text-sm text-[var(--color-ink)]">
                  {item.title}
                </span>
              ))}
            </div>
          </div>
        ))}
        {links.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-2">Links</h4>
            <div className="space-y-1">
              {links.map((l: WizardLink) => (
                <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer"
                  className="block text-sm text-[var(--color-sage)] hover:underline">{l.title}</a>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-3">
        <button onClick={onPublish} disabled={isPending}
          className="flex-1 py-3 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
          {isPending ? 'Publishing...' : 'Publish your profile'}
        </button>
      </div>
      <p className="text-xs text-center text-[var(--color-muted)]">
        Your profile will be visible at {process.env.NEXT_PUBLIC_SITE_URL?.replace('https://', '') || 'checklyra.com'}/{profile.slug}
      </p>
    </div>
  );
}
