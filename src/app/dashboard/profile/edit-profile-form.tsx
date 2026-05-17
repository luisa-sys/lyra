'use client';

/**
 * KAN-220 — single-page profile editor. Replaces the 14-step wizard
 * with one long form, ports the Python `lyra-app/templates/edit_profile.html`
 * layout. The wizard file (`wizard.tsx`) is kept for the legacy route
 * at `/dashboard/profile/legacy` and for the existing `profile-sections.test.js`
 * regression guards (test-integrity policy — guards stay green by
 * leaving the file unchanged).
 *
 * Layout:
 *   - Sticky header with Lyra logo + "View public profile" link
 *   - Desktop: left sidebar Table of Contents (sticky), main column with
 *     all sections expanded by default. Mobile: no sidebar, all sections
 *     collapsed except Basic Info.
 *   - Each section is a controlled `<section>` with a button header that
 *     toggles open/closed.
 *   - Sticky bottom bar: Publish (or "Unpublish & save draft") button.
 *
 * Save UX:
 *   - Free-text sections (BasicInfo, Bio, ManualOfMe) autosave on blur
 *     after 800ms debounce. Status indicator in section.
 *   - List sections (items, links, files, schools, conversation starters)
 *     save instantly on Add / Remove via existing server actions.
 *   - The sticky Publish button only handles the publish/unpublish flip
 *     — it doesn't need to "save the form" because everything's already
 *     persisted.
 *
 * Mobile collapse state: SSR renders with all sections expanded (no
 * flash on desktop). On mount, a `useEffect` checks `matchMedia` and
 * collapses non-first sections on mobile. Brief flash on mobile is an
 * accepted trade-off — moving to per-section CSS state to eliminate
 * the flash entirely is a follow-up if it bothers anyone.
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
  updateSectionVisibility,
} from './actions';
import {
  isControllableSectionKey,
  coerceSectionVisibility,
  type SectionVisibility,
} from './section-visibility';
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

interface SectionDef {
  id: string;
  label: string;
  icon: string;
}

// Section order mirrors the Python `lyra-app` editor (`edit_profile.html`).
// Free-text sections that benefit from autosave come first; lists come next;
// files + starters at the end (lowest-engagement sections per KAN-181 reasoning).
const SECTIONS: SectionDef[] = [
  { id: 'basic-info', label: 'Basic Information', icon: '👤' },
  { id: 'affiliations', label: 'Schools / Orgs / Communities', icon: '🏫' },
  { id: 'bio', label: 'About you', icon: '✏️' },
  { id: 'manual-of-me', label: 'Manual of Me', icon: '📖' },
  { id: 'likes', label: 'Likes & Dislikes', icon: '💚' },
  { id: 'gifts', label: 'Gift ideas', icon: '🎁' },
  { id: 'boundaries', label: 'Boundaries & Preferences', icon: '🛑' },
  { id: 'books-media', label: 'Books & Media', icon: '📚' },
  { id: 'causes-quotes', label: 'Things that matter to me', icon: '💛' },
  { id: 'more', label: 'More about you', icon: '✨' },
  { id: 'links', label: 'Links', icon: '🔗' },
  { id: 'files', label: 'Files & media', icon: '📎' },
  { id: 'starters', label: 'Things to ask me about', icon: '💬' },
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- KAN-220: one-time mount-only matchMedia detection. Empty deps array prevents cascading renders; this is the standard pattern for hydration-time viewport-dependent state. Alternative (useSyncExternalStore) would also subscribe to viewport changes, which we deliberately don't want here.
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

  // KAN-234: derived once per render — section visibility defaults the
  // section-header toggles display. Defence in depth: coerceSectionVisibility
  // drops unknown keys/values from the JSONB column.
  const currentSectionVisibility: SectionVisibility = coerceSectionVisibility(
    profile.section_visibility,
  );

  const renderItemsSection = (
    sectionId: string,
    title: string,
    description: string,
    categories: string[],
  ) => (
    <ItemsStep
      title={title}
      description={description}
      categories={categories}
      items={items.filter((i) => categories.includes(i.category))}
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
      // Single-page form has no "next step" — Continue collapses
      // the section so the user knows they're done with it.
      onNext={() => toggleSection(sectionId)}
      isPending={isPending}
    />
  );

  return (
    <main className="min-h-screen bg-stone-50 pb-24">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white">
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

      <div className="max-w-5xl mx-auto px-4 py-6 md:grid md:grid-cols-[200px_1fr] md:gap-8">
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
                className="block text-sm text-[var(--color-ink)] hover:text-[var(--color-sage)] py-1 px-2 -mx-2 rounded hover:bg-stone-100"
              >
                <span className="mr-1.5">{s.icon}</span> {s.label}
              </a>
            ))}
          </div>
        </nav>

        {/* Main column */}
        <div className="space-y-3">
          {SECTIONS.map((s) => {
            const isOpen = openSections.has(s.id);
            return (
              <section
                key={s.id}
                id={s.id}
                className="bg-white rounded-lg border border-stone-200 overflow-hidden scroll-mt-4"
              >
                <div className="flex items-center justify-between px-4 py-3 hover:bg-stone-50 transition-colors">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`${s.id}-body`}
                    onClick={() => toggleSection(s.id)}
                    className="flex items-center text-left flex-1 cursor-pointer"
                  >
                    <span className="text-base font-medium text-[var(--color-ink)]">
                      <span className="mr-2">{s.icon}</span> {s.label}
                    </span>
                  </button>
                  <div className="flex items-center gap-2">
                    {/* KAN-234: section-level visibility toggle for the 6
                        controllable sections (likes / gifts / boundaries /
                        books-media / causes-quotes / more). Items in these
                        sections that have NULL visibility inherit this
                        default at render time. */}
                    {isControllableSectionKey(s.id) && (
                      <label className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <span className="sr-only">Visibility for {s.label}</span>
                        <select
                          value={currentSectionVisibility[s.id] ?? 'public'}
                          onChange={(e) => {
                            const next = e.target.value;
                            startTransition(async () => {
                              await updateSectionVisibility(s.id, next);
                              router.refresh();
                            });
                          }}
                          disabled={isPending}
                          aria-label={`Section visibility for ${s.label}`}
                          className="text-xs px-2 py-1 rounded border border-stone-300 bg-white text-[var(--color-ink)]"
                        >
                          <option value="public">🌍 Public</option>
                          <option value="members_only">🔒 Members</option>
                          <option value="draft">✏️ Draft</option>
                        </select>
                      </label>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleSection(s.id)}
                      aria-label={isOpen ? `Collapse ${s.label}` : `Expand ${s.label}`}
                      className="text-[var(--color-muted)] text-sm px-1"
                    >
                      {isOpen ? '▾' : '▸'}
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div id={`${s.id}-body`} className="px-4 pb-5 pt-1 border-t border-stone-200">
                    {s.id === 'basic-info' && <BasicInfoSection profile={profile} />}
                    {s.id === 'affiliations' && <AffiliationsSection schools={schools} />}
                    {s.id === 'bio' && <BioSection profile={profile} />}
                    {s.id === 'manual-of-me' && <ManualOfMeSection manualOfMe={manualOfMe} />}
                    {s.id === 'likes' && renderItemsSection(
                      s.id,
                      'Likes & Dislikes',
                      "Tastes, interests, and favourites — plus the things you'd rather steer clear of.",
                      ['likes', 'dislikes'],
                    )}
                    {s.id === 'gifts' && renderItemsSection(
                      s.id,
                      'Gift ideas',
                      "Things you'd love to receive, luxuries you don't give yourself, things you can't have enough of — and gifts that aren't for you.",
                      ['gift_ideas', 'gifts_to_avoid'],
                    )}
                    {s.id === 'boundaries' && renderItemsSection(
                      s.id,
                      'Boundaries & Preferences',
                      'Practical preferences, boundaries, and things that help people respect your space.',
                      ['boundaries', 'helpful_to_know'],
                    )}
                    {s.id === 'books-media' && renderItemsSection(
                      s.id,
                      'Books & Media',
                      'Books you love and the screen favourites that shaped you.',
                      ['favourite_books', 'favourite_media'],
                    )}
                    {s.id === 'causes-quotes' && renderItemsSection(
                      s.id,
                      'Things that matter to me',
                      'Causes and charities you care about, and the words that resonate with you.',
                      ['causes', 'quotes'],
                    )}
                    {s.id === 'more' && renderItemsSection(
                      s.id,
                      'More about you',
                      "What you're most proud of, life hacks worth sharing, places you'd recommend, questions you wish people asked, problems you're working on, and your billboard message.",
                      ['proud_of', 'life_hacks', 'questions', 'billboard', 'current_problems'],
                    )}
                    {s.id === 'links' && (
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
                    {s.id === 'files' && (
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
                    {s.id === 'starters' && (
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
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-stone-200 px-4 py-3 z-10">
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
