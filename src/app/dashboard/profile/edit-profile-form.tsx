'use client';

/**
 * KAN-220 / KAN-266 — single-page profile editor.
 *
 * KAN-266 ports the June-2026 redesign into the editor: warm sections that
 * mirror the public profile (sage left-rule headings, calm cards), the six
 * humanised "about me" prompts, and the granular content sections in the same
 * order the public profile renders them. The Delivery-country field and the
 * per-item / per-section visibility controls are removed — the redesigned
 * profile is simply public, and affiliations are the only hidden-by-default
 * thing (their per-row toggle lands in KAN-267).
 *
 * Save UX is unchanged: free-text sections autosave on a debounce; list
 * sections save instantly on Add / Remove via the existing server actions.
 * The legacy step-by-step wizard stays at `/dashboard/profile/legacy`.
 */

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  addProfileItem,
  removeProfileItem,
  updateProfileItemVisibility,
  addExternalLink,
  removeExternalLink,
  publishProfile,
} from './actions';
import {
  ItemsStep,
  LinksStep,
  FilesStep,
  ConversationStartersStep,
  type WizardProfile,
  type WizardItem,
  type WizardSchool,
  type WizardLink,
  type WizardFile,
  type ConversationPrompt,
  type ConversationAnswer,
} from './steps';
import {
  uploadProfileFile,
  removeProfileFile,
  updateProfileFileVisibility,
} from './files-actions';
import {
  addConversationStarter,
  updateConversationStarter,
  removeConversationStarter,
} from './conversation-starters-actions';
import {
  BasicInfoSection,
  BioSection,
  ManualOfMeSection,
  AffiliationsSection,
} from './sections';
import type { ManualOfMe } from './manual-of-me-fields';

type SectionKind = 'basic' | 'affiliations' | 'bio' | 'manual' | 'items' | 'starters' | 'links' | 'files';

interface SectionDef {
  id: string;
  label: string;
  icon: string;
  kind: SectionKind;
  categories?: string[];
  description?: string;
}

// KAN-266: section order + headings mirror the public profile (the redesign's
// "edit = published" principle). Content sections are granular so each maps to
// exactly one heading on the public page.
const SECTIONS: SectionDef[] = [
  { id: 'basic-info', label: 'The basics', icon: '👤', kind: 'basic' },
  { id: 'affiliations', label: 'Where you might know me from', icon: '🤝', kind: 'affiliations' },
  { id: 'bio', label: 'A short intro', icon: '📝', kind: 'bio' },
  { id: 'manual-of-me', label: 'To understand me a little better', icon: '💭', kind: 'manual' },
  {
    id: 'love',
    label: "Things I love, can't get enough of, or have been dreaming about",
    icon: '💛',
    kind: 'items',
    categories: ['gift_ideas'],
    description: "The things you'd genuinely love — to receive, to do, or to be surprised by.",
  },
  {
    id: 'into',
    label: "Things I'm into",
    icon: '💚',
    kind: 'items',
    categories: ['likes'],
    description: 'Interests, hobbies, the things you light up about.',
  },
  {
    id: 'notforme',
    label: "Things that aren't really for me",
    icon: '🙅',
    kind: 'items',
    categories: ['gifts_to_avoid', 'dislikes'],
    description: "Gentle no-thank-yous — so people don't have to guess.",
  },
  {
    id: 'helpful',
    label: 'Helpful to know',
    icon: '🧭',
    kind: 'items',
    categories: ['helpful_to_know'],
    description: 'Practical things that make life easier for the people around you.',
  },
  {
    id: 'myboundaries',
    label: 'My boundaries',
    icon: '🚧',
    kind: 'items',
    categories: ['boundaries'],
    description: "Anything you'd gently like respected.",
  },
  {
    id: 'causes',
    label: 'Causes close to my heart',
    icon: '🌍',
    kind: 'items',
    categories: ['causes'],
    description: 'Causes and charities you care about.',
  },
  {
    id: 'proud',
    label: "Things I'm proud of",
    icon: '🏆',
    kind: 'items',
    categories: ['proud_of'],
    description: 'Moments and achievements that mean something to you.',
  },
  {
    id: 'favourites',
    label: 'A few of my favourite things',
    icon: '⭐',
    kind: 'items',
    categories: ['favourite_books', 'favourite_media', 'favourite_tv', 'quotes', 'favourite_places', 'favourite_music'],
    description: 'Books, films, TV, music, places, and the quotes you come back to.',
  },
  {
    id: 'tips',
    label: 'Tips & life hacks I can share',
    icon: '🧰',
    kind: 'items',
    categories: ['life_hacks'],
    description: 'Hard-won wisdom worth passing on.',
  },
  {
    id: 'problems',
    label: "Problems I'm trying to solve — ideas welcome",
    icon: '🧩',
    kind: 'items',
    categories: ['current_problems'],
    description: "What you're working on or puzzling over right now.",
  },
  {
    id: 'starters',
    label: 'A few more things about me',
    icon: '💬',
    kind: 'starters',
    description: 'Pick a question and answer it in your own words.',
  },
  {
    id: 'extras',
    label: 'A couple of extras',
    icon: '✨',
    kind: 'items',
    categories: ['billboard', 'questions'],
    description: "Your billboard message, and any other questions you'd love to be asked.",
  },
  { id: 'links', label: 'Links', icon: '🔗', kind: 'links' },
  { id: 'files', label: 'Files & media', icon: '📎', kind: 'files' },
];

