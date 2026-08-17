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
  updateProfileItem,
  updateProfileItemVisibility,
  addExternalLink,
  removeExternalLink,
  updateExternalLink,
  publishProfile,
} from './actions';
import {
  ItemsStep,
  LinksStep,
  ConversationStartersStep,
  type WizardProfile,
  type WizardItem,
  type WizardSchool,
  type WizardLink,
  type ConversationPrompt,
  type ConversationAnswer,
} from './steps';
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
  GiftExtrasSection,
  AutoSaveStatusLabel,
  type AutoSaveStatus,
  type GiftSuggestionView,
} from './sections';
import type { ManualOfMe } from '@/modules/profile/manual-of-me-fields';
import {
  FAVOURITE_CATEGORIES,
  FAVOURITE_CATEGORY_OPTIONS,
  CUSTOM_FAVOURITE_CATEGORY,
  favouriteLabelForItem,
} from '@/modules/profile/favourites';

type SectionKind = 'basic' | 'affiliations' | 'bio' | 'manual' | 'items' | 'starters' | 'links';

interface SectionDef {
  id: string;
  label: string;
  icon: string;
  kind: SectionKind;
  categories?: string[];
  description?: string;
  // KAN-444: a section whose categories are grouped under fewer headings
  // supplies its own picker options, so the member chooses a group rather
  // than a raw category. See ./favourites.
  categoryOptions?: ReadonlyArray<{ value: string; label: string }>;
  groupLabelCategory?: string;
  labelForItem?: (item: WizardItem) => string | null;
  // KAN-443: 'inline' drops the per-row category prefix and puts the item's
  // description on the same line as its name, with any link underneath —
  // matching how the public profile renders a list. Omitted everywhere else, so
  // the other eleven sections keep the labelled layout exactly as it was.
  rowLayout?: 'label' | 'inline';
  // KAN-443: extra controls rendered after the list. Only the gifts section has
  // any (the voucher hint + dismissable suggestions).
  extras?: 'gifts';
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
    // KAN-443: one category, so the per-row "🎁 Gift idea —" prefix said the
    // same thing on every line and pushed the name off the start of it.
    rowLayout: 'inline',
    extras: 'gifts',
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
    // KAN-444: five fixed groups plus one you name yourself. Categories,
    // group headings and the picker all come from ./favourites, which the
    // public profile reads too — so the groups a member edits are exactly
    // the groups they get. 'causes' is not here: it has its own section.
    id: 'favourites',
    label: 'A few of my favourite things',
    icon: '⭐',
    kind: 'items',
    categories: FAVOURITE_CATEGORIES,
    categoryOptions: FAVOURITE_CATEGORY_OPTIONS,
    groupLabelCategory: CUSTOM_FAVOURITE_CATEGORY,
    labelForItem: favouriteLabelForItem,
    description: 'Books, films, plays and TV, music, places, and the quotes you come back to — or add a group of your own.',
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
    label: 'A bit more about me',
    icon: '💬',
    kind: 'starters',
    description: 'Random things about you — answer any that take your fancy, or write your own.',
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
];

