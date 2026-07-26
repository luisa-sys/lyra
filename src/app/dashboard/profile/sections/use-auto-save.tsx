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
 * KAN-404 (#8/#9): the hook ALSO returns a `flush()` function so a visible
 * per-section Save button can force-save the newest value immediately
 * instead of waiting for the 800ms debounce. flush() cancels the pending
 * timer, runs the save once with the latest value, and drives the same
 * saving→saved / saving→error status transitions. The debounce, the
 * first-render skip, the 800ms default, and the last-write-wins semantics
 * are all unchanged — only an eager, user-initiated path was added.
 *
 * The 800ms default is a balance between "feels instant" and "respects
 * the user's pause". Server Actions deduplicate concurrent writes
 * through Postgres transactions; if the user types again during a
 * save, the next debounce window catches it and the last write wins —
 * matching what users expect from auto-save.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { runSave } from './auto-save-core';

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type AutoSaveResult =
  | { success: true }
  | { success: false; error: string }
  | void;

export interface UseAutoSaveReturn {
  status: AutoSaveStatus;
  /**
   * Force-save the latest value immediately, bypassing the debounce.
   * Cancels any pending debounced save first so the two paths never race.
   * Resolves once the save (and its status transition) has settled.
   */
  flush: () => Promise<void>;
}

export function useAutoSave<T>(
  value: T,
  save: (v: T) => Promise<AutoSaveResult>,
  debounceMs: number = 800,
): UseAutoSaveReturn {
  // Hold `save` and the newest `value` in refs so flush() can force-save the
  // current value with the current save fn, and so re-creating `save` on every
  // parent render doesn't re-trigger the debounce effect.
  //
  // BUGS-70 residual (found by the KAN-413 staging soak, C3.5): these refs MUST
  // be synced in a *layout* effect, not a passive one. A passive useEffect runs
  // after paint, so on a fast type-then-blur — Playwright fill()+blur(), or a
  // real user who blurs immediately after a keystroke — onBlur→flush() fired
  // BEFORE the passive effect had synced latestValueRef, and flush saved the
  // STALE value (the pre-edit text), so the edit never landed in
  // profile_manual_of_me even though the status showed "Saved". useLayoutEffect
  // commits synchronously after the render, before the browser dispatches the
  // subsequent blur event, so the ref is current at flush time. (Writing the ref
  // in render would be simpler but the react-hooks/refs lint disallows it.)
  const saveRef = useRef(save);
  const latestValueRef = useRef(value);
  useLayoutEffect(() => {
    saveRef.current = save;
    latestValueRef.current = value;
  });

  // Track the live debounce timer so flush() can cancel it.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- KAN-220/KAN-404: reset the visible status to 'idle' as a new debounce window is armed. Guarded by the first-render skip above, so it never fires on mount and can't cascade; it only runs in response to a user edit changing `value`.
    setStatus('idle');
    const timer = setTimeout(() => {
      timerRef.current = null;
      // Debounce path: save the value captured for THIS window (last-write-wins
      // across overlapping windows, unchanged from KAN-220).
      void runSave(saveRef.current, value, setStatus);
    }, debounceMs);
    timerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (timerRef.current === timer) timerRef.current = null;
    };
  }, [value, debounceMs]);

  const flush = useCallback(async () => {
    // Cancel any in-flight debounce so the eager save is the last write.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await runSave(saveRef.current, latestValueRef.current, setStatus);
  }, []);

  return { status, flush };
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
