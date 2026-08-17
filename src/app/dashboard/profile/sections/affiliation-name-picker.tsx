'use client';

/**
 * KAN-451 — name field with type-ahead suggestions for the affiliations
 * editor.
 *
 * Deliberately thin: every decision it makes (when to look up, what the list
 * contains, what a pick does to the postcode) is a pure function in
 * `src/modules/profile/geo/places-schools.ts`, so the behaviour is unit-tested rather than
 * locked inside JSX the repo's `node` jest environment cannot render.
 *
 * The list ALWAYS ends with "add your own", and the input is an ordinary text
 * field throughout — suggestions are an offer, never a requirement. If the
 * lookup returns nothing, this behaves exactly like the plain field it
 * replaced.
 */

import { useEffect, useId, useState } from 'react';
import {
  buildSuggestionOptions,
  resolvePickedLocation,
  shouldSuggest,
  type PlaceSuggestion,
  type SuggestionOption,
} from '@/modules/profile/geo/places-schools';
import { suggestAffiliations } from '../affiliation-search-actions';

const DEBOUNCE_MS = 350;

export function AffiliationNamePicker({
  label,
  value,
  onChange,
  onPick,
  placeholder,
  affiliationType,
  location,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** Called when a row is chosen — with the name and the postcode to keep. */
  onPick: (name: string, location: string) => void;
  placeholder?: string;
  affiliationType: string;
  /** Current postcode/location, so a picked suggestion never overwrites it. */
  location: string;
  disabled?: boolean;
}) {
  const baseId = useId();
  const inputId = `${baseId}-name`;
  const listId = `${baseId}-suggestions`;
  const hintId = `${baseId}-hint`;

  // The last answer we got, tagged with the text it was an answer to. Kept as
  // one piece of state so the visible list can be DERIVED during render rather
  // than cleared from inside the effect — synchronous setState in an effect
  // cascades renders, and deriving is what the rule asks for anyway.
  const [matches, setMatches] = useState<{ query: string; places: PlaceSuggestion[] }>({
    query: '',
    places: [],
  });
  // The name that was just chosen — closes the list and suppresses the lookup
  // the pick would otherwise trigger. State rather than a ref because the
  // derived list below reads it during render.
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    if (chosen === value) return;
    if (!shouldSuggest(value)) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await suggestAffiliations(value, affiliationType);
      if (cancelled) return;
      setMatches({ query: value, places: result.success ? result.suggestions : [] });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, affiliationType, chosen]);

  // Only show an answer that belongs to the text currently in the box. With no
  // matches there is nothing to choose between, so we don't open a list holding
  // only "add your own" — the plain field already does that.
  const isFresh = matches.query === value && chosen !== value;
  const options: SuggestionOption[] =
    isFresh && matches.places.length > 0 ? buildSuggestionOptions(value, matches.places) : [];
  const open = options.length > 0;

  const choose = (option: SuggestionOption) => {
    setChosen(option.name);
    if (option.kind === 'place') {
      onPick(option.name, resolvePickedLocation(option, location));
    } else {
      onPick(option.name, location);
    }
  };

  return (
    <div className="relative">
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-[var(--color-ink)] mb-1"
      >
        {label}
      </label>
      {/* Ordinary labelled text input with a plain list of buttons beneath —
          NOT an ARIA combobox. A combobox role commits us to arrow-key
          navigation and aria-activedescendant; announcing a pattern we only
          half-implement is worse for a screen-reader user than native
          semantics that already work, and it would fail the axe gate. */}
      <input
        id={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        aria-describedby={hintId}
        className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-ink)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-sage)] focus:border-transparent"
      />
      <p id={hintId} className="mt-1 text-xs text-[var(--color-muted)]">
        Start typing and we&apos;ll suggest matches. Can&apos;t see yours? Type it in yourself.
      </p>

      {open && (
        <ul
          id={listId}
          aria-label={`Matches for ${label}`}
          className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-white shadow-sm"
        >
          {options.map((option, i) => (
            <li key={`${option.kind}-${option.name}-${i}`}>
              <button
                type="button"
                onClick={() => choose(option)}
                className="block w-full px-3 py-2 text-left text-sm text-[var(--color-ink)] hover:bg-[#f4efe7]"
              >
                {option.kind === 'place' ? (
                  <>
                    <span className="block truncate">{option.name}</span>
                    {option.address && (
                      <span className="block truncate text-xs text-[var(--color-muted)]">
                        {option.address}
                      </span>
                    )}
                  </>
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
