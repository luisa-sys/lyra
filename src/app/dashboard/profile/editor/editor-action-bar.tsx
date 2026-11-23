'use client';

/**
 * KAN-487 — v0.8 profile editor sticky action bar (spec v0.8 §1, §3; plan §C
 * "Action bar", §D copy, §E button + callout classes).
 *
 *   Unpublished: [Save Draft] (secondary) [Preview] (outline) [Publish] (primary)
 *   Published:   [Save Changes] (primary) — disabled when nothing changed or
 *                while the photo is removed (`saveChangesDisabled`)
 *
 * Callouts above the buttons:
 *   - success (green, inside a persistent `role="status"` live region):
 *     exactly "Changes saved successfully" after Save Changes, "Draft saved"
 *     after Save Draft;
 *   - failure (red, `role="alert"`): "We couldn’t save your changes. Your
 *     edits are still here.", the server's own message beneath it, and
 *     "Try again" (re-runs the failed save — a failed Publish is retried as a
 *     Publish). When the server says the editor is out of date / was saved
 *     somewhere else, "Reload" replaces "Try again" (a retry would fail the
 *     same way); it asks first, because the edits will be lost;
 *   - publish blockers (red): "Before you can publish:" and every missing
 *     item, each a link that moves focus to its field (opening its section
 *     first when collapsed).
 */

import type { PublishBlocker } from '@/modules/profile/editor/editor-shell';
import { PUBLISH_BLOCKED_HEADING, RELOAD_LABEL, TRY_AGAIN_LABEL } from '@/modules/profile/editor/editor-shell';
import { revealAndFocus } from './editor-section-card';

export type ActionBarStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success'; message: string }
  | {
      kind: 'error';
      message: string;
      /** The server's own message, shown beneath `message` (null: none). */
      detail: string | null;
      /** 'retry' → "Try again"; 'reload' → "Reload" (edits are lost). */
      action: 'retry' | 'reload';
    };

export interface EditorActionBarProps {
  isPublished: boolean;
  status: ActionBarStatus;
  blockers: readonly PublishBlocker[];
  /** Published bar: Save Changes disabled (not dirty / photo removed / saving). */
  saveChangesDisabled: boolean;
  onSaveDraft: () => void;
  onPreview: () => void;
  onPublish: () => void;
  onSaveChanges: () => void;
  onRetry: () => void;
  /** Reload the editor (the caller confirms first: edits are lost). */
  onReload: () => void;
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-sage)] focus-visible:outline-offset-2';
const PRIMARY = `shrink-0 px-5 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:bg-[var(--color-sage-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${FOCUS}`;
const SECONDARY = `shrink-0 px-4 py-2 rounded-lg bg-[#f4efe7] text-sm font-medium text-[var(--color-ink)] hover:bg-[#ece7df] disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${FOCUS}`;
const OUTLINE = `shrink-0 px-4 py-2 rounded-lg border border-[var(--color-border)] bg-white text-sm font-medium text-[var(--color-ink)] hover:bg-[#faf8f3] disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${FOCUS}`;

function focusField(fieldId: string): void {
  const el = document.getElementById(fieldId);
  if (el) revealAndFocus(el);
}

export function EditorActionBar({
  isPublished,
  status,
  blockers,
  saveChangesDisabled,
  onSaveDraft,
  onPreview,
  onPublish,
  onSaveChanges,
  onRetry,
  onReload,
}: EditorActionBarProps) {
  const saving = status.kind === 'saving';
  return (
    <div className="fixed bottom-0 inset-x-0 bg-white border-t border-[var(--color-border)] px-4 py-3 z-10">
      <div className="max-w-5xl mx-auto space-y-2">
        <div role="status" aria-live="polite">
          {status.kind === 'success' && (
            <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              {status.message}
            </p>
          )}
        </div>

        {status.kind === 'error' && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p>{status.message}</p>
              {status.detail && <p className="mt-0.5">{status.detail}</p>}
            </div>
            {status.action === 'reload' ? (
              <button type="button" onClick={onReload} className={SECONDARY}>
                {RELOAD_LABEL}
              </button>
            ) : (
              <button type="button" onClick={onRetry} className={SECONDARY}>
                {TRY_AGAIN_LABEL}
              </button>
            )}
          </div>
        )}

        {blockers.length > 0 && !isPublished && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <p className="font-medium">{PUBLISH_BLOCKED_HEADING}</p>
            <ul className="list-disc pl-5 mt-1">
              {blockers.map((b) => (
                <li key={b.message}>
                  {b.fieldId ? (
                    <a
                      href={`#${b.fieldId}`}
                      onClick={(e) => {
                        e.preventDefault();
                        focusField(b.fieldId as string);
                      }}
                      className={`underline ${FOCUS}`}
                    >
                      {b.message}
                    </a>
                  ) : (
                    b.message
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          {saving && <p className="text-xs text-[var(--color-muted)] mr-auto">Saving…</p>}
          {isPublished ? (
            <button type="button" onClick={onSaveChanges} disabled={saveChangesDisabled} className={PRIMARY}>
              Save Changes
            </button>
          ) : (
            <>
              <button type="button" onClick={onSaveDraft} disabled={saving} className={SECONDARY}>
                Save Draft
              </button>
              <button type="button" onClick={onPreview} disabled={saving} className={OUTLINE}>
                Preview
              </button>
              <button type="button" onClick={onPublish} disabled={saving} className={PRIMARY}>
                Publish
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
