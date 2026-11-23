'use client';

/**
 * KAN-487 — v0.8 profile editor: the undo row shown in place of a removed
 * entry (plan §C "Remove takes the row out and shows an undo row…";
 * plan §D proposed copy "Removed '‹title›'." / "Undo").
 *
 *   - On mount, focus moves to Undo, and the `role="status"` region
 *     announces "Removed '‹title›'." (also Undo's description, so the
 *     message is read on focus even where a freshly inserted live region
 *     is not announced).
 *   - It expires 8 s after the removal (`removedAt`, the `at` the reducer
 *     stored). The timer lives here: the reducer only exposes `undoRemove`.
 *     Remounting (e.g. a collapsed section opened again) recomputes the time
 *     left from `removedAt`, so an old undo never comes back.
 *   - When it expires while focused, `onExpire(true)` lets the list move
 *     focus somewhere sensible instead of dropping it on <body>.
 *   - The pending delete is only committed on save.
 *
 * Give it a `key` that changes per removal (row key + `removedAt`).
 */

import { useEffect, useId, useRef, useState } from 'react';
import { UNDO_TTL_MS, undoMessage, undoRemainingMs } from '@/modules/profile/editor/editor-ui-helpers';

export interface UndoRowProps {
  /** The removed row's label (title, else description). */
  label: string;
  /** Epoch ms of the removal (the `at` stored in `state.undo`). */
  removedAt: number;
  onUndo: () => void;
  /** Called once when the row expires; `hadFocus` = focus was inside it. */
  onExpire?: (hadFocus: boolean) => void;
  disabled?: boolean;
  /** Move focus to Undo on mount (default true). */
  autoFocus?: boolean;
}

export function UndoRow({ label, removedAt, onUndo, onExpire, disabled, autoFocus = true }: UndoRowProps) {
  const [expired, setExpired] = useState(() => undoRemainingMs(removedAt, Date.now(), UNDO_TTL_MS) === 0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const onExpireRef = useRef(onExpire);
  const messageId = useId();

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (!expired && autoFocus) buttonRef.current?.focus();
    // Focus only when the row first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- KAN-487: mount-only focus move to Undo.
  }, []);

  useEffect(() => {
    if (expired) return;
    const t = window.setTimeout(() => {
      const hadFocus =
        rootRef.current !== null &&
        typeof document !== 'undefined' &&
        rootRef.current.contains(document.activeElement);
      setExpired(true);
      onExpireRef.current?.(hadFocus);
    }, undoRemainingMs(removedAt, Date.now(), UNDO_TTL_MS));
    return () => window.clearTimeout(t);
  }, [expired, removedAt]);

  if (expired) return null;

  return (
    <div
      ref={rootRef}
      className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-paper)] px-4 py-2.5"
    >
      <p id={messageId} role="status" aria-live="polite" className="text-sm text-[var(--color-muted)] min-w-0 truncate">
        {undoMessage(label)}
      </p>
      <button
        ref={buttonRef}
        type="button"
        onClick={onUndo}
        aria-describedby={messageId}
        disabled={disabled}
        className="shrink-0 px-3 py-1 rounded-lg text-sm font-medium text-[var(--color-sage)] hover:bg-[var(--color-accent-soft)] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-sage)] focus-visible:outline-offset-2"
      >
        Undo
      </button>
    </div>
  );
}