export function EditProfileForm({
  profile,
  items,
  schools,
  links,
  manualOfMe,
  conversationPrompts,
  conversationAnswers,
  conveneEnabled = false,
  giftSuggestions = [],
}: {
  profile: WizardProfile;
  items: WizardItem[];
  schools: WizardSchool[];
  links: WizardLink[];
  manualOfMe: ManualOfMe;
  conversationPrompts: ConversationPrompt[];
  conversationAnswers: ConversationAnswer[];
  conveneEnabled?: boolean;
  // KAN-443: computed by the page (getRecommendations is pure), each already
  // flagged with whether the member has said "not for me" to it.
  giftSuggestions?: GiftSuggestionView[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [publishError, setPublishError] = useState<string | null>(null);

  // KAN-404 (#8/#9): list sections (items/links/starters) commit each row
  // instantly on Add/Remove, so there's nothing buffered to flush — a Save
  // button would be a no-op. Instead give each its own transient
  // Saving…/Saved indicator, keyed by section id, so every section visibly
  // shows saved-state while honouring "everything autosaves". A short-lived
  // 'saved' auto-clears back to 'idle'.
  const [sectionStatus, setSectionStatus] = useState<Record<string, AutoSaveStatus>>({});

  const runSectionSave = (sectionId: string, action: () => Promise<{ success: boolean } | void>) => {
    setSectionStatus((prev) => ({ ...prev, [sectionId]: 'saving' }));
    startTransition(async () => {
      const res = await action();
      const ok = res == null || res.success !== false;
      router.refresh();
      setSectionStatus((prev) => ({ ...prev, [sectionId]: ok ? 'saved' : 'error' }));
      if (ok) {
        setTimeout(() => {
          setSectionStatus((prev) => (prev[sectionId] === 'saved' ? { ...prev, [sectionId]: 'idle' } : prev));
        }, 2000);
      }
    });
  };

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
    <div className="space-y-3">
      <div className="flex justify-end">
        <AutoSaveStatusLabel status={sectionStatus[s.id] ?? 'idle'} />
      </div>
    <ItemsStep
      title=""
      description={s.description ?? ''}
      categories={s.categories ?? []}
      categoryOptions={s.categoryOptions}
      groupLabelCategory={s.groupLabelCategory}
      labelForItem={s.labelForItem}
      rowLayout={s.rowLayout}
      items={items.filter((i) => (s.categories ?? []).includes(i.category))}
      // KAN-266: redesign drops per-item visibility.
      hideVisibility
      onAdd={(data) => {
        runSectionSave(s.id, () => addProfileItem(data));
      }}
      onRemove={(id) => {
        runSectionSave(s.id, () => removeProfileItem(id));
      }}
      onUpdateVisibility={(id, visibility) => {
        runSectionSave(s.id, () => updateProfileItemVisibility(id, visibility));
      }}
      // KAN-404 (#12): inline edit — call the action directly and await the
      // result so the row can surface a moderation error in place (a
      // startTransition without a return value couldn't). router.refresh() on
      // success re-pulls the persisted row.
      onEdit={async (id, data) => {
        const res = await updateProfileItem(id, data);
        if (res.success) router.refresh();
        return { success: res.success, error: res.success ? undefined : res.error };
      }}
      // KAN-404 (#8/#9): drop the misleading "Continue →" button (it only
      // collapsed the section). Collapse stays available via the header chevron.
      showContinue={false}
      onNext={() => toggleSection(s.id)}
      isPending={isPending}
    />
    {/* KAN-443: the gifts section carries two extras the other list sections
        have no equivalent of — the optional "I'd rather choose" line, and the
        auto-generated suggestions the member can dismiss one at a time. */}
    {s.extras === 'gifts' && (
      <div className="pt-2 border-t border-[#ece7df]">
        <GiftExtrasSection profile={profile} suggestions={giftSuggestions} />
      </div>
    )}
    </div>
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
            {conveneEnabled && (
              <Link
                href="/dashboard/convene/gatherings"
                className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] transition-colors"
              >
                Convene
              </Link>
            )}
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
                      <div className="space-y-3">
                        <div className="flex justify-end">
                          <AutoSaveStatusLabel status={sectionStatus[s.id] ?? 'idle'} />
                        </div>
                        <LinksStep
                          links={links}
                          onAdd={(data) => {
                            runSectionSave(s.id, () => addExternalLink(data));
                          }}
                          onRemove={(id) => {
                            runSectionSave(s.id, () => removeExternalLink(id));
                          }}
                          // KAN-447: inline edit — same shape as the items
                          // section. Awaited directly so a moderation block
                          // surfaces on the row rather than in the section
                          // status; router.refresh() re-pulls the saved row.
                          onEdit={async (id, data) => {
                            const res = await updateExternalLink(id, data);
                            if (res.success) router.refresh();
                            return { success: res.success, error: res.success ? undefined : res.error };
                          }}
                          showContinue={false}
                          onNext={() => toggleSection(s.id)}
                          isPending={isPending}
                        />
                      </div>
                    )}
                    {s.kind === 'starters' && (
                      <div className="space-y-3">
                        <div className="flex justify-end">
                          <AutoSaveStatusLabel status={sectionStatus[s.id] ?? 'idle'} />
                        </div>
                        <ConversationStartersStep
                          prompts={conversationPrompts}
                          answers={conversationAnswers}
                          onAdd={(input) => {
                            runSectionSave(s.id, () => addConversationStarter(input));
                          }}
                          // KAN-448: awaited directly, like the items and links
                          // edits, so a moderation block surfaces on the answer
                          // being edited instead of only flipping the section
                          // status to error.
                          onUpdate={async (id, answer, customPrompt) => {
                            const res = await updateConversationStarter(id, answer, customPrompt);
                            if (res.success) router.refresh();
                            return { success: res.success, error: res.success ? undefined : res.error };
                          }}
                          onRemove={(id) => {
                            runSectionSave(s.id, () => removeConversationStarter(id));
                          }}
                          showContinue={false}
                          onNext={() => toggleSection(s.id)}
                          isPending={isPending}
                        />
                      </div>
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
          <div className="min-w-0">
            <p className="text-xs text-[var(--color-muted)] hidden sm:block">
              Everything saves automatically — use Save on any section to save it right away.
            </p>
            {publishError && (
              <p className="text-xs text-red-700 mt-0.5">{publishError}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setPublishError(null);
              startTransition(async () => {
                const res = await publishProfile();
                if (res?.success) {
                  router.refresh();
                  router.push('/dashboard');
                } else {
                  setPublishError(res?.error ?? 'Could not publish. Please try again.');
                }
              });
            }}
            disabled={isPending}
            className="shrink-0 px-5 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {profile.is_published ? 'Re-publish' : 'Publish'}
          </button>
        </div>
      </div>
    </main>
  );
}
