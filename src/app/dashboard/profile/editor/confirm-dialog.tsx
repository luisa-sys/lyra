'use client';

/**
 * KAN-487 — v0.8 profile editor: confirmation dialog (plan §C photo "Remove
 * with confirmation"; plan §D proposed copy "Remove your profile photo?" /
 * "Remove photo" / "Cancel").
 *
 * A native modal `<dialog>` (`showModal()`): the rest of the page is inert
 * while it is open. Focus management:
 *   - On open, focus goes to Cancel (the safe choice for a destructive
 *     confirm).
 *   - Tab / Shift+Tab wrap inside the dialog (explicit trap, on top of the
 *     browser's top-layer inertness).
 *   - Escape cancels (the dialog's `cancel` event is turned into `onCancel`
 *     so the open state stays owned by the caller).
 *   - On close, focus returns to the element that had it before opening.
 */

import { useEffect, useId, useRef } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). Default true. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    }
  }, [open]);

  // Close the modal if the component unmounts while it is open.
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== 'Tab') return;
    const dialog = ref.current;
    if (!dialog) return;
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
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
      aria-describedby={body ? bodyId : undefined}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        // Escape: let the caller close it, so `open` stays the source of truth.
        e.preventDefault();
        onCancel();
      }}
      className="w-[min(92vw,420px)] rounded-[10px] border border-[var(--color-border)] bg-white p-0 text-[var(--color-ink)] shadow-[0_8px_30px_rgba(0,0,0,0.12)] backdrop:bg-black/30"
    >
      <div className="px-5 pt-5 pb-4">
        <h2 id={titleId} className="text-[15px] font-semibold leading-snug">
          {title}
        </h2>
        {body && (
          <div id={bodyId} className="mt-2 text-sm text-[var(--color-muted)] leading-relaxed">
            {body}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 px-5 pb-5">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-[#f4efe7] text-sm font-medium text-[var(--color-ink)] hover:bg-[#ece7df] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-sage)] focus-visible:outline-offset-2"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-sage)] focus-visible:outline-offset-2 ${
            danger ? 'bg-red-600 hover:bg-red-700' : 'bg-[var(--color-sage)] hover:bg-[var(--color-sage-hover)]'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
