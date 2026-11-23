'use client';

/**
 * KAN-487 — v0.8 profile editor: the AI gift suggestions slot inside
 * section 03 "Gifts" (spec v0.8 §03; plan §C row 03).
 *
 * Step 4 (this ticket) has no AI generation. The slot renders NOTHING unless
 * the member already has APPROVED AI suggestions (`approvedAiGifts`); then it
 * shows them read-only under the spec label "AI suggested", each with a
 * Remove button that dispatches `deleteAiGift` (spec: "Deleting a suggestion
 * dismisses only that item"; committed on save via `ai_gifts.delete`).
 * Unapproved suggestions are never shown here and never published.
 *
 * This is the step-6 mount point: step 6 adds the toggle (OFF by default),
 * Generate suggestions, the generation counter and approve/delete for
 * unapproved items, wired to `ai_gifts` in the payload. It should extend
 * `GiftsAiSlotProps` rather than change the call site.
 */

import { useState } from 'react';
import { approvedAiGifts } from '@/modules/profile/editor/affiliation-gift-ui';
import { linkChip, oneLine, rowLabel, undoMessage, SUMMARY_DESCRIPTION_MAX } from '@/modules/profile/editor/editor-ui-helpers';
import type { AiGiftRow, EditorAction } from './editor-context';

/** Spec v0.8 §03 label for AI-origin gifts. */
export const AI_SUGGESTED_LABEL = 'AI suggested';

export interface GiftsAiSlotProps {
  /** `state.aiGifts` — every AI row (approved and not). */
  aiItems: readonly AiGiftRow[];
  dispatch: (a: EditorAction) => void;
  readOnly?: boolean;
}

const BUTTON_FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-sage)] focus-visible:outline-offset-2';

export function GiftsAiSlot({ aiItems, dispatch, readOnly = false }: GiftsAiSlotProps) {
  const approved = approvedAiGifts(aiItems);
  // Last removal, announced politely (proposed copy "Removed '‹title›'.").
  const [announce, setAnnounce] = useState('');

  if (approved.length === 0) {
    return (
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    );
  }

  return (
    <div className="space-y-3" role="group" aria-labelledby="gifts-ai-heading">
      <h3 id="gifts-ai-heading" className="text-sm font-semibold text-[var(--color-ink)]">
        {AI_SUGGESTED_LABEL}
      </h3>
      <ul className="space-y-2">
        {approved.map((g, i) => {
          const label = rowLabel(g.title, g.description);
          const desc = oneLine(g.description, SUMMARY_DESCRIPTION_MAX);
          const chip = linkChip(g.url);
          return (
            <li key={g.id} className="bg-white rounded-lg border border-[var(--color-border)] px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[var(--color-ink)] truncate">
                    <span className="font-medium">{label}</span>
                    {desc && g.title.trim() !== '' && <span className="text-[var(--color-muted)]"> — {desc}</span>}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full px-[9px] py-[2px] text-[11.5px] text-[var(--color-muted)] bg-[#f4efe7]">
                      {AI_SUGGESTED_LABEL}
                    </span>
                    {chip.text &&
                      (chip.href ? (
                        <a
                          href={chip.href}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className={`rounded-full px-[11px] py-[3px] text-[12.5px] text-[var(--color-sage)] bg-[var(--color-accent-soft)] hover:underline ${BUTTON_FOCUS}`}
                        >
                          {chip.text}
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ) : (
                        <span className="rounded-full px-[11px] py-[3px] text-[12.5px] text-[var(--color-muted)] bg-[#f4efe7]">
                          {chip.text}
                        </span>
                      ))}
                  </div>
                </div>
                <button
                  type="button"
                  id={`gifts-ai-remove-${i}`}
                  onClick={() => {
                    dispatch({ type: 'deleteAiGift', id: g.id });
                    setAnnounce(undoMessage(label));
                    // Keep focus in the list: the next row's Remove takes this index.
                    const nextIndex = i < approved.length - 1 ? i : i - 1;
                    window.requestAnimationFrame(() => document.getElementById(`gifts-ai-remove-${nextIndex}`)?.focus());
                  }}
                  disabled={readOnly}
                  aria-label={`Remove ${label || 'suggestion'}`}
                  className={`shrink-0 text-xs font-medium px-2 py-1 rounded-lg text-red-600 hover:text-red-700 disabled:opacity-50 ${BUTTON_FOCUS}`}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
