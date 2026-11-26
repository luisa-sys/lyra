'use client';

/**
 * KAN-489 — v0.8 profile editor: AI gift suggestions inside section 03
 * "Gifts" (spec v0.8 §03; KAN-489 plan §4). Mounted by section-gifts.tsx with
 * the unchanged `GiftsAiSlotProps`; generation needs the form's session and
 * baseline, which come from `AiGiftsContext`.
 *
 *   - "Suggest gift ideas with AI" is a switch, OFF by default (client state).
 *     OFF hides only the generation controls; suggestions already held —
 *     pending or approved — stay visible and actionable, and nothing is ever
 *     deleted by switching it off.
 *   - The first time it is switched on in a session, the data-sharing note is
 *     shown and Generate appears only after "Got it". The note's text was
 *     approved by the founder on 2026-11-23 (spec v0.8 §03). Every Generate
 *     sends AI_CONSENT_VERSION; the server refuses any other version and
 *     records it on the claim row.
 *   - "Generate suggestions" with "n of 10 left this session" and a note
 *     stating the limits (10 per editing session, 30 in any 30 days; KAN-492).
 *     The server enforces the limits (claim_ai_gift_generation); the counter
 *     shows the server's figure after each request (never more than the
 *     30-day allowance). Disabled while a request runs, at 0 left, at 10
 *     suggestions held, and while saving. While a request runs the button
 *     reads "Generating…" and the slot is `aria-busy`.
 *   - Pending suggestions: "AI suggestion" badge, Approve (committed by Save;
 *     the row then reads "Approved, publishes when you save") and Delete
 *     (deleted on the server at once, so its slot frees; only that row). If
 *     the server says the row is already approved elsewhere, it is kept and
 *     the member is asked to reload (it may already be public).
 *   - Approved suggestions: under "AI suggested", Remove (committed by Save).
 *   - No links: V1 suggestions never carry a URL (founder decision), so none
 *     is rendered.
 *   - Not configured (no ANTHROPIC_API_KEY): "AI gift suggestions aren’t
 *     available yet." and no switch; held suggestions still render.
 */

import { useState } from 'react';
import { rowLabel, oneLine, undoMessage, SUMMARY_DESCRIPTION_MAX } from '@/modules/profile/editor/editor-ui-helpers';
import {
  AI_APPROVED_ELSEWHERE_COPY,
  AI_APPROVED_PENDING_SAVE,
  AI_APPROVE_LABEL,
  AI_CAP_FULL_COPY,
  AI_CONSENT_ACK_LABEL,
  AI_CONSENT_COPY,
  AI_DELETE_LABEL,
  AI_FAILED_COPY,
  AI_GENERATE_LABEL,
  AI_GENERATING_LABEL,
  AI_LIMITS_NOTE,
  AI_NOT_CONFIGURED_COPY,
  AI_SESSION_GENERATIONS,
  AI_SUGGESTION_BADGE,
  AI_TOGGLE_LABEL,
  aiCapReached,
  aiCounterText,
  aiGenerateDisabled,
  aiRemainingAfter,
  aiResultMessage,
} from '@/modules/profile/editor/ai-gifts-ui';
import { AI_CONSENT_VERSION, type GenerateResult } from '@/modules/profile/ai-gifts/types';
import type { AiGiftRow, EditorAction } from './editor-context';
import { useAiGifts } from './ai-gifts-context';
import { dismissAiGift, generateAiGifts } from '../ai-gifts-actions';

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
const BADGE = 'rounded-full px-[9px] py-[2px] text-[11.5px] text-[var(--color-muted)] bg-[#f4efe7]';

