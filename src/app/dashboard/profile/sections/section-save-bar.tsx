'use client';

/**
 * KAN-404 (#8/#9) — per-section Save affordance for the single-page
 * editor's free-text sections (BasicInfo, Bio, ManualOfMe).
 *
 * The free-text sections already debounce-autosave; this bar adds a
 * VISIBLE Save button (founder ask) that flushes the pending debounce
 * immediately, alongside the existing Saving…/Saved/Save-failed label so
 * the eye finds save-state and the Save control in one spot. It does not
 * replace autosave — it's a belt-and-braces "save right now" for users who
 * don't trust silent autosave.
 *
 * List sections (items/links/starters/affiliations) commit each row
 * instantly on Add/Remove, so there's nothing buffered to flush — they use
 * a bare status indicator instead of this button (see edit-profile-form).
 */

import { useState } from 'react';
import { AutoSaveStatusLabel, type AutoSaveStatus } from './use-auto-save';

export function SectionSaveBar({
  status,
  onSave,
  disabled = false,
}: {
  status: AutoSaveStatus;
  onSave: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  // Disable while an explicit save is in flight or the debounce is mid-save,
  // so a double-click can't fire two overlapping saves.
  const isBusy = saving || status === 'saving' || disabled;

  const handleClick = async () => {
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center justify-end gap-3">
      <AutoSaveStatusLabel status={status} />
      <button
        type="button"
        onClick={handleClick}
        disabled={isBusy}
        className="px-4 py-1.5 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        Save
      </button>
    </div>
  );
}
