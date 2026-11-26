/**
 * KAN-488 — the public profile body (spec v0.8 §2 sections 01–10).
 *
 * A server component (no `'use client'`): it renders a `PublicProfileView`
 * built by the profile module's pure `buildPublicProfileView`, so empty
 * fields and sections, hidden affiliations and unapproved AI gifts are
 * already gone before anything here runs. Nothing it receives reaches a
 * client component.
 *
 * Rules:
 *   - Headings are the section labels verbatim, in spec order. About Me has
 *     no heading of its own: it is the page header.
 *   - Every multiline value keeps its line breaks (`whitespace-pre-line`).
 *   - Links are only the view model's already-validated http/https URLs and
 *     open in a new tab with rel="noopener noreferrer" (spec §3).
 *   - No messaging, like, comment or contact controls (spec §1).
 *
 * Calm layout (founder design, Lyra website canvas, 2026-11-23): the page
 * reads like an article rather than a stack of cards. The header sits over a
 * pale sage cover band that the page (`src/app/[slug]/page.tsx`) draws
 * full-width above this component; `AboutHeader` pulls itself up over it.
 * Sections are plain text under a heading with a pale-sage hairline; lists
 * are bulleted "title — description" lines; no white boxes.
 */

import type { ReactNode } from 'react';
import type {
  PublicAboutSection,
  PublicEntry,
  PublicFavouriteGroup,
  PublicProfileView,
  PublicSection,
} from '@/modules/profile/editor/public-view-model';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-sage)] focus-visible:outline-offset-2';
/** Body copy colour for descriptions and answers (the app's prose body). */
const BODY_TEXT = 'text-[16px] text-[#544f49] leading-[1.7]';
/** Small uppercase label used for sub-groups and the §05 prompts. */
const LABEL = 'text-xs font-medium uppercase tracking-[0.05em] text-[var(--color-muted)]';

/** Section heading with a pale-sage hairline beneath it. */
function SectionQ({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="text-[19px] font-bold tracking-[-0.01em] leading-[1.35] text-[var(--color-ink)] pb-2 border-b border-[var(--color-lyra-sage-light)]"
    >
      {children}
    </h2>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className={`${LABEL} mb-1.5`}>{children}</h3>;
}

/** The host a link shows (`www.` dropped). The URL is already validated. */
function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '') || url;
  } catch {
    return url;
  }
}

function EntryLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-[13px] text-[var(--color-sage)] underline underline-offset-2 hover:no-underline whitespace-nowrap ${FOCUS}`}
    >
      {linkHost(url)}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** Bulleted "title — description" lines. */
function EntryList({ entries, gap = 'gap-2.5' }: { entries: readonly PublicEntry[]; gap?: string }) {
  return (
    <ul className={`flex flex-col ${gap}`}>
      {entries.map((e, i) => (
        <li key={`${e.title}-${i}`} className="relative pl-[18px] text-[16px] leading-[1.7] text-[var(--color-ink)]">
          <span aria-hidden="true" className="absolute left-0.5 top-0 text-[var(--color-lyra-sage-light)]">
            •
          </span>
          <span className="font-semibold whitespace-pre-line">{e.title}</span>
          {e.tag && (
            <span className="ml-2 rounded-full px-[9px] py-[2px] text-[11.5px] text-[var(--color-muted)] bg-[#f4efe7]">
              {e.tag}
            </span>
          )}
          {e.description && (
            <>
              <span className="text-[#544f49]"> — </span>
              <span className="text-[#544f49] whitespace-pre-line">{e.description}</span>
            </>
          )}
          {e.url && (
            <>
              {' '}
              <EntryLink url={e.url} />
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Short titles (causes, proud of) as quiet sage tags. */
function Chips({ titles }: { titles: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {titles.map((t, i) => (
        <li key={`${t}-${i}`} className="text-[14px] text-[var(--color-sage)] bg-[#edf2ee] rounded-full px-3 py-1">
          {t}
        </li>
      ))}
    </ul>
  );
}

/** Up to two initials from the display name (first and last word). */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = Array.from(words[0] ?? '')[0] ?? '';
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : '';
  return (first + last).toUpperCase();
}

function PinIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none"
    >
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

function AboutHeader({ section }: { section: PublicAboutSection }) {
  const name = section.displayName ?? '';
  const place = [section.city, section.country].filter((v): v is string => v !== null).join(', ');
  return (
    <>
      {/* -mt pulls the avatar up over the page's cover band. */}
      <header className="relative -mt-[72px] text-center">
        <div className="relative w-[136px] h-[136px] rounded-full mx-auto mb-[18px] overflow-hidden bg-gradient-to-br from-[var(--color-sage)] to-[var(--color-sage-hover)] text-white flex items-center justify-center text-[44px] font-semibold tracking-[0.02em] border-4 border-[#fdfcf8] shadow-[0_6px_18px_rgba(0,0,0,0.12)]">
          {section.photoUrl ? (
            // KAN-488 review: alt="" — decorative, the name is the h1 right
            // below, so alt={name} made screen readers announce it twice.
            // eslint-disable-next-line @next/next/no-img-element -- KAN-265: avatar lives in Supabase Storage, not the Vercel image pipeline
            <img src={section.photoUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <span aria-hidden="true">{initials(name)}</span>
          )}
        </div>
        <h1 className="text-[34px] font-bold tracking-[-0.022em] text-[var(--color-ink)] m-0">{name}</h1>
        {section.headline && (
          <p className="text-[17px] text-[#4f4a44] max-w-[32em] mx-auto mt-2 leading-normal">{section.headline}</p>
        )}
        {(section.lyraId || place) && (
          <div className="flex flex-wrap justify-center items-center gap-2 mt-3.5">
            {section.lyraId && (
              <span className="inline-flex items-center text-[13px] font-medium text-[var(--color-sage)] bg-[#e9efea] rounded-full px-3 py-1">
                @{section.lyraId}
              </span>
            )}
            {place && (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-muted)] bg-white border border-[#ece7df] rounded-full px-3 py-1">
                <PinIcon />
                {place}
              </span>
            )}
          </div>
        )}
      </header>
      <div className="max-w-[680px] mx-auto">
        {section.intro && (
          <p className="mt-10 text-[18px] text-[var(--color-ink)] leading-[1.7] whitespace-pre-line">{section.intro}</p>
        )}
        {(section.causes.length > 0 || section.proudOf.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-7">
            {section.causes.length > 0 && (
              <div>
                <SubHeading>Causes close to my heart</SubHeading>
                <Chips titles={section.causes} />
              </div>
            )}
            {section.proudOf.length > 0 && (
              <div>
                <SubHeading>Things I’m proud of</SubHeading>
                <Chips titles={section.proudOf} />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function FavouriteGroup({ group }: { group: PublicFavouriteGroup }) {
  return (
    <div>
      <h3 className="text-[15px] font-bold mb-2 text-[var(--color-ink)]">{group.label}</h3>
      {group.key === 'fav_quotes' ? (
        <ul className="flex flex-col gap-4">
          {group.entries.map((e, i) => (
            <li key={`${e.title}-${i}`}>
              <blockquote className="m-0 pl-3.5 border-l-2 border-[var(--color-lyra-sage-light)]">
                <p className="text-[16px] italic leading-[1.6] text-[var(--color-ink)] whitespace-pre-line">
                  “{e.title}”
                </p>
                {e.description && <p className="mt-1 text-sm text-[var(--color-muted)]">{e.description}</p>}
              </blockquote>
            </li>
          ))}
        </ul>
      ) : (
        <EntryList entries={group.entries} gap="gap-1.5" />
      )}
    </div>
  );
}

function SectionBody({ section }: { section: Exclude<PublicSection, PublicAboutSection> }) {
  switch (section.id) {
    case 'affiliations':
      return (
        <div className="flex flex-col gap-5">
          {section.groups.map((g) => (
            <div key={g.type}>
              <SubHeading>{g.label}</SubHeading>
              <EntryList
                entries={g.entries.map((e) => ({
                  title: e.name,
                  description: [e.location, e.description].filter((v): v is string => v !== null).join(' · ') || null,
                  url: null,
                  tag: null,
                }))}
              />
            </div>
          ))}
        </div>
      );
    case 'gifts':
      return (
        <div className="flex flex-col gap-4">
          {section.preference && <p className={`${BODY_TEXT} whitespace-pre-line`}>{section.preference}</p>}
          {section.userGifts.length > 0 && <EntryList entries={section.userGifts} />}
          {section.aiSuggested.length > 0 && (
            <div className="mt-2">
              <SubHeading>{section.aiGroupLabel}</SubHeading>
              <EntryList entries={section.aiSuggested} />
            </div>
          )}
        </div>
      );
    case 'notforme':
    case 'tips':
    case 'problems':
      return <EntryList entries={section.entries} />;
    case 'understand':
      return (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-6">
          {section.items.map((it) => (
            <div key={it.field}>
              <dt className={`${LABEL} mb-1.5`}>{it.label}</dt>
              <dd className={`${BODY_TEXT} whitespace-pre-line`}>{it.text}</dd>
            </div>
          ))}
        </dl>
      );
    case 'favourites':
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-8">
          {section.groups.map((g) => (
            <FavouriteGroup key={g.key} group={g} />
          ))}
        </div>
      );
    case 'starters':
      return (
        <dl className="space-y-5">
          {section.items.map((it, i) => (
            <div key={`${it.question}-${i}`}>
              <dt className="font-semibold text-[16px] text-[var(--color-ink)] mb-0.5">{it.question}</dt>
              <dd className={`${BODY_TEXT} whitespace-pre-line`}>{it.answer}</dd>
            </div>
          ))}
        </dl>
      );
    case 'billboard':
      return (
        <div className="mt-1 py-7 px-2 text-center border-y border-[#ece7df]">
          <p className="text-[28px] font-bold tracking-[-0.01em] leading-[1.35] text-[var(--color-sage)] whitespace-pre-line">
            {section.text}
          </p>
        </div>
      );
    default: {
      const never: never = section;
      return never;
    }
  }
}

/** The ten v0.8 sections of a published profile, in spec order. */
export function PublicProfileSections({ view }: { view: PublicProfileView }) {
  return (
    <>
      {view.sections.map((s) => {
        if (s.id === 'about') return <AboutHeader key={s.id} section={s} />;
        const headingId = `section-${s.id}`;
        return (
          <section key={s.id} aria-labelledby={headingId} className="max-w-[680px] mx-auto mt-[52px]">
            <SectionQ id={headingId}>{s.label}</SectionQ>
            <div className="mt-4">
              <SectionBody section={s} />
            </div>
          </section>
        );
      })}
    </>
  );
}