export function EditProfileForm({
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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // SSR-safe: all expanded by default (no flash on desktop). On mount,
  // matchMedia narrows to mobile and we collapse all but the first.
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(SECTIONS.map((s) => s.id)),
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(max-width: 767px)').matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- KAN-220: one-time mount-only matchMedia detection. Empty deps array prevents cascading renders; this is the standard pattern for hydration-time viewport-dependent state.
      setOpenSections(new Set([SECTIONS[0].id]));
    }
  }, []);

  const toggleSection = (id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderItemsSection = (s: SectionDef) => (
    <ItemsStep
      title=""
      description={s.description ?? ''}
      categories={s.categories ?? []}
      items={items.filter((i) => (s.categories ?? []).includes(i.category))}
      // KAN-266: redesign drops per-item visibility.
      hideVisibility
      onAdd={(data) => {
        startTransition(async () => {
          await addProfileItem(data);
          router.refresh();
        });
      }}
      onRemove={(id) => {
        startTransition(async () => {
          await removeProfileItem(id);
          router.refresh();
        });
      }}
      onUpdateVisibility={(id, visibility) => {
        startTransition(async () => {
          await updateProfileItemVisibility(id, visibility);
          router.refresh();
        });
      }}
      onNext={() => toggleSection(s.id)}
      isPending={isPending}
    />
  );

  return (
    <main className="min-h-screen bg-[#fdfcf8] pb-24">
      {/* Header */}
      <header className="border-b border-[#ece7df] bg-white">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center">
            <Image src="/lyra-logo.png" alt="Lyra" width={32} height={32} className="h-8 w-auto" />
          </Link>
          <div className="flex items-center gap-4">
            {profile.is_published && (
              <Link
                href={`/${profile.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--color-sage)] hover:underline"
              >
                View public profile ↗
              </Link>
            )}
            <Link
              href="/dashboard/profile/legacy"
              className="text-xs text-[var(--color-muted)] hover:underline"
              title="Open the old step-by-step wizard"
            >
              Use legacy wizard
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 md:grid md:grid-cols-[220px_1fr] md:gap-8">
        {/* Sidebar ToC — desktop only */}
        <nav aria-label="Section navigation" className="hidden md:block">
          <div className="sticky top-4 space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)] mb-2">
              Sections
            </p>
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="block text-sm text-[var(--color-ink)] hover:text-[var(--color-sage)] py-1 px-2 -mx-2 rounded hover:bg-[#f1ece3] leading-snug"
              >
                <span className="mr-1.5">{s.icon}</span> {s.label}
              </a>
            ))}
          </div>
        </nav>

        {/* Main column */}
        <div className="space-y-3">
          {/* KAN-266: one calm note — optionality stated once, not per field. */}
          <div className="rounded-[10px] border border-[#e3ece5] bg-[#e9efea] px-4 py-3 text-sm text-[var(--color-sage)] leading-relaxed">
            Everything here is optional — share whatever you&apos;d like people to know, and skip the rest.
            Your profile saves automatically as you go, and what you see here is exactly what people will see.
          </div>

          {SECTIONS.map((s) => {
            const isOpen = openSections.has(s.id);
            return (
              <section
                key={s.id}
                id={s.id}
                className="bg-white rounded-[10px] border border-[#ece7df] overflow-hidden scroll-mt-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
              >
                <div className="flex items-center justify-between px-4 py-3 hover:bg-[#faf8f3] transition-colors">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`${s.id}-body`}
                    onClick={() => toggleSection(s.id)}
                    className="flex items-center text-left flex-1 cursor-pointer"
                  >
                    {/* Sage left-rule heading, echoing the public profile .q style */}
                    <span className="border-l-[3px] border-[var(--color-sage)] pl-3 text-[15px] font-semibold text-[var(--color-ink)] leading-snug">
                      <span className="mr-1.5">{s.icon}</span>{s.label}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSection(s.id)}
                    aria-label={isOpen ? `Collapse ${s.label}` : `Expand ${s.label}`}
                    className="text-[var(--color-muted)] text-sm px-1 shrink-0"
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>
                </div>
                {isOpen && (
                  <div id={`${s.id}-body`} className="px-4 pb-5 pt-1 border-t border-[#ece7df]">
                    {s.kind === 'basic' && <BasicInfoSection profile={profile} />}
                    {s.kind === 'affiliations' && <AffiliationsSection schools={schools} />}
                    {s.kind === 'bio' && <BioSection profile={profile} />}
                    {s.kind === 'manual' && <ManualOfMeSection manualOfMe={manualOfMe} />}
                    {s.kind === 'items' && renderItemsSection(s)}
                    {s.kind === 'links' && (
                      <LinksStep
                        links={links}
                        onAdd={(data) => {
                          startTransition(async () => {
                            await addExternalLink(data);
                            router.refresh();
                          });
                        }}
                        onRemove={(id) => {
                          startTransition(async () => {
                            await removeExternalLink(id);
                            router.refresh();
                          });
                        }}
                        onNext={() => toggleSection(s.id)}
                        isPending={isPending}
                      />
                    )}
                    {s.kind === 'files' && (
                      <FilesStep
                        files={files}
                        onUpload={(formData) => {
                          startTransition(async () => {
                            await uploadProfileFile(formData);
                            router.refresh();
                          });
                        }}
                        onRemove={(id) => {
                          startTransition(async () => {
                            await removeProfileFile(id);
                            router.refresh();
                          });
                        }}
                        onUpdateVisibility={(id, visibility) => {
                          startTransition(async () => {
                            await updateProfileFileVisibility(id, visibility);
                            router.refresh();
                          });
                        }}
                        onNext={() => toggleSection(s.id)}
                        isPending={isPending}
                      />
                    )}
                    {s.kind === 'starters' && (
                      <ConversationStartersStep
                        prompts={conversationPrompts}
                        answers={conversationAnswers}
                        onAdd={(input) => {
                          startTransition(async () => {
                            await addConversationStarter(input);
                            router.refresh();
                          });
                        }}
                        onUpdate={(id, answer) => {
                          startTransition(async () => {
                            await updateConversationStarter(id, answer);
                            router.refresh();
                          });
                        }}
                        onRemove={(id) => {
                          startTransition(async () => {
                            await removeConversationStarter(id);
                            router.refresh();
                          });
                        }}
                        onNext={() => toggleSection(s.id)}
                        isPending={isPending}
                      />
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-[#ece7df] px-4 py-3 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <p className="text-xs text-[var(--color-muted)] hidden sm:block">
            Changes save automatically as you type.
          </p>
          <button
            type="button"
            onClick={() => {
              startTransition(async () => {
                await publishProfile();
                router.refresh();
                router.push('/dashboard');
              });
            }}
            disabled={isPending}
            className="px-5 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {profile.is_published ? 'Save & re-publish' : 'Save & publish'}
          </button>
        </div>
      </div>
    </main>
  );
}
