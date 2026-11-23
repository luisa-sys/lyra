'use client';

/**
 * KAN-487 — v0.8 profile editor Preview (spec v0.8 §1 "Preview"; plan §A
 * `profile-preview.tsx`, "Pure logic" → `public-view-model.ts`).
 *
 * Draws the editor's IN-MEMORY state — nothing is saved — through the pure
 * `buildPublicProfileView(state, { audience: 'owner-preview' })`, so what the
 * member previews is filtered exactly like the public page: empty fields and
 * sections dropped, hidden affiliations and unapproved AI gifts never shown,
 * sections in spec order, line breaks kept.
 *
 * A native modal `<dialog>`: focus moves to Close on open, Tab wraps inside,
 * Escape closes, and focus returns to the opener on close. The look is a
 * close match to the public profile; the shared renderer arrives in step 5
 * (plan §A: expect a small visual difference from `[slug]/page.tsx` until
 * then).
 */

import { useEffect, useId, useMemo, useRef } from 'react';
import {
  buildPublicProfileView,
  type PublicEntry,
  type PublicSection,
} from '@/modules/profile/editor/public-view-model';
import type { EditorState } from '@/modules/profile/editor/editor-state';
import { linkChipText } from '@/modules/profile/editor/editor-ui-helpers';

export interface ProfilePreviewProps {
  open: boolean;
  state: EditorState;
  onClose: () => void;
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-sage)] focus-visible:outline-offset-2';
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const HEADING = 'border-l-[3px] border-[var(--color-sage)] pl-3 text-[15px] font-semibold text-[var(--color-ink)] leading-snug mb-3';
const LINK_CHIP =
  'inline-block rounded-full px-[11px] py-[3px] text-[12.5px] text-[var(--color-sage)] bg-[var(--color-accent-soft)] mt-1';

function EntryList({ entries }: { entries: readonly PublicEntry[] }) {
  return (
    <ul className="space-y-2">
      {entries.map((e, i) => (
        <li key={`${e.title}-${i}`} className="text-sm text-[var(--color-ink)] leading-relaxed">
          <span className="font-medium whitespace-pre-line">{e.title}</span>
          {e.tag && (
            <span className="ml-2 rounded-full px-[9px] py-[2px] text-[11.5px] text-[var(--color-muted)] bg-[#f4efe7]">
              {e.tag}
            </span>
          )}
          {e.description && <span className="block text-[var(--color-muted)] whitespace-pre-line">{e.description}</span>}
          {e.url && (
            <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className={`${LINK_CHIP} ${FOCUS}`}>
              {linkChipText(e.url)}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function SectionBody({ section }: { section: PublicSection }) {
  switch (section.id) {
    case 'about':
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            {section.photoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- KAN-487: stored URL or local preview of a staged photo, not a Next/Image asset.
              <img src={section.photoUrl} alt="Profile photo" className="w-20 h-20 rounded-full object-cover" />
            )}
            <div>
              {section.displayName && <p className="text-lg font-semibold text-[var(--color-ink)]">{section.displayName}</p>}
              {section.headline && <p className="text-sm text-[var(--color-ink)]">{section.headline}</p>}
              {(section.city || section.country) && (
                <p className="text-sm text-[var(--color-muted)]">{[section.city, section.country].filter(Boolean).join(', ')}</p>
              )}
              {section.lyraId && <p className="text-xs text-[var(--color-muted)]">checklyra.com/{section.lyraId}</p>}
            </div>
          </div>
          {section.intro && <p className="text-sm text-[var(--color-ink)] whitespace-pre-line leading-relaxed">{section.intro}</p>}
          {section.causes.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-[var(--color-ink)] mb-1">Causes close to my heart</h4>
              <EntryList entries={section.causes.map((title) => ({ title, description: null, url: null, tag: null }))} />
            </div>
          )}
          {section.proudOf.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-[var(--color-ink)] mb-1">Things I&apos;m proud of</h4>
              <EntryList entries={section.proudOf.map((title) => ({ title, description: null, url: null, tag: null }))} />
            </div>
          )}
        </div>
      );
    case 'affiliations':
      return (
        <div className="space-y-3">
          {section.groups.map((g) => (
            <div key={g.type}>
              <h4 className="text-sm font-medium text-[var(--color-ink)] mb-1">{g.label}</h4>
              <EntryList
                entries={g.entries.map((e) => ({
                  title: e.name,
                  description: [e.location, e.description].filter(Boolean).join(' — ') || null,
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
        <div className="space-y-3">
          {section.preference && <p className="text-sm text-[var(--color-ink)] whitespace-pre-line">{section.preference}</p>}
          {section.userGifts.length > 0 && <EntryList entries={section.userGifts} />}
          {section.aiSuggested.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-[var(--color-ink)] mb-1">{section.aiGroupLabel}</h4>
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
        <dl className="space-y-3">
          {section.items.map((it) => (
            <div key={it.field}>
              <dt className="text-sm font-medium text-[var(--color-ink)]">{it.label}</dt>
              <dd className="text-sm text-[var(--color-ink)] whitespace-pre-line leading-relaxed">{it.text}</dd>
            </div>
          ))}
        </dl>
      );
    case 'favourites':
      return (
        <div className="space-y-3">
          {section.groups.map((g) => (
            <div key={g.key}>
              <h4 className="text-sm font-medium text-[var(--color-ink)] mb-1">{g.label}</h4>
              <EntryList entries={g.entries} />
            </div>
          ))}
        </div>
      );
    case 'starters':
      return (
        <dl className="space-y-3">
          {section.items.map((it, i) => (
            <div key={`${it.question}-${i}`}>
              <dt className="text-sm font-medium text-[var(--color-ink)]">{it.question}</dt>
              <dd className="text-sm text-[var(--color-ink)] whitespace-pre-line leading-relaxed">{it.answer}</dd>
            </div>
          ))}
        </dl>
      );
    case 'billboard':
      return <p className="text-base text-[var(--color-ink)] whitespace-pre-line leading-relaxed">{section.text}</p>;
    default: {
      const never: never = section;
      return never;
    }
  }
}

export function ProfilePreview({ open, state, onClose }: ProfilePreviewProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const view = useMemo(() => (open ? buildPublicProfileView(state, { audience: 'owner-preview' }) : null), [open, state]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      closeRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== 'Tab') return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="w-[min(94vw,760px)] max-h-[90vh] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-paper)] p-0 text-[var(--color-ink)] shadow-[0_8px_30px_rgba(0,0,0,0.12)] backdrop:bg-black/30"
    >
      <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-white px-5 py-3">
        <h2 id={titleId} className="text-[15px] font-semibold">
          Preview
        </h2>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className={`px-4 py-2 rounded-lg bg-[#f4efe7] text-sm font-medium text-[var(--color-ink)] hover:bg-[#ece7df] transition-colors ${FOCUS}`}
        >
          Close
        </button>
      </div>
      <div className="space-y-3 p-5">
        {view?.sections.map((s) => (
          <section
            key={s.id}
            aria-label={s.label}
            className="bg-white rounded-[10px] border border-[var(--color-border)] px-4 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
          >
            {s.id !== 'about' && <h3 className={HEADING}>{s.label}</h3>}
            <SectionBody section={s} />
          </section>
        ))}
      </div>
    </dialog>
  );
}
