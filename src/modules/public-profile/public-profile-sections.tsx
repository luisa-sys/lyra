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
 */

import type { ReactNode } from 'react';
import type {
  PublicAboutSection,
  PublicEntry,
  PublicProfileView,
  PublicSection,
} from '@/modules/profile/editor/public-view-model';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-sage)] focus-visible:outline-offset-2';
const CARD =
  'bg-white border border-[#ece7df] rounded-[10px] px-[18px] py-[15px] mt-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)]';
const MUTED_TEXT = 'text-[14.5px] text-[#544f49] leading-relaxed whitespace-pre-line';

/** Warm question heading with the 3px sage left rule (KAN-265). */
function SectionQ({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="text-[19px] font-bold tracking-[-0.01em] text-[var(--color-ink)] border-l-[3px] border-[var(--color-sage)] pl-[13px] mb-1.5"
    >
      {children}
    </h2>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[13px] uppercase tracking-wide text-[var(--color-muted)] mt-3.5 mb-1 first:mt-0">
      {children}
    </h3>
  );
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
      className={`inline-block mt-1.5 text-[12.5px] text-[var(--color-sage)] bg-[#e9efea] rounded-full px-[11px] py-[3px] no-underline hover:underline ${FOCUS}`}
    >
      {linkHost(url)}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function EntryList({ entries }: { entries: readonly PublicEntry[] }) {
  return (
    <ul>
      {entries.map((e, i) => (
        <li key={`${e.title}-${i}`} className="py-2 border-b border-dashed border-[#ece7df] last:border-0">
          <div className="text-[14.5px] leading-snug">
            <span className="font-semibold text-[var(--color-ink)] whitespace-pre-line">{e.title}</span>
            {e.tag && (
              <span className="ml-2 rounded-full px-[9px] py-[2px] text-[11.5px] text-[var(--color-muted)] bg-[#f4efe7]">
                {e.tag}
              </span>
            )}
          </div>
          {e.description && <div className={`${MUTED_TEXT} mt-[3px]`}>{e.description}</div>}
          {e.url && <EntryLink url={e.url} />}
        </li>
      ))}
    </ul>
  );
}

function TitleList({ titles }: { titles: readonly string[] }) {
  return <EntryList entries={titles.map((title) => ({ title, description: null, url: null, tag: null }))} />;
}

function AboutHeader({ section }: { section: PublicAboutSection }) {
  const name = section.displayName ?? '';
  const place = [section.city, section.country].filter((v): v is string => v !== null).join(', ');
  return (
    <>
      <header className="text-center mb-3.5">
        <div className="relative w-32 h-32 rounded-full mx-auto mb-4 overflow-hidden bg-gradient-to-br from-[#dcd2ca] to-[#b09a8e] text-white flex items-center justify-center font-[family-name:var(--font-serif)] text-[46px] shadow-[0_6px_18px_rgba(0,0,0,0.12)]">
          {section.photoUrl ? (
            // KAN-488 review: alt="" — decorative, the name is the h1 right
            // below, so alt={name} made screen readers announce it twice.
            // eslint-disable-next-line @next/next/no-img-element -- KAN-265: avatar lives in Supabase Storage, not the Vercel image pipeline
            <img src={section.photoUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <span aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
          )}
        </div>
        <h1 className="font-[family-name:var(--font-serif)] text-[32px] font-bold tracking-[-0.022em] text-[var(--color-ink)] m-0">
          {name}
        </h1>
        {section.lyraId && <p className="text-[14px] text-[var(--color-muted)] mt-1">@{section.lyraId}</p>}
        {section.headline && (
          <p className="text-[16.5px] text-[#4f4a44] max-w-[34em] mx-auto mt-[7px] mb-[9px]">{section.headline}</p>
        )}
        {place && <p className="text-[14px] text-[var(--color-muted)]">{place}</p>}
      </header>
      {section.intro && (
        <div className={CARD}>
          <p className="text-[var(--color-ink)] leading-relaxed whitespace-pre-line">{section.intro}</p>
        </div>
      )}
      {(section.causes.length > 0 || section.proudOf.length > 0) && (
        <div className={CARD}>
          {section.causes.length > 0 && (
            <div className="mb-1">
              <SubHeading>Causes close to my heart</SubHeading>
              <TitleList titles={section.causes} />
            </div>
          )}
          {section.proudOf.length > 0 && (
            <div className="mb-1">
              <SubHeading>Things I’m proud of</SubHeading>
              <TitleList titles={section.proudOf} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function SectionBody({ section }: { section: Exclude<PublicSection, PublicAboutSection> }) {
  switch (section.id) {
    case 'affiliations':
      return (
        <div className={CARD}>
          {section.groups.map((g) => (
            <div key={g.type} className="mb-1">
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
        <>
          {section.preference && (
            <div className={CARD}>
              <p className={MUTED_TEXT}>{section.preference}</p>
            </div>
          )}
          {section.userGifts.length > 0 && (
            <div className={CARD}>
              <EntryList entries={section.userGifts} />
            </div>
          )}
          {section.aiSuggested.length > 0 && (
            <div className={CARD}>
              <SubHeading>{section.aiGroupLabel}</SubHeading>
              <EntryList entries={section.aiSuggested} />
            </div>
          )}
        </>
      );
    case 'notforme':
    case 'tips':
    case 'problems':
      return (
        <div className={CARD}>
          <EntryList entries={section.entries} />
        </div>
      );
    case 'understand':
      return (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
          {section.items.map((it) => (
            <div
              key={it.field}
              className="bg-white border border-[#ece7df] rounded-[10px] px-[18px] py-[15px] shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
            >
              <dt className="text-xs uppercase tracking-wide text-[var(--color-muted)] mb-1">{it.label}</dt>
              <dd className={MUTED_TEXT}>{it.text}</dd>
            </div>
          ))}
        </dl>
      );
    case 'favourites':
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
          {section.groups.map((g) => (
            <div key={g.key} className="bg-white border border-[#ece7df] rounded-[10px] pt-3.5 px-4 pb-3">
              <h3 className="font-[family-name:var(--font-serif)] text-[15px] font-bold mb-2 text-[var(--color-ink)]">
                {g.label}
              </h3>
              <EntryList entries={g.entries} />
            </div>
          ))}
        </div>
      );
    case 'starters':
      return (
        <dl className="mt-3 space-y-5">
          {section.items.map((it, i) => (
            <div key={`${it.question}-${i}`}>
              <dt className="font-semibold text-[15px] text-[var(--color-ink)] mb-[3px]">{it.question}</dt>
              <dd className="text-[15.5px] text-[#544f49] whitespace-pre-line leading-relaxed">{it.answer}</dd>
            </div>
          ))}
        </dl>
      );
    case 'billboard':
      return (
        <div className="mt-3 rounded-[10px] bg-[var(--color-sage)] px-6 py-8 text-center shadow-[0_6px_18px_rgba(0,0,0,0.12)]">
          <p className="font-[family-name:var(--font-serif)] text-[26px] sm:text-[30px] font-bold leading-snug text-white whitespace-pre-line">
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
          <section key={s.id} aria-labelledby={headingId} className="mt-11">
            <SectionQ id={headingId}>{s.label}</SectionQ>
            <SectionBody section={s} />
          </section>
        );
      })}
    </>
  );
}
