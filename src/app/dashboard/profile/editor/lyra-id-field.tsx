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
 */

import { checkLyraId } from '@/modules/profile/profile-rules';
import type { EditorAction } from './editor-context';
import { TextField } from './text-field';

export const LYRA_ID_INPUT_ID = 'profile-lyra_id';
export const LYRA_ID_LOCKED_NOTE = "Your CheckLyra ID can't be changed after publishing.";
const LYRA_ID_MAX = 30;

export interface LyraIdFieldProps {
  value: string;
  locked: boolean;
  dispatch: (a: EditorAction) => void;
  /** `errors['profile.lyra_id']`. */
  error?: string;
  readOnly?: boolean;
}

export function LyraIdField({ value, locked, dispatch, error, readOnly = false }: LyraIdFieldProps) {
  const check = value.trim() === '' ? null : checkLyraId(value);
  const liveError = !locked && check && !check.ok ? check.error : undefined;
  const shownError = locked ? undefined : (error ?? liveError);
  const previewId = locked ? value.trim() : check && check.ok ? check.id : '';

  return (
    <div>
      <TextField
        id={LYRA_ID_INPUT_ID}
        label="CheckLyra ID"
        value={value}
        onChange={(v) => dispatch({ type: 'setLyraId', value: v.toLowerCase() })}
        max={locked ? undefined : LYRA_ID_MAX}
        helper={locked ? LYRA_ID_LOCKED_NOTE : undefined}
        error={shownError}
        required
        readOnly={locked || readOnly}
        autoComplete="off"
        spellCheck={false}
      />
      {previewId !== '' && (
        <p className="mt-1 text-xs text-[var(--color-muted)] break-all">
          checklyra.com/<span className="font-medium text-[var(--color-ink)]">{previewId}</span>
        </p>
      )}
    </div>
  );
}
