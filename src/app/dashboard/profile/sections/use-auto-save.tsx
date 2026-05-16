'use client';

/**
 * KAN-220 — debounced auto-save hook used by the single-page profile
 * editor's free-text sections (BasicInfo, Bio, ManualOfMe).
 *
 * Behaviour:
 *   - First render is treated as the data load, not user input — does NOT
 *     trigger a save.
 *   - Every subsequent change to `value` resets a debounce timer.
 *   - When the timer fires, the save function is called once with the
 *     latest value.
 *   - The save function is held in a ref so that re-creating it on every
 *     parent render does NOT continually re-trigger the effect.
 *   - Returns a status the section can render in its header
 *     ("Saving…" / "Saved" / "Save failed").
 *
 * The 800ms default is a balance between "feels instant" and "respects
 * the user's pause". Server Actions deduplicate concurrent writes
 * through Postgres transactions; if the user types again during a
 * save, the next debounce window catches it and the last write wins —
 * matching what users expect from auto-save.
 */

import { useEffect, useRef, useState } from 'react';

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type AutoSaveResult =
  | { success: true }
  | { success: false; error: string }
  | void;

export function useAutoSave<T>(
  value: T,
  save: (v: T) => Promise<AutoSaveResult>,
  debounceMs: number = 800,
): AutoSaveStatus {
  // Hold save in a ref so that re-creating the function on each parent
  // render doesn't continually re-trigger the effect.
  const saveRef = useRef(save);
  saveRef.current = save;

  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setStatus('idle');
    const timer = setTimeout(async () => {
      setStatus('saving');
      try {
        const result = await saveRef.current(value);
        if (result && 'success' in result && result.success === false) {
          setStatus('error');
        } else {
          setStatus('saved');
        }
      } catch {
        setStatus('error');
      }
    }, debounceMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saveRef intentionally not a dep; see file comment.
  }, [value, debounceMs]);

  return status;
}

/** Small render-helper for the autosave status indicator. Sections that
 * use `useAutoSave` typically render this in their header.
 *
 * Returns null when status is idle so the UI doesn't flash on mount or
 * between changes. */
export function AutoSaveStatusLabel({ status }: { status: AutoSaveStatus }) {
  if (status === 'idle') return null;
  const text =
    status === 'saving' ? 'Saving…'
    : status === 'saved' ? 'Saved'
    : 'Save failed — retry on next change';
  const colour =
    status === 'error' ? 'text-red-500' : 'text-[var(--color-muted)]';
  return (
    <span className={`text-xs ${colour}`} role="status" aria-live="polite">
      {text}
    </span>
  );
}
