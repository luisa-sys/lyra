'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  updateProfileFields,
  addProfileItem,
  removeProfileItem,
  addSchoolAffiliation,
  removeSchoolAffiliation,
  addExternalLink,
  removeExternalLink,
  publishProfile,
} from './actions';

const STEPS = [
  { id: 'identity', label: 'Identity', icon: '👤' },
  { id: 'school', label: 'School', icon: '🏫' },
  { id: 'bio', label: 'About you', icon: '✏️' },
  { id: 'likes', label: 'Likes & Dislikes', icon: '💚' },
  { id: 'gifts', label: 'Gift ideas', icon: '🎁' },
  { id: 'boundaries', label: 'Boundaries', icon: '🛑' },
  { id: 'links', label: 'Links', icon: '🔗' },
  { id: 'preview', label: 'Preview', icon: '👁️' },
];

/* eslint-disable @typescript-eslint/no-explicit-any */
export function ProfileWizard({
  profile,
  items,
  schools,
  links,
}: {
  profile: any;
  items: any[];
  schools: any[];
  links: any[];
}) {
  const [step, setStep] = useState(0);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <main className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="font-[family-name:var(--font-serif)] text-xl text-[var(--color-ink)]">
            Lyra
          </Link>
          <span className="text-sm text-[var(--color-muted)]">
            Step {step + 1} of {STEPS.length}
          </span>
        </div>
      </header>

      {/* Step navigation */}
      <div className="max-w-3xl mx-auto px-4 py-3 flex gap-1 overflow-x-auto">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setStep(i)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              i === step
                ? 'bg-[var(--color-sage)] text-white'
                : 'bg-stone-100 text-[var(--color-muted)] hover:bg-stone-200'
            }`}
          >
            <span>{s.icon}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      {/* Step content */}
      <div className="max-w-3xl mx-auto px-4 py-6">
        {step === 0 && (
          <IdentityStep profile={profile} onSave={(data: any) => {
            startTransition(async () => {
              await updateProfileFields(data);
              router.refresh();
              next();
            });
          }} isPending={isPending} />
        )}

        {step === 1 && (
          <SchoolStep schools={schools} onAdd={(data: any) => {
            startTransition(async () => {
              await addSchoolAffiliation(data);
              router.refresh();
            });
          }} onRemove={(id: string) => {
            startTransition(async () => {
              await removeSchoolAffiliation(id);
              router.refresh();
            });
          }} onNext={next} isPending={isPending} />
        )}

        {step === 2 && (
          <BioStep profile={profile} onSave={(data: any) => {
            startTransition(async () => {
              await updateProfileFields(data);
              router.refresh();
              next();
            });
          }} isPending={isPending} />
        )}

        {step === 3 && (
          <ItemsStep
            title="Likes & Dislikes"
            description="What do you love? What can't you stand?"
            categories={['likes', 'dislikes']}
            items={items.filter((i) => ['likes', 'dislikes'].includes(i.category))}
            onAdd={(data: any) => {
              startTransition(async () => {
                await addProfileItem(data);
                router.refresh();
              });
            }}
            onRemove={(id: string) => {
              startTransition(async () => {
                await removeProfileItem(id);
                router.refresh();
              });
            }}
            onNext={next}
            isPending={isPending}
          />
        )}

        {step === 4 && (
          <ItemsStep
            title="Gift ideas"
            description="Help people find the perfect gift for you."
            categories={['gift_ideas', 'gifts_to_avoid']}
            items={items.filter((i) => ['gift_ideas', 'gifts_to_avoid'].includes(i.category))}
            onAdd={(data: any) => {
              startTransition(async () => {
                await addProfileItem(data);
                router.refresh();
              });
            }}
            onRemove={(id: string) => {
              startTransition(async () => {
                await removeProfileItem(id);
                router.refresh();
              });
            }}
            onNext={next}
            isPending={isPending}
          />
        )}

        {step === 5 && (
          <ItemsStep
            title="Boundaries"
            description="Things people should know to respect your space."
            categories={['boundaries', 'helpful_to_know']}
            items={items.filter((i) => ['boundaries', 'helpful_to_know'].includes(i.category))}
            onAdd={(data: any) => {
              startTransition(async () => {
                await addProfileItem(data);
                router.refresh();
              });
            }}
            onRemove={(id: string) => {
              startTransition(async () => {
                await removeProfileItem(id);
                router.refresh();
              });
            }}
            onNext={next}
            isPending={isPending}
          />
        )}

        {step === 6 && (
          <LinksStep links={links} onAdd={(data: any) => {
            startTransition(async () => {
              await addExternalLink(data);
              router.refresh();
            });
          }} onRemove={(id: string) => {
            startTransition(async () => {
              await removeExternalLink(id);
              router.refresh();
            });
          }} onNext={next} isPending={isPending} />
        )}

        {step === 7 && (
          <PreviewStep
            profile={profile}
            items={items}
            schools={schools}
            links={links}
            onPublish={() => {
              startTransition(async () => {
                await publishProfile();
                router.refresh();
                router.push('/dashboard');
              });
            }}
            isPending={isPending}
          />
        )}
      </div>

      {/* Navigation buttons */}
      <div className="max-w-3xl mx-auto px-4 pb-8 flex justify-between items-center">
        <button
          onClick={prev}
          disabled={step === 0}
          className="px-4 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] disabled:opacity-30 transition-colors"
        >
          ← Back
        </button>
        {step < STEPS.length - 1 && (
          <button
            onClick={next}
            className="px-4 py-2 text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
          >
            Skip this step
          </button>
        )}
      </div>
    </main>
  );
}

/* ============================================================
   STEP COMPONENTS
   ============================================================ */

function IdentityStep({ profile, onSave, isPending }: any) {
  const [name, setName] = useState(profile.display_name || '');
  const [headline, setHeadline] = useState(profile.headline || '');
  const [city, setCity] = useState(profile.city || '');
  const [country, setCountry] = useState(profile.country || 'GB');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-ink)]">Who are you?</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">The basics so people can find and recognise you.</p>
      </div>
      <div className="space-y-4">
        <Field label="Display name" value={name} onChange={setName} placeholder="Sarah Ashworth" />
        <Field label="Headline" value={headline} onChange={setHeadline} placeholder="Mum, teacher, coffee lover" />
        <Field label="City" value={city} onChange={setCity} placeholder="London" />
        <Field label="Country" value={country} onChange={setCountry} placeholder="GB" />
      </div>
      <SaveButton
        onClick={() => onSave({ display_name: name, headline, city, country })}
        isPending={isPending}
        label="Save & continue"
      />
    </div>
  );
}

function BioStep({ profile, onSave, isPending }: any) {
  const [bio, setBio] = useState(profile.bio_short || '');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-ink)]">About you</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">A short bio so people get a sense of who you are.</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">Short bio</label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={4}
          maxLength={300}
          className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent resize-none"
          placeholder="I'm a primary school teacher who loves hiking, terrible puns, and finding the best flat white in town."
        />
        <p className="text-xs text-[var(--color-muted)] mt-1">{bio.length}/300</p>
      </div>
      <SaveButton onClick={() => onSave({ bio_short: bio })} isPending={isPending} label="Save & continue" />
    </div>
  );
}

function SchoolStep({ schools, onAdd, onRemove, onNext, isPending }: any) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [relationship, setRelationship] = useState('parent');

  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd({ school_name: name, school_location: location, relationship });
    setName('');
    setLocation('');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-ink)]">School connections</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">Help other parents and teachers find you.</p>
      </div>

      {schools.length > 0 && (
        <div className="space-y-2">
          {schools.map((s: any) => (
            <div key={s.id} className="flex items-center justify-between bg-white rounded-lg border border-stone-200 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--color-ink)]">{s.school_name}</p>
                <p className="text-xs text-[var(--color-muted)]">{s.relationship}{s.school_location ? ` · ${s.school_location}` : ''}</p>
              </div>
              <button onClick={() => onRemove(s.id)} disabled={isPending} className="text-xs text-red-400 hover:text-red-600">Remove</button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3 bg-white rounded-lg border border-stone-200 p-4">
        <Field label="School name" value={name} onChange={setName} placeholder="Greenfield Primary" />
        <Field label="Location" value={location} onChange={setLocation} placeholder="London" />
        <div>
          <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">Relationship</label>
          <select value={relationship} onChange={(e) => setRelationship(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm">
            <option value="parent">Parent</option>
            <option value="student">Student</option>
            <option value="alumni">Alumni</option>
            <option value="staff">Staff</option>
            <option value="other">Other</option>
          </select>
        </div>
        <button onClick={handleAdd} disabled={isPending || !name.trim()}
          className="px-4 py-2 rounded-lg bg-stone-100 text-sm font-medium text-[var(--color-ink)] hover:bg-stone-200 disabled:opacity-40 transition-colors">
          + Add school
        </button>
      </div>
      <SaveButton onClick={onNext} isPending={false} label="Continue →" />
    </div>
  );
}

function ItemsStep({ title, description, categories, items, onAdd, onRemove, onNext, isPending }: any) {
  const [category, setCategory] = useState(categories[0]);
  const [itemTitle, setItemTitle] = useState('');
  const [itemDesc, setItemDesc] = useState('');

  const categoryLabels: Record<string, string> = {
    likes: '💚 Like', dislikes: '💔 Dislike',
    gift_ideas: '🎁 Gift idea', gifts_to_avoid: '🚫 Avoid',
    boundaries: '🛑 Boundary', helpful_to_know: '💡 Helpful to know',
  };

  const handleAdd = () => {
    if (!itemTitle.trim()) return;
    onAdd({ category, title: itemTitle, description: itemDesc || undefined });
    setItemTitle('');
    setItemDesc('');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-ink)]">{title}</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">{description}</p>
      </div>

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item: any) => (
            <div key={item.id} className="flex items-center justify-between bg-white rounded-lg border border-stone-200 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--color-ink)]">
                  <span className="opacity-60">{categoryLabels[item.category] || item.category}</span> — {item.title}
                </p>
                {item.description && <p className="text-xs text-[var(--color-muted)] mt-0.5">{item.description}</p>}
              </div>
              <button onClick={() => onRemove(item.id)} disabled={isPending} className="text-xs text-red-400 hover:text-red-600">Remove</button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3 bg-white rounded-lg border border-stone-200 p-4">
        {categories.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm">
              {categories.map((c: string) => (
                <option key={c} value={c}>{categoryLabels[c] || c}</option>
              ))}
            </select>
          </div>
        )}
        <Field label="Title" value={itemTitle} onChange={setItemTitle} placeholder="e.g. Dark chocolate, hiking boots" />
        <div>
          <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">Description (optional)</label>
          <input value={itemDesc} onChange={(e) => setItemDesc(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)]"
            placeholder="Any extra detail" />
        </div>
        <button onClick={handleAdd} disabled={isPending || !itemTitle.trim()}
          className="px-4 py-2 rounded-lg bg-stone-100 text-sm font-medium text-[var(--color-ink)] hover:bg-stone-200 disabled:opacity-40 transition-colors">
          + Add item
        </button>
      </div>
      <SaveButton onClick={onNext} isPending={false} label="Continue →" />
    </div>
  );
}

function LinksStep({ links, onAdd, onRemove, onNext, isPending }: any) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [linkType, setLinkType] = useState('general');

  const handleAdd = () => {
    if (!title.trim() || !url.trim()) return;
    onAdd({ title, url, link_type: linkType });
    setTitle('');
    setUrl('');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-ink)]">Links & wishlists</h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">Share wishlists, favourite shops, or articles about you.</p>
      </div>

      {links.length > 0 && (
        <div className="space-y-2">
          {links.map((l: any) => (
            <div key={l.id} className="flex items-center justify-between bg-white rounded-lg border border-stone-200 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--color-ink)]">{l.title}</p>
                <p className="text-xs text-[var(--color-muted)] truncate max-w-xs">{l.url}</p>
              </div>
              <button onClick={() => onRemove(l.id)} disabled={isPending} className="text-xs text-red-400 hover:text-red-600">Remove</button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3 bg-white rounded-lg border border-stone-200 p-4">
        <Field label="Title" value={title} onChange={setTitle} placeholder="My Amazon wishlist" />
        <Field label="URL" value={url} onChange={setUrl} placeholder="https://amazon.co.uk/hz/wishlist/..." />
        <div>
          <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">Type</label>
          <select value={linkType} onChange={(e) => setLinkType(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-sm">
            <option value="wishlist">Wishlist</option>
            <option value="retailer">Favourite shop</option>
            <option value="article">Article</option>
            <option value="general">Other</option>
          </select>
        </div>
        <button onClick={handleAdd} disabled={isPending || !title.trim() || !url.trim()}
          className="px-4 py-2 rounded-lg bg-stone-100 text-sm font-medium text-[var(--color-ink)] hover:bg-stone-200 disabled:opacity-40 transition-colors">
          + Add link
        </button>
      </div>
      <SaveButton onClick={onNext} isPending={false} label="Continue →" />
    </div>
  );
}

function PreviewStep({ profile, items, schools, links, onPublish, isPending }: any) {
  const categoryLabels: Record<string, string> = {
    likes: 'Likes', dislikes: 'Dislikes',
    gift_ideas: 'Gift ideas', gifts_to_avoid: 'Gifts to avoid',
    boundaries: 'Boundaries', helpful_to_know: 'Helpful to know',
  };

  const groupedItems = items.reduce((acc: any, item: any) => {
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
              {schools.map((s: any) => (
                <p key={s.id} className="text-sm text-[var(--color-ink)]">{s.school_name} <span className="text-[var(--color-muted)]">({s.relationship})</span></p>
              ))}
            </div>
          </div>
        )}

        {Object.entries(groupedItems).map(([cat, catItems]: [string, any]) => (
          <div key={cat}>
            <h4 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-2">{categoryLabels[cat] || cat}</h4>
            <div className="flex flex-wrap gap-2">
              {catItems.map((item: any) => (
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
              {links.map((l: any) => (
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
        Your profile will be visible at checklyra.com/{profile.slug}
      </p>
    </div>
  );
}

/* ============================================================
   SHARED COMPONENTS
   ============================================================ */

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
      />
    </div>
  );
}

function SaveButton({ onClick, isPending, label }: {
  onClick: () => void; isPending: boolean; label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={isPending}
      className="w-full py-2.5 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
    >
      {isPending ? 'Saving...' : label}
    </button>
  );
}
