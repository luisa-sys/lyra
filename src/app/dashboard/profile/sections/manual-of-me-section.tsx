'use client';

/**
 * KAN-220 — Manual of Me section for the single-page profile editor.
 *
 * Autosave version of `ManualOfMeStep`. Four optional textareas debounced
 * together so a single save fires 800ms after the last keystroke across
 * any field. Status indicator at the top of the section.
 */

import { useState } from 'react';
import type { ManualOfMe } from '../manual-of-me-fields';
import { MANUAL_OF_ME_MAX_LENGTHS } from '../manual-of-me-fields';
import { updateManualOfMe } from '../manual-of-me-actions';
import { AutoSaveStatusLabel, useAutoSave } from './use-auto-save';

interface ManualOfMeDraft {
  communication_style: string;
  working_preferences: string;
  energises_me: string;
  drains_me: string;
}

export function ManualOfMeSection({ manualOfMe }: { manualOfMe: ManualOfMe }) {
  const [draft, setDraft] = useState<ManualOfMeDraft>({
    communication_style: manualOfMe.communication_style || '',
    working_preferences: manualOfMe.working_preferences || '',
    energises_me: manualOfMe.energises_me || '',
    drains_me: manualOfMe.drains_me || '',
  });

  // `updateManualOfMe` takes Record<string, string | null>; ManualOfMeDraft's
  // typed keys narrow it to a literal-keyed object, so we widen explicitly.
  const status = useAutoSave(draft, async (v) =>
    updateManualOfMe(v as unknown as Record<string, string | null>),
  );

  const set = <K extends keyof ManualOfMeDraft>(key: K, value: ManualOfMeDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <AutoSaveStatusLabel status={status} />
      </div>

      <p className="text-sm text-[var(--color-muted)]">
        A short user-guide for working with you. All fields are optional — fill in what feels useful.
      </p>

      <MoMField
        label="Communication style"
        helper="How do you prefer people communicate with you?"
        placeholder="Async messages over meetings. Be direct — I'd rather hear it than guess."
        value={draft.communication_style}
        onChange={(v) => set('communication_style', v)}
        rows={3}
        maxLength={MANUAL_OF_ME_MAX_LENGTHS.communication_style}
      />

      <MoMField
        label="Best ways to work with me"
        helper="What working preferences should people know?"
        placeholder="Mornings are my deep-work time. I think out loud, so don't take rough drafts as final."
        value={draft.working_preferences}
        onChange={(v) => set('working_preferences', v)}
        rows={5}
        maxLength={MANUAL_OF_ME_MAX_LENGTHS.working_preferences}
      />

      <MoMField
        label="What energises me"
        helper="What gives you energy?"
        placeholder="Solving hard problems, making people laugh, walking meetings."
        value={draft.energises_me}
        onChange={(v) => set('energises_me', v)}
        rows={3}
        maxLength={MANUAL_OF_ME_MAX_LENGTHS.energises_me}
      />

      <MoMField
        label="What drains me"
        helper="What pulls your energy down?"
        placeholder="Back-to-back meetings with no breaks. Surprise context switches."
        value={draft.drains_me}
        onChange={(v) => set('drains_me', v)}
        rows={3}
        maxLength={MANUAL_OF_ME_MAX_LENGTHS.drains_me}
      />
    </div>
  );
}

function MoMField({
  label, helper, placeholder, value, onChange, rows, maxLength,
}: {
  label: string;
  helper: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  maxLength: number;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">{label}</label>
      <p className="text-xs text-[var(--color-muted)] mb-1.5">{helper}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent resize-none"
      />
      <p className="text-xs text-[var(--color-muted)] mt-1">{value.length}/{maxLength}</p>
    </div>
  );
}
