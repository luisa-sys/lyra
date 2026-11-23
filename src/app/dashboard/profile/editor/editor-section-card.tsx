'use client';

/**
 * KAN-487 — v0.8 profile editor: one collapsible section card with a
 * numbered heading, e.g. "01 — About Me" (spec v0.8 §01–§10 order; plan §A
 * component tree, §E card + heading classes).
 *
 *   - `id` is the section's anchor for the table of contents (`#about`, …);
 *     ids MUST be the spec ids (about, affiliations, gifts, notforme,
 *     understand, favourites, tips, problems, starters, billboard).
 *   - The heading is an `<h2>` holding one real `<button>` with
 *     `aria-expanded` / `aria-controls`.
 *   - Collapsed bodies stay mounted but `hidden`, so in-progress UI state
 *     (expanded rows, an undo row's timer) survives a collapse.
 *   - Controlled (`open` + `onToggle`) or uncontrolled (`defaultOpen`).
 *   - A collapsed card opens itself when a field inside it asks to be
 *     revealed (`revealAndFocus`: the jump to the first invalid field, the
 *     publish-blocker links), so those jumps never land in a hidden body.
 */

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { sectionHeadingText } from '@/modules/profile/editor/editor-ui-helpers';

export interface EditorSectionCardProps {
  id: string;
  /** Spec section number, 1–10. */
  number: number;
  label: string;
  /** Optional intro at the top of the body, above the children. */
  description?: React.ReactNode;
  open?: boolean;
  onToggle?: (id: string, nextOpen: boolean) => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/** Bubbling DOM event a field dispatches to have its section card opened. */
export const REVEAL_EVENT = 'lyra-editor:reveal';

/**
 * Move focus to `el`, opening its (collapsed) section card first. Runs in a
 * microtask so it is safe to call from an effect or an event handler: the
 * card opens synchronously (`flushSync`) before the scroll and focus.
 */
export function revealAndFocus(el: HTMLElement): void {
  queueMicrotask(() => {
    el.dispatchEvent(new Event(REVEAL_EVENT, { bubbles: true }));
    el.scrollIntoView({ block: 'center' });
    el.focus();
  });
}

export function EditorSectionCard({
  id,
  number,
  label,
  description,
  open,
  onToggle,
  defaultOpen = true,
  children,
}: EditorSectionCardProps) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const isOpen = open ?? ownOpen;
  const bodyId = `${id}-body`;
  const headingText = sectionHeadingText(number, label);

  const sectionRef = useRef<HTMLElement>(null);
  const latest = useRef({ isOpen, open, onToggle, id });
  useEffect(() => {
    latest.current = { isOpen, open, onToggle, id };
  });

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const onReveal = () => {
      const l = latest.current;
      if (l.isOpen) return;
      flushSync(() => {
        if (l.open === undefined) setOwnOpen(true);
        l.onToggle?.(l.id, true);
      });
    };
    node.addEventListener(REVEAL_EVENT, onReveal);
    return () => node.removeEventListener(REVEAL_EVENT, onReveal);
  }, []);

  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setOwnOpen(next);
    onToggle?.(id, next);
  };

  return (
    <section
      ref={sectionRef}
      id={id}
      aria-labelledby={`${id}-heading`}
      className="bg-white rounded-[10px] border border-[var(--color-border)] overflow-hidden scroll-mt-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
    >
      <h2 id={`${id}-heading`} className="m-0">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={toggle}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#faf8f3] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-sage)] focus-visible:-outline-offset-2"
        >
          <span className="border-l-[3px] border-[var(--color-sage)] pl-3 text-[15px] font-semibold text-[var(--color-ink)] leading-snug">
            {headingText}
          </span>
          <span aria-hidden="true" className="text-[var(--color-muted)] text-sm px-1 shrink-0">
            {isOpen ? '▾' : '▸'}
          </span>
        </button>
      </h2>
      <div id={bodyId} hidden={!isOpen} className="px-4 pb-5 pt-3 border-t border-[var(--color-border)]">
        {description && <div className="text-sm text-[var(--color-muted)] leading-relaxed mb-4">{description}</div>}
        {children}
      </div>
    </section>
  );
}
