'use client';

/**
 * KAN-220 — Manual of Me section for the single-page profile editor.
 *
 * Autosave version of `ManualOfMeStep`. Four optional textareas debounced
 * together so a single save fires 800ms after the last keystroke across
 * any field. Status indicator at the top of the section.
 */

import { useRef, useState } from 'react';
import type { ManualOfMe } from '../manual-of-me-fields';
import { MANUAL_OF_ME_FIELDS, MANUAL_OF_ME_MAX_LENGTHS } from '../manual-of-me-fields';
import { updateManualOfMe } from '../manual-of-me-actions';
import { useAutoSave } from './use-auto-save';
import { SectionSaveBar } from './section-save-bar';

interface ManualOfMeDraft {
  good_to_know: string;
  boundaries: string;
  communication_style: string;
  working_preferences: string;
  energises_me: string;
  drains_me: string;
}

export function ManualOfMeSection({ manualOfMe }: { manualOfMe: ManualOfMe }) {
  const [draft, setDraft] = useState<ManualOfMeDraft>({
    good_to_know: manualOfMe.good_to_know || '',
    boundaries: manualOfMe.boundaries || '',
    communication_style: manualOfMe.communication_style || '',
    working_preferences: manualOfMe.working_preferences || '',
    energises_me: manualOfMe.energises_me || '',
    drains_me: manualOfMe.drains_me || '',
  });

  // BUGS-74 — belt-and-braces against a partially-loaded row.
  //
  // The real fix is in the loader (page.tsx now selects every field in
  // MANUAL_OF_ME_FIELDS). This guard makes the section safe even if a caller
  // ever hands it an incomplete row again: a field that arrived `undefined`
  // was never loaded, so we cannot tell "the member cleared it" from "we never
  // saw it" — and sending '' would null out saved text. Such a field is left
  // OUT of the save payload until the member actually types in it, at which
  // point it carries a real value and is safe to write.
  const neverLoaded = useRef<Set<string>>(
    new Set(MANUAL_OF_ME_FIELDS.filter((f) => manualOfMe[f] === undefined)),
  );

  // `updateManualOfMe` takes Record<string, string | null>; ManualOfMeDraft's
  // typed keys narrow it to a literal-keyed object, so we widen explicitly.
  const { status, flush } = useAutoSave(draft, async (v) => {
    const payload: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(v as unknown as Record<string, string>)) {
      // Untouched + never loaded → omit, so the upsert leaves the DB value be.
      if (neverLoaded.current.has(key) && value === '') continue;
      payload[key] = value;
    }
    return updateManualOfMe(payload);
  });

  const set = <K extends keyof ManualOfMeDraft>(key: K, value: ManualOfMeDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // KAN-266: the six humanised "about me" prompts from the June-2026 mock-up,
  // in the same order the public profile renders them.
  return (
    <div className="space-y-5">
      <SectionSaveBar status={status} onSave={flush} />

      <p className="text-sm text-[var(--color-muted)]">
        A few little prompts to help people understand you. Every one is optional — fill in only what feels right.
      </p>

      <MoMField
        label="Good to know about me / Things I'm into"
        helper="The little things that help people get you — and the things you're into."
        placeholder="I'm a slow texter but I always reply. I think out loud, so half of what I say is me working it out."
        value={draft.good_to_know}
        onChange={(v) => set('good_to_know', v)}
        onBlur={flush}
        rows={3}
        maxLength={MANUAL_OF_ME_MAX_LENGTHS.good_to_know}
      />

      <MoMField
        label="My boundaries"
        helper="Anything you'd gently ask people to respect."
        placeholder="Please don't drop by unannounced — I love seeing you, I just need a heads-up."
        value={draft.boundaries}
        onChange={(v) => set('boundaries', v)}
        onBlur={flush}
        rows={3}
        maxLength={MANUAL_OF_ME_MAX_LENGTHS.boundaries}
      />

      <MoMField
        label="How I find communication easier"
        helper="How you like people to reach you."
        placeholder="Plain and direct, kindly meant. If something's off, just tell me — I'd rather know."
        value={draft.communication_style}
        onChange={(v) => set('communication_style', v)}
        onBlur={flush}
        rows={3}
        maxLength={MANUAL_OF_ME_MAX_LENGTHS.communication_style}
      />

      <MoMField
        label="If you ever come to my house"
        helper="Anything a visitor would love to know."
        placeholder="Shoes off, the dog is friendly, help yourself to tea — the good biscuits are behind the cereal."
        value={draft.working_preferences}
        onChange={(v) => set('working_preferences', v)}
        onBlur={flush}
        rows={3}
        maxLength={MANUAL_OF_ME_MAX_LENGTHS.working_preferences}
      />

      <MoMField
        label="What gives me energy"
        helper="The things that fill you up."
        placeholder="A morning with no plans, a full pot of coffee, and live music in the evening."
        value={draft.energises_me}
        onChange={(v) => set('energises_me', v)}
        onBlur={flush}
        rows={3}
        maxLength={MANUAL_OF_ME_MAX_LENGTHS.energises_me}
      />

      <MoMField
        label="What drains me"
        helper="The things that wear you out."
        placeholder="Open-plan noise and small talk about the weather."
        value={draft.drains_me}
        onChange={(v) => set('drains_me', v)}
        onBlur={flush}
        rows={3}
        maxLength={MANUAL_OF_ME_MAX_LENGTHS.drains_me}
      />
    </div>
  );
}

function MoMField({
  label, helper, placeholder, value, onChange, onBlur, rows, maxLength,
}: {
  label: string;
  helper: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  // BUGS-70: flush the pending debounced autosave when the field loses focus.
  // Without this, a user (or the E2E harness) who edits a box and immediately
  // navigates away leaves the save on the 800ms debounce timer; the navigation
  // unmounts the section (cancelling the timer) and aborts the in-flight server
  // action, so the edit never lands in profile_manual_of_me. Flushing on blur
  // starts the save at once so the request reaches the server and commits.
  onBlur?: () => void;
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
        onBlur={onBlur}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent resize-none"
      />
      <p className="text-xs text-[var(--color-muted)] mt-1">{value.length}/{maxLength}</p>
    </div>
  );
}
