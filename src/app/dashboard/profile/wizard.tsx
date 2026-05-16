'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  updateProfileFields,
  addProfileItem,
  removeProfileItem,
  updateProfileItemVisibility,
  addSchoolAffiliation,
  removeSchoolAffiliation,
  addExternalLink,
  removeExternalLink,
  publishProfile,
  uploadAvatar,
} from './actions';
import { updateManualOfMe } from './manual-of-me-actions';
import type { ManualOfMe } from './manual-of-me-fields';
import {
  IdentityStep, BioStep, SchoolStep, ItemsStep, LinksStep, ManualOfMeStep, FilesStep, ConversationStartersStep, PreviewStep,
  type WizardProfile, type WizardItem, type WizardSchool, type WizardLink, type WizardFile,
  type ConversationPrompt, type ConversationAnswer,
} from './steps';
import { uploadProfileFile, removeProfileFile, updateProfileFileVisibility } from './files-actions';
import {
  addConversationStarter,
  updateConversationStarter,
  removeConversationStarter,
} from './conversation-starters-actions';

const STEPS = [
  { id: 'identity', label: 'Identity', icon: '👤' },
  { id: 'school', label: 'School', icon: '🏫' },
  { id: 'bio', label: 'About you', icon: '✏️' },
  { id: 'manual_of_me', label: 'Manual of Me', icon: '📖' },
  { id: 'likes', label: 'Likes & Dislikes', icon: '💚' },
  { id: 'gifts', label: 'Gift ideas', icon: '🎁' },
  { id: 'boundaries', label: 'Boundaries', icon: '🛑' },
  { id: 'interests', label: 'Books & Media', icon: '📚' },
  { id: 'values', label: 'Causes & Quotes', icon: '💛' },
  { id: 'more', label: 'More about you', icon: '✨' },
  { id: 'links', label: 'Links', icon: '🔗' },
  // KAN-142: files & media — inserted between links and preview so the
  // user has filled out everything else by the time they upload files.
  { id: 'files', label: 'Files & media', icon: '📎' },
  // KAN-181: conversation starters — sits late in the flow because it
  // benefits from the user having warmed up on the easier sections first.
  { id: 'starters', label: 'Things to ask me', icon: '💬' },
  { id: 'preview', label: 'Preview', icon: '👁️' },
];

