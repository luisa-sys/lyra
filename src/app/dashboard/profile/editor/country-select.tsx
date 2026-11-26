'use client';

/**
 * KAN-487 — v0.8 profile editor, §01 "Country" (spec v0.8 §01 "Country
 * (optional)"; founder decision 2026-11-22: dropdown, stored as the
 * ISO 3166-1 alpha-2 code; plan §C row 01).
 *
 *   - "Not set" (stored as '') followed by `COUNTRIES` in name order.
 *   - A legacy free-text value that is not one of the codes is kept as an
 *     extra option showing the value itself, so opening the editor never
 *     silently drops it.
 */

import { COUNTRIES, isCountryCode } from '@/modules/profile/countries';
import { describedBy } from '@/modules/profile/editor/editor-ui-helpers';
import type { EditorAction } from './editor-context';
import { ERROR_CLASS, FIELD_BORDER_ERROR, FIELD_BORDER_OK, FIELD_CLASS, LABEL_CLASS } from './text-field';

export const COUNTRY_SELECT_ID = 'profile-country';

export interface CountrySelectProps {
  value: string;
  dispatch: (a: EditorAction) => void;
  /** `errors['profile.country']`. */
  error?: string;
  readOnly?: boolean;
}

export function CountrySelect({ value, dispatch, error, readOnly = false }: CountrySelectProps) {
  const legacy = value !== '' && !isCountryCode(value);
  const errorId = `${COUNTRY_SELECT_ID}-error`;
  return (
    <div>
      <label htmlFor={COUNTRY_SELECT_ID} className={LABEL_CLASS}>
        Country
      </label>
      <select
        id={COUNTRY_SELECT_ID}
        value={value}
        onChange={(e) => dispatch({ type: 'setField', field: 'country', value: e.target.value })}
        disabled={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error && errorId)}
        className={`${FIELD_CLASS} ${error ? FIELD_BORDER_ERROR : FIELD_BORDER_OK}`}
      >
        <option value="">Not set</option>
        {legacy && <option value={value}>{value}</option>}
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} className={ERROR_CLASS}>
          {error}
        </p>
      )}
    </div>
  );
}
