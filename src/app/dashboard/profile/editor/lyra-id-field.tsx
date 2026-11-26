'use client';

/**
 * KAN-487 — v0.8 profile editor, §01 "CheckLyra ID" (spec v0.8 §01: unique,
 * 3–30 characters, lower-case letters, numbers and underscores, cannot be
 * changed after first publication; plan §C row 01).
 *
 *   - Editable until first publish: live `checkLyraId` feedback as the member
 *     types (the validator / server error — e.g. "That CheckLyra ID is
 *     already taken." — wins when the caller passes one), and the
 *     `checklyra.com/<id>` preview once the ID is valid.
 *   - Empty while `slug_confirmed` is false (editor-state.ts), so the signup
 *     placeholder is never shown as a chosen ID.
 *   - Locked (`state.lyraIdLocked`): read-only with "Your CheckLyra ID can't
 *     be changed after publishing." The reducer also ignores `setLyraId`.
 *     KAN-496: the note now also says WHEN the profile was first published,
 *     so a member is never unsure whether they published.
 *   - KAN-496 (founder feedback 2026-11-26): "Check availability" button
 *     while the ID can still be changed. It asks the server
 *     (`checkLyraIdAvailable`); the answer is shown until the ID is edited.
 *     Not a reservation: Save still decides.
 */

import { useState, useTransition } from 'react';
import { checkLyraId } from '@/modules/profile/profile-rules';
import { checkLyraIdAvailable } from '../editor-actions';
import type { EditorAction } from './editor-context';
import { TextField } from './text-field';

export const LYRA_ID_INPUT_ID = 'profile-lyra_id';
export const LYRA_ID_LOCKED_NOTE = "Your CheckLyra ID can't be changed after publishing.";
const LYRA_ID_MAX = 30;

// KAN-496 copy (founder feedback 2026-11-26).
export const LYRA_ID_CHECK_LABEL = 'Check availability';
export const lyraIdAvailableCopy = (id: string) => `${id} is available. Save to make it yours.`;
export const lyraIdTakenCopy = (id: string) => `${id} is already taken. Please try another.`;
export const LYRA_ID_CHECK_FAILED = "We couldn't check right now. Please try again.";

/** "Your profile was first published on 1 August 2026." (UK date, London time). */
export function firstPublishedNote(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
  return `Your profile was first published on ${day}.`;
}

type CheckResult = { forId: string; ok: boolean; message: string };

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-sage)] focus-visible:outline-offset-2';

export interface LyraIdFieldProps {
  value: string;
  locked: boolean;
  dispatch: (a: EditorAction) => void;
  /** `errors['profile.lyra_id']`. */
  error?: string;
  readOnly?: boolean;
  /** KAN-496: `state.firstPublishedAt`, shown in the locked note. */
  firstPublishedAt?: string | null;
}

export function LyraIdField({ value, locked, dispatch, error, readOnly = false, firstPublishedAt }: LyraIdFieldProps) {
  const check = value.trim() === '' ? null : checkLyraId(value);
  const liveError = !locked && check && !check.ok ? check.error : undefined;
  const [result, setResult] = useState<CheckResult | null>(null);
  const [checking, startCheck] = useTransition();
  const currentId = check && check.ok ? check.id : value.trim().toLowerCase();
  // A result only stands for the ID it was asked about.
  const shownResult = result && result.forId === currentId ? result : null;
  const shownError = locked ? undefined : (error ?? liveError ?? (shownResult && !shownResult.ok ? shownResult.message : undefined));
  const previewId = locked ? value.trim() : check && check.ok ? check.id : '';
  const lockedNote = [LYRA_ID_LOCKED_NOTE, firstPublishedNote(firstPublishedAt)].filter(Boolean).join(' ');
  const canCheck = !locked && !readOnly;

  const onCheck = () => {
    const asked = currentId;
    if (!check || !check.ok) {
      setResult({ forId: asked, ok: false, message: check && !check.ok ? check.error : 'Enter an ID to check.' });
      return;
    }
    startCheck(async () => {
      let next: CheckResult;
      try {
        const r = await checkLyraIdAvailable(asked);
        if (r.status === 'available') next = { forId: asked, ok: true, message: lyraIdAvailableCopy(r.id) };
        else if (r.status === 'taken') next = { forId: asked, ok: false, message: lyraIdTakenCopy(r.id) };
        else if (r.status === 'invalid' || r.status === 'limited') next = { forId: asked, ok: false, message: r.error };
        else next = { forId: asked, ok: false, message: LYRA_ID_CHECK_FAILED };
      } catch {
        next = { forId: asked, ok: false, message: LYRA_ID_CHECK_FAILED };
      }
      setResult(next);
    });
  };

  return (
    <div>
      <div className={canCheck ? 'flex items-end gap-2' : undefined}>
        <div className="min-w-0 flex-1">
          <TextField
            id={LYRA_ID_INPUT_ID}
            label="CheckLyra ID"
            value={value}
            onChange={(v) => dispatch({ type: 'setLyraId', value: v.toLowerCase() })}
            max={locked ? undefined : LYRA_ID_MAX}
            helper={locked ? lockedNote : undefined}
            error={shownError}
            required
            readOnly={locked || readOnly}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {canCheck && (
          <button
            type="button"
            onClick={onCheck}
            disabled={checking || value.trim() === ''}
            aria-busy={checking || undefined}
            aria-controls={`${LYRA_ID_INPUT_ID}-availability`}
            className={`shrink-0 mb-[2px] px-3 py-2 rounded-lg bg-[#f4efe7] text-sm font-medium text-[var(--color-ink)] hover:bg-[#ece7df] disabled:opacity-50 transition-colors ${FOCUS}`}
          >
            {checking ? 'Checking…' : LYRA_ID_CHECK_LABEL}
          </button>
        )}
      </div>
      <p id={`${LYRA_ID_INPUT_ID}-availability`} role="status" aria-live="polite" className="mt-1 text-xs text-[var(--color-sage)]">
        {shownResult && shownResult.ok ? `✓ ${shownResult.message}` : ''}
      </p>
      {previewId !== '' && (
        <p className="mt-1 text-xs text-[var(--color-muted)] break-all">
          checklyra.com/<span className="font-medium text-[var(--color-ink)]">{previewId}</span>
        </p>
      )}
    </div>
  );
}