export function ProfileWizard({
  profile,
  items,
  schools,
  links,
  manualOfMe,
  files,
  conversationPrompts,
  conversationAnswers,
}: {
  profile: WizardProfile;
  items: WizardItem[];
  schools: WizardSchool[];
  links: WizardLink[];
  manualOfMe: ManualOfMe;
  files: WizardFile[];
  conversationPrompts: ConversationPrompt[];
  conversationAnswers: ConversationAnswer[];
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
          <Link href="/dashboard" className="flex items-center">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" />
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
          <ManualOfMeStep manualOfMe={manualOfMe} onSave={(data: Record<string, string>) => {
            startTransition(async () => {
              await updateManualOfMe(data);
              router.refresh();
              next();
            });
          }} isPending={isPending} />
        )}
        {step === 4 && (
          <ItemsStep title="Likes & Dislikes" description="What do you love? What can't you stand?"
            categories={['likes', 'dislikes']}
            items={items.filter((i) => ['likes', 'dislikes'].includes(i.category))}
            onAdd={(data) => { startTransition(async () => { await addProfileItem(data); router.refresh(); }); }}
            onRemove={(id) => { startTransition(async () => { await removeProfileItem(id); router.refresh(); }); }}
            onUpdateVisibility={(id, visibility) => { startTransition(async () => { await updateProfileItemVisibility(id, visibility); router.refresh(); }); }}
            onNext={next} isPending={isPending} />
        )}
        {step === 5 && (
          <ItemsStep title="Gift ideas" description="Help people find the perfect gift for you."
            categories={['gift_ideas', 'gifts_to_avoid']}
            items={items.filter((i) => ['gift_ideas', 'gifts_to_avoid'].includes(i.category))}
            onAdd={(data) => { startTransition(async () => { await addProfileItem(data); router.refresh(); }); }}
            onRemove={(id) => { startTransition(async () => { await removeProfileItem(id); router.refresh(); }); }}
            onUpdateVisibility={(id, visibility) => { startTransition(async () => { await updateProfileItemVisibility(id, visibility); router.refresh(); }); }}
            onNext={next} isPending={isPending} />
        )}
        {step === 6 && (
          <ItemsStep title="Boundaries" description="Things people should know to respect your space."
            categories={['boundaries', 'helpful_to_know']}
            items={items.filter((i) => ['boundaries', 'helpful_to_know'].includes(i.category))}
            onAdd={(data) => { startTransition(async () => { await addProfileItem(data); router.refresh(); }); }}
            onRemove={(id) => { startTransition(async () => { await removeProfileItem(id); router.refresh(); }); }}
            onUpdateVisibility={(id, visibility) => { startTransition(async () => { await updateProfileItemVisibility(id, visibility); router.refresh(); }); }}
            onNext={next} isPending={isPending} />
        )}
        {step === 7 && (
          <ItemsStep title="Books & Media" description="Favourite books, movies, and series — the things that shaped you."
            categories={['favourite_books', 'favourite_media']}
            items={items.filter((i) => ['favourite_books', 'favourite_media'].includes(i.category))}
            onAdd={(data) => { startTransition(async () => { await addProfileItem(data); router.refresh(); }); }}
            onRemove={(id) => { startTransition(async () => { await removeProfileItem(id); router.refresh(); }); }}
            onUpdateVisibility={(id, visibility) => { startTransition(async () => { await updateProfileItemVisibility(id, visibility); router.refresh(); }); }}
            onNext={next} isPending={isPending} />
        )}
        {step === 8 && (
          <ItemsStep title="Causes & Quotes" description="What matters to you — charities, causes, and words that resonate."
            categories={['causes', 'quotes']}
            items={items.filter((i) => ['causes', 'quotes'].includes(i.category))}
            onAdd={(data) => { startTransition(async () => { await addProfileItem(data); router.refresh(); }); }}
            onRemove={(id) => { startTransition(async () => { await removeProfileItem(id); router.refresh(); }); }}
            onUpdateVisibility={(id, visibility) => { startTransition(async () => { await updateProfileItemVisibility(id, visibility); router.refresh(); }); }}
            onNext={next} isPending={isPending} />
        )}
        {step === 9 && (
          <ItemsStep title="More about you" description="What makes you proud, life hacks, questions you wish people asked, problems you're currently working on."
            categories={['proud_of', 'life_hacks', 'questions', 'billboard', 'current_problems']}
            items={items.filter((i) => ['proud_of', 'life_hacks', 'questions', 'billboard', 'current_problems'].includes(i.category))}
            onAdd={(data) => { startTransition(async () => { await addProfileItem(data); router.refresh(); }); }}
            onRemove={(id) => { startTransition(async () => { await removeProfileItem(id); router.refresh(); }); }}
            onUpdateVisibility={(id, visibility) => { startTransition(async () => { await updateProfileItemVisibility(id, visibility); router.refresh(); }); }}
            onNext={next} isPending={isPending} />
        )}
        {step === 10 && (
          <LinksStep links={links}
            onAdd={(data) => { startTransition(async () => { await addExternalLink(data); router.refresh(); }); }}
            onRemove={(id) => { startTransition(async () => { await removeExternalLink(id); router.refresh(); }); }}
            onNext={next} isPending={isPending} />
        )}
        {step === 11 && (
          <FilesStep
            files={files}
            onUpload={(formData) => { startTransition(async () => { await uploadProfileFile(formData); router.refresh(); }); }}
            onRemove={(id) => { startTransition(async () => { await removeProfileFile(id); router.refresh(); }); }}
            onUpdateVisibility={(id, visibility) => { startTransition(async () => { await updateProfileFileVisibility(id, visibility); router.refresh(); }); }}
            onNext={next} isPending={isPending}
          />
        )}
        {step === 12 && (
          <ConversationStartersStep
            prompts={conversationPrompts}
            answers={conversationAnswers}
            onAdd={(input) => { startTransition(async () => { await addConversationStarter(input); router.refresh(); }); }}
            onUpdate={(id, answer) => { startTransition(async () => { await updateConversationStarter(id, answer); router.refresh(); }); }}
            onRemove={(id) => { startTransition(async () => { await removeConversationStarter(id); router.refresh(); }); }}
            onNext={next} isPending={isPending}
          />
        )}
        {step === 13 && (
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
