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
  uploadAvatar,
} from './actions';
import {
  IdentityStep, BioStep, SchoolStep, ItemsStep, LinksStep, PreviewStep,
  type WizardProfile, type WizardItem, type WizardSchool, type WizardLink,
} from './steps';

const STEPS = [
  { id: 'identity', label: 'Identity', icon: '👤' },
  { id: 'school', label: 'School', icon: '🏫' },
  { id: 'bio', label: 'About you', icon: '✏️' },
  { id: 'likes', label: 'Likes & Dislikes', icon: '💚' },
  { id: 'gifts', label: 'Gift ideas', icon: '🎁' },
  { id: 'boundaries', label: 'Boundaries', icon: '🛑' },
  { id: 'interests', label: 'Books & Media', icon: '📚' },
  { id: 'values', label: 'Causes & Quotes', icon: '💛' },
  { id: 'more', label: 'More about you', icon: '✨' },
  { id: 'links', label: 'Links', icon: '🔗' },
  { id: 'preview', label: 'Preview', icon: '👁️' },
];

export function ProfileWizard({
  profile,
  items,
  schools,
  links,
}: {
  profile: WizardProfile;
  items: WizardItem[];
  schools: WizardSchool[];
  links: WizardLink[];
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
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
              i === step
                ? 'bg-[var(--color-sage)] text-white'
                : i < step
                  ? 'bg-stone-200 text-[var(--color-ink)]'
                  : 'bg-stone-100 text-[var(--color-muted)]'
            }`}
          >
            <span>{s.icon}</span> {s.label}
          </button>
        ))}
      </div>

      {/* Step content */}
      <div className="max-w-3xl mx-auto px-4 py-6">
        {step === 0 && (
          <IdentityStep profile={profile} onSave={(data: Record<string, string>) => {
            startTransition(async () => {
              await updateProfileFields(data);
              router.refresh();
              next();
            });
          }} onUploadAvatar={(formData: FormData) => {
            startTransition(async () => {
              await uploadAvatar(formData);
              router.refresh();
            });
          }} isPending={isPending} />
        )}
        {step === 1 && (
          <SchoolStep schools={schools} onAdd={(data: { school_name: string; school_location?: string; relationship?: string }) => {
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
          <BioStep profile={profile} onSave={(data: Record<string, string>) => {
            startTransition(async () => {
              await updateProfileFields(data);
              router.refresh();
              next();
            });
          }} isPending={isPending} />
        )}
        {step === 3 && (
          <ItemsStep title="Likes & Dislikes" description="What do you love? What can't you stand?"
            categories={['likes', 'dislikes']}
            items={items.filter((i) => ['likes', 'dislikes'].includes(i.category))}
            onAdd={(data) => { startTransition(async () => { await addProfileItem(data); router.refresh(); }); }}
            onRemove={(id) => { startTransition(async () => { await removeProfileItem(id); router.refresh(); }); }}
            onNext={next} isPending={isPending} />
        )}
        {step === 4 && (
          <ItemsStep title="Gift ideas" description="Help people find the perfect gift for you."
            categories={['gift_ideas', 'gifts_to_avoid']}
            items={items.filter((i) => ['gift_ideas', 'gifts_to_avoid'].includes(i.category))}
            onAdd={(data) => { startTransition(async () => { await addProfileItem(data); router.refresh(); }); }}
            onRemove={(id) => { startTransition(async () => { await removeProfileItem(id); router.refresh(); }); }}
            onNext={next} isPending={isPending} />
        )}
        {step === 5 && (
          <ItemsStep title="Boundaries" description="Things people should know to respect your space."
            categories={['boundaries', 'helpful_to_know']}
            items={items.filter((i) => ['boundaries', 'helpful_to_know'].includes(i.category))}
            onAdd={(data) => { startTransition(async () => { await addProfileItem(data); router.refresh(); }); }}
            onRemove={(id) => { startTransition(async () => { await removeProfileItem(id); router.refresh(); }); }}
            onNext={next} isPending={isPending} />
        )}
        {step === 6 && (
          <ItemsStep title="Books & Media" description="Favourite books, movies, and series — the things that shaped you."
            categories={['favourite_books', 'favourite_media']}
            items={items.filter((i) => ['favourite_books', 'favourite_media'].includes(i.category))}
            onAdd={(data) => { startTransition(async () => { await addProfileItem(data); router.refresh(); }); }}
            onRemove={(id) => { startTransition(async () => { await removeProfileItem(id); router.refresh(); }); }}
            onNext={next} isPending={isPending} />
        )}
        {step === 7 && (
          <ItemsStep title="Causes & Quotes" description="What matters to you — charities, causes, and words that resonate."
            categories={['causes', 'quotes']}
            items={items.filter((i) => ['causes', 'quotes'].includes(i.category))}
            onAdd={(data) => { startTransition(async () => { await addProfileItem(data); router.refresh(); }); }}
            onRemove={(id) => { startTransition(async () => { await removeProfileItem(id); router.refresh(); }); }}
            onNext={next} isPending={isPending} />
        )}
        {step === 8 && (
          <ItemsStep title="More about you" description="What makes you proud, life hacks, questions you wish people asked."
            categories={['proud_of', 'life_hacks', 'questions', 'billboard']}
            items={items.filter((i) => ['proud_of', 'life_hacks', 'questions', 'billboard'].includes(i.category))}
            onAdd={(data) => { startTransition(async () => { await addProfileItem(data); router.refresh(); }); }}
            onRemove={(id) => { startTransition(async () => { await removeProfileItem(id); router.refresh(); }); }}
            onNext={next} isPending={isPending} />
        )}
        {step === 9 && (
          <LinksStep links={links}
            onAdd={(data) => { startTransition(async () => { await addExternalLink(data); router.refresh(); }); }}
            onRemove={(id) => { startTransition(async () => { await removeExternalLink(id); router.refresh(); }); }}
            onNext={next} isPending={isPending} />
        )}
        {step === 10 && (
          <PreviewStep profile={profile} items={items} schools={schools} links={links}
            onPublish={() => { startTransition(async () => { await publishProfile(); router.refresh(); router.push('/dashboard'); }); }}
            isPending={isPending} />
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
            className="px-4 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
          >
            Skip →
          </button>
        )}
      </div>
    </main>
  );
}
