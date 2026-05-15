'use client';

import { useState } from 'react';
import { SaveButton } from './types';
import type { ManualOfMe } from '../manual-of-me-fields';
import { MANUAL_OF_ME_MAX_LENGTHS } from '../manual-of-me-fields';

/**
 * KAN-154 — Wizard step for the "Manual of Me" profile section.
 *
 * Renders four optional text areas. All fields are independent — saving an
 * empty field clears it; user can leave the whole step blank.
 */
export function ManualOfMeStep({
  manualOfMe,
  onSave,
  isPending,
}: {
  manualOfMe: ManualOfMe;
  onSave: (data: Record<string, string>) => void;
  isPending: boolean;
}) {
  const [communicationStyle, setCommunicationStyle] = useState(
    manualOfMe.communication_style || ''
  );
  const [workingPreferences, setWorkingPreferences] = useState(
    manualOfMe.working_preferences || ''
  );
  const [energisesMe, setEnergisesMe] = useState(manualOfMe.energises_me || '');
  const [drainsMe, setDrainsMe] = useState(manualOfMe.drains_me || '');

  const handleSave = () => {
    onSave({
      communication_style: communicationStyle,
      working_preferences: workingPreferences,
      energises_me: energisesMe,
      drains_me: drainsMe,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-ink)]">
          Manual of Me
        </h2>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          A short user-guide for working with you. All fields are optional —
          fill in what feels useful.
        </p>
      </div>

      <ManualOfMeField
        label="Communication style"
        helper="How do you prefer people communicate with you?"
        placeholder="Async messages over meetings. Be direct — I'd rather hear it than guess."
        value={communicationStyle}
        onChange={setCommunicationStyle}
        rows={3}
        maxLength={MANUAL_OF_ME_MAX_LENGTHS.communication_style}
      />

      <ManualOfMeField
        label="Best ways to work with me"
        helper="What working preferences should people know?"
        placeholder="Mornings are my deep-work time. I think out loud, so don't take rough drafts as final."
        value={workingPreferences}
        onChange={setWorkingPreferences}
        rows={5}
        maxLength={MANUAL_OF_ME_MAX_LENGTHS.working_preferences}
      />

      <ManualOfMeField
        label="What energises me"
        helper="What gives you energy?"
        placeholder="Solving hard problems, making people laugh, walking meetings."
        value={energisesMe}
        onChange={setEnergisesMe}
        rows={3}
        maxLength={MANUAL_OF_ME_MAX_LENGTHS.energises_me}
      />

      <ManualOfMeField
        label="What drains me"
        helper="What pulls your energy down?"
        placeholder="Back-to-back meetings with no breaks. Surprise context switches."
        value={drainsMe}
        onChange={setDrainsMe}
        rows={3}
        maxLength={MANUAL_OF_ME_MAX_LENGTHS.drains_me}
      />

      <SaveButton
        onClick={handleSave}
        isPending={isPending}
        label="Save & continue"
      />
    </div>
  );
}

/** Internal: labelled textarea with character-count footer. */
function ManualOfMeField({
  label,
  helper,
  placeholder,
  value,
  onChange,
  rows,
  maxLength,
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
      <label className="block text-sm font-medium text-[var(--color-ink)] mb-1">
        {label}
      </label>
      <p className="text-xs text-[var(--color-muted)] mb-1.5">{helper}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent resize-none"
      />
      <p className="text-xs text-[var(--color-muted)] mt-1">
        {value.length}/{maxLength}
      </p>
    </div>
  );
}
