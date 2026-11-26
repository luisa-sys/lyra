'use client';

/**
 * KAN-487 — v0.8 profile editor table of contents (plan §A component tree
 * `editor-toc.tsx`). Desktop-only sidebar: one same-page link per section,
 * in spec order, to the section card's id anchor (`#about` … `#billboard`).
 * Hash links are never caught by the unsaved-changes guard.
 */

import { sectionHeadingText } from '@/modules/profile/editor/editor-ui-helpers';

export interface EditorTocEntry {
  id: string;
  number: number;
  label: string;
}

export function EditorToc({ sections }: { sections: readonly EditorTocEntry[] }) {
  return (
    <nav aria-label="Section navigation" className="hidden md:block">
      <div className="sticky top-4 space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)] mb-2">Sections</p>
        <ol className="space-y-1">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="block text-sm text-[var(--color-ink)] hover:text-[var(--color-sage)] py-1 px-2 -mx-2 rounded hover:bg-[#f1ece3] leading-snug focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-sage)] focus-visible:outline-offset-2"
              >
                {sectionHeadingText(s.number, s.label)}
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
