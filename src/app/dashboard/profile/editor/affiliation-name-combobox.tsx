'use client';

/**
 * KAN-487 — v0.8 profile editor: the affiliation Name field with type-ahead
 * suggestions (spec v0.8 §02 "Offer autocomplete suggestions with manual
 * fallback"; plan §C row 02). Replaces KAN-451's `sections/affiliation-name-
 * picker.tsx` (deleted in KAN-487 part 3).
 *
 *   - An ordinary labelled `TextField` (counter, required marker, inline
 *     error, aria wiring) — the member can always type any name. Suggestions
 *     are an offer, never a gate.
 *   - Lookups go through `suggestAffiliations` (Lyra's own entries via
 *     `suggest_affiliation_names`), 350 ms after typing stops, from 3
 *     characters. Every decision is in `affiliation-gift-ui.ts` (tested).
 *   - The list is a plain list of real buttons under the field — NOT an ARIA
 *     combobox (KAN-451: announcing a half-implemented combobox pattern is
 *     worse than native semantics that already work). Tab reaches each
 *     button; Escape in the field closes the list.
 *   - With matches the list ends with "add your own", keeping the name as
 *     typed. With no matches (or a failed lookup) no list is shown.
 */

import { useEffect, useState } from 'react';
import type { SuggestionOption } from '@/modules/profile/geo/places-schools';
import {
  SUGGEST_DEBOUNCE_MS,
  shouldLookUpName,
  visibleNameOptions,
  type SuggestAnswer,
} from '@/modules/profile/editor/affiliation-gift-ui';
import type { AffiliationType } from './editor-context';
import { suggestAffiliations } from '../affiliation-search-actions';
import { TextField } from './text-field';

const BUTTON_FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-sage)] focus-visible:-outline-offset-2';

/** Existing KAN-451 hint copy (the old picker's), unchanged. */
const NAME_HINT = "Start typing and we'll suggest matches. Can't see yours? Type it in yourself.";

export interface AffiliationNameComboboxProps {
  /** Unique DOM id of the input. */
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  affiliationType: AffiliationType;
  max: number;
  required?: boolean;
  error?: string;
  readOnly?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}

export function AffiliationNameCombobox({
  id,
  label,
  value,
  onChange,
  affiliationType,
  max,
  required,
  error,
  readOnly = false,
  inputRef,
}: AffiliationNameComboboxProps) {
  const listId = `${id}-suggestions`;
  // The last answer, tagged with the text it answered: the visible list is
  // DERIVED during render, so a stale answer is never shown.
  const [answer, setAnswer] = useState<SuggestAnswer | null>(null);
  // The name just picked or dismissed: closes the list and suppresses the
  // lookup that text would otherwise trigger.
  const [closedFor, setClosedFor] = useState<string | null>(null);

  useEffect(() => {
    if (readOnly || !shouldLookUpName(value, closedFor)) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await suggestAffiliations(value, affiliationType);
        if (cancelled) return;
        setAnswer({ query: value, names: result.success ? result.suggestions.map((s) => s.name) : [] });
      } catch {
        // A failed lookup is the manual fallback: no list, the field still works.
        if (!cancelled) setAnswer({ query: value, names: [] });
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value, affiliationType, closedFor, readOnly]);

  const options = readOnly ? [] : visibleNameOptions(value, answer, closedFor);
  const open = options.length > 0;

  const choose = (option: SuggestionOption) => {
    setClosedFor(option.name);
    onChange(option.name);
  };

  return (
    <div
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setClosedFor(value);
          const input = document.getElementById(id);
          input?.focus();
        }
      }}
    >
      <TextField
        ref={inputRef}
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        max={max}
        required={required}
        error={error}
        readOnly={readOnly}
        helper={NAME_HINT}
        autoComplete="off"
      />
      {open && (
        <ul
          id={listId}
          aria-label={`Matches for ${label}`}
          className="absolute z-10 left-0 right-0 mt-1 overflow-hidden rounded-lg border border-[var(--color-border)] bg-white shadow-sm"
        >
          {options.map((option, i) => (
            <li key={`${option.kind}-${option.name}-${i}`}>
              <button
                type="button"
                onClick={() => choose(option)}
                className={`block w-full px-3 py-2 text-left text-sm text-[var(--color-ink)] hover:bg-[#f4efe7] ${BUTTON_FOCUS}`}
              >
                {option.kind === 'place' ? (
                  <span className="block truncate">{option.name}</span>
                ) : (
                  <span className="block truncate text-[var(--color-sage)]">
                    Add &ldquo;{option.name}&rdquo; as I typed it
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