export function GiftsAiSlot({ aiItems, dispatch, readOnly = false }: GiftsAiSlotProps) {
  const ai = useAiGifts();
  const [enabled, setEnabled] = useState(false);
  const [consented, setConsented] = useState(false);
  const [pending, setPending] = useState(false);
  const [remaining, setRemaining] = useState(AI_SESSION_GENERATIONS);
  const [message, setMessage] = useState('');
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());

  // Saved-approved rows are public ("AI suggested"); everything else is still
  // to review — including a row approved in this session but not yet saved.
  const isSavedApproved = (g: AiGiftRow) =>
    g.approved && (ai.savedApprovedIds === null || ai.savedApprovedIds.has(g.id));
  const approved = aiItems.filter(isSavedApproved);
  const toReview = aiItems.filter((g) => !isSavedApproved(g));
  const retained = aiItems.length;
  const capReached = aiCapReached(retained);

  const generate = async () => {
    if (aiGenerateDisabled({ readOnly, pending, sessionRemaining: remaining, retained })) return;
    setPending(true);
    setMessage('');
    let result: GenerateResult;
    try {
      result = await generateAiGifts(ai.sessionId, AI_CONSENT_VERSION);
    } catch {
      result = { ok: false, reason: 'failed' };
    }
    if (result.ok && result.inserted.length > 0) ai.onGenerated(result.inserted);
    setRemaining((prev) => aiRemainingAfter(prev, result));
    setMessage(aiResultMessage(result));
    setPending(false);
  };

  const dismiss = async (g: AiGiftRow, label: string) => {
    if (readOnly || busyIds.has(g.id)) return;
    setBusyIds((s) => new Set(s).add(g.id));
    let outcome: 'removed' | 'kept_approved' | 'failed' = 'failed';
    try {
      const r = await dismissAiGift(g.id);
      // not_found: already gone on the server — drop it here too.
      // approved_elsewhere: still there and approved (maybe public) — keep it.
      if (r.ok || r.reason === 'not_found') outcome = 'removed';
      else if (r.reason === 'approved_elsewhere') outcome = 'kept_approved';
    } catch {
      outcome = 'failed';
    }
    setBusyIds((s) => {
      const next = new Set(s);
      next.delete(g.id);
      return next;
    });
    if (outcome === 'removed') {
      ai.onDismissed(g.id);
      setMessage(undoMessage(label));
    } else if (outcome === 'kept_approved') {
      setMessage(AI_APPROVED_ELSEWHERE_COPY);
    } else {
      setMessage(AI_FAILED_COPY);
    }
  };

  const toggle = () => setEnabled((v) => !v);

  return (
    <div className="space-y-3" data-testid="gifts-ai-slot" aria-busy={pending}>
      {ai.configured ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              id="gifts-ai-toggle"
              aria-checked={enabled}
              aria-labelledby="gifts-ai-toggle-label"
              onClick={toggle}
              disabled={readOnly}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                enabled ? 'bg-[var(--color-sage)]' : 'bg-[var(--color-border)]'
              } ${BUTTON_FOCUS}`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  enabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
            <span id="gifts-ai-toggle-label" className="text-sm text-[var(--color-ink)]">
              {AI_TOGGLE_LABEL}
            </span>
          </div>

          {enabled && !consented && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[#f4efe7] px-4 py-3 space-y-2" role="note">
              <p className="text-sm text-[var(--color-ink)]">{AI_CONSENT_COPY}</p>
              <button
                type="button"
                onClick={() => setConsented(true)}
                disabled={readOnly}
                className={`text-sm font-medium px-3 py-1.5 rounded-lg bg-white border border-[var(--color-border)] text-[var(--color-ink)] disabled:opacity-50 ${BUTTON_FOCUS}`}
              >
                {AI_CONSENT_ACK_LABEL}
              </button>
            </div>
          )}

          {enabled && consented && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void generate()}
                disabled={aiGenerateDisabled({ readOnly, pending, sessionRemaining: remaining, retained })}
                aria-describedby="gifts-ai-counter"
                className={`text-sm font-medium px-3 py-1.5 rounded-lg bg-[var(--color-sage)] text-white disabled:opacity-50 ${BUTTON_FOCUS}`}
              >
                {pending ? AI_GENERATING_LABEL : AI_GENERATE_LABEL}
              </button>
              <p id="gifts-ai-counter" aria-live="polite" className="text-xs text-[var(--color-muted)]">
                {aiCounterText(remaining)}
              </p>
              {capReached && <p className="text-xs text-[var(--color-muted)] w-full">{AI_CAP_FULL_COPY}</p>}
              <p data-testid="gifts-ai-limits-note" className="text-xs text-[var(--color-muted)] w-full">
                {AI_LIMITS_NOTE}
              </p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-[var(--color-muted)]">{AI_NOT_CONFIGURED_COPY}</p>
      )}

      {toReview.length > 0 && (
        <ul className="space-y-2" aria-label={`${AI_SUGGESTION_BADGE}s`}>
          {toReview.map((g) => {
            const label = rowLabel(g.title, g.description);
            const desc = oneLine(g.description, SUMMARY_DESCRIPTION_MAX);
            const busy = busyIds.has(g.id);
            return (
              <li key={g.id} className="bg-white rounded-lg border border-dashed border-[var(--color-border)] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className={BADGE}>{AI_SUGGESTION_BADGE}</span>
                    <p className="mt-1.5 text-sm text-[var(--color-ink)]">
                      <span className="font-medium">{label}</span>
                      {desc && g.title.trim() !== '' && <span className="text-[var(--color-muted)]"> — {desc}</span>}
                    </p>
                    {g.approved && <p className="mt-1 text-xs text-[var(--color-sage)]">{AI_APPROVED_PENDING_SAVE}</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {!g.approved && (
                      <button
                        type="button"
                        onClick={() => dispatch({ type: 'approveAiGift', id: g.id })}
                        disabled={readOnly || busy}
                        aria-label={`${AI_APPROVE_LABEL} ${label || 'suggestion'}`}
                        className={`text-xs font-medium px-2 py-1 rounded-lg text-[var(--color-sage)] disabled:opacity-50 ${BUTTON_FOCUS}`}
                      >
                        {AI_APPROVE_LABEL}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void dismiss(g, label)}
                      disabled={readOnly || busy}
                      aria-label={`${AI_DELETE_LABEL} ${label || 'suggestion'}`}
                      className={`text-xs font-medium px-2 py-1 rounded-lg text-red-600 hover:text-red-700 disabled:opacity-50 ${BUTTON_FOCUS}`}
                    >
                      {AI_DELETE_LABEL}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {approved.length > 0 && (
        <div className="space-y-3" role="group" aria-labelledby="gifts-ai-heading">
          <h3 id="gifts-ai-heading" className="text-sm font-semibold text-[var(--color-ink)]">
            {AI_SUGGESTED_LABEL}
          </h3>
          <ul className="space-y-2">
            {approved.map((g, i) => {
              const label = rowLabel(g.title, g.description);
              const desc = oneLine(g.description, SUMMARY_DESCRIPTION_MAX);
              return (
                <li key={g.id} className="bg-white rounded-lg border border-[var(--color-border)] px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[var(--color-ink)] truncate">
                        <span className="font-medium">{label}</span>
                        {desc && g.title.trim() !== '' && <span className="text-[var(--color-muted)]"> — {desc}</span>}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className={BADGE}>{AI_SUGGESTED_LABEL}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      id={`gifts-ai-remove-${i}`}
                      onClick={() => {
                        dispatch({ type: 'deleteAiGift', id: g.id });
                        setMessage(undoMessage(label));
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
        </div>
      )}

      <p role="status" aria-live="polite" className="text-sm text-[var(--color-muted)]">
        {message}
      </p>
    </div>
  );
}
