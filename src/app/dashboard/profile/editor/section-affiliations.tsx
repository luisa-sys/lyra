'use client';

/**
 * KAN-487 — v0.8 profile editor, section 02 "Where you might know me from"
 * (spec v0.8 §02; plan §C row 02, §D copy, §E classes).
 *
 *   - Spec helper and privacy copy, verbatim.
 *   - Three groups — Schools, Organisations, Communities — up to 7 entries
 *     each, with "Add school" / "Add organisation" / "Add community"
 *     (disabled at the cap with "n of 7").
 *   - School: Name* 120 (autocomplete) + Postcode* 12 + Description 250.
 *     Organisation / Community: Name* 120 (autocomplete) + Location 120 +
 *     Description 250. Limits and labels from `affiliationFieldSpec`.
 *   - Each row: compact summary with Edit / Remove and a "Show on my
 *     profile" checkbox, OFF by default (the reducer's `addAffiliation`
 *     sets it false). Edit expands the row inline; new rows, blank rows and
 *     rows with a validation error are shown expanded.
 *   - Remove → undo row in place for 8 s (focus moves to Undo, announced
 *     politely). One affiliation undo is kept for all three groups; it is
 *     shown inside the removed row's own group (`undoIndexInGroup`).
 *   - Errors from `validateEditorState`: `<rowKey>.name|location|
 *     description` and `affiliations.<type>` (cap).
 *
 * Renders its own `EditorSectionCard` (id `affiliations`, number 2).
 */

import { useEffect, useRef } from 'react';
import { newRowKey } from '@/modules/profile/editor/editor-state';
import { domSafeKey } from '@/modules/profile/editor/editor-shell';
import { capState, rowHasError, rowLabel, oneLine, SUMMARY_DESCRIPTION_MAX } from '@/modules/profile/editor/editor-ui-helpers';
import {
  AFFILIATION_GROUPS,
  affiliationFieldSpec,
  rowsOfType,
  undoIndexInGroup,
  type AffiliationGroupDef,
} from '@/modules/profile/editor/affiliation-gift-ui';
import { AFFILIATION_RULES } from '@/modules/profile/profile-rules';
import type { AffPatch, AffRow, EditorAction, SectionProps, UndoEntry } from './editor-context';
import { EditorSectionCard } from './editor-section-card';
import { AffiliationNameCombobox } from './affiliation-name-combobox';
import { TextArea, TextField } from './text-field';
import { UndoRow } from './undo-row';
import { useExpandedRows } from './use-expanded-rows';

/** Spec v0.8 §02 copy, verbatim. */
export const AFFILIATIONS_HELPER =
  'Schools, organisations, and communities you’re part of. These help the right people find you.';
export const AFFILIATIONS_PRIVACY =
  'These are hidden on your public profile by default — they’re only used to help people who know you find you. Tick ‘Show on my profile’ on any you’re happy to display.';
export const SHOW_ON_PROFILE_LABEL = 'Show on my profile';

const BUTTON_FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-sage)] focus-visible:outline-offset-2';
const SECONDARY_BUTTON = `px-4 py-2 rounded-lg bg-[#f4efe7] text-sm font-medium text-[var(--color-ink)] hover:bg-[#ece7df] disabled:opacity-50 transition-colors ${BUTTON_FOCUS}`;
const TEXT_BUTTON = `text-xs font-medium px-2 py-1 rounded-lg disabled:opacity-50 ${BUTTON_FOCUS}`;

type AffUndo = Extract<UndoEntry, { listKey: 'affiliations' }>;

export interface SectionAffiliationsProps extends SectionProps {
  /** Controlled collapse (optional; the card is uncontrolled otherwise). */
  open?: boolean;
  onToggle?: (id: string, nextOpen: boolean) => void;
}

function isBlankAff(r: AffRow): boolean {
  return r.name.trim() === '' && r.location.trim() === '' && r.description.trim() === '';
}

export function SectionAffiliations({ state, dispatch, errors, readOnly = false, open, onToggle }: SectionAffiliationsProps) {
  const entry = state.undo.affiliations;
  const undo: AffUndo | undefined = entry && entry.listKey === 'affiliations' ? (entry as AffUndo) : undefined;
  return (
    <EditorSectionCard
      id="affiliations"
      number={2}
      label="Where you might know me from"
      open={open}
      onToggle={onToggle}
      description={<p>{AFFILIATIONS_HELPER}</p>}
    >
      <p className="mb-5 rounded-lg bg-[var(--color-accent-soft)] px-4 py-3 text-sm text-[var(--color-ink)] leading-relaxed">
        {AFFILIATIONS_PRIVACY}
      </p>
      <div className="space-y-6">
        {AFFILIATION_GROUPS.map((group) => (
          <AffiliationGroup
            key={group.type}
            group={group}
            allRows={state.affiliations}
            undo={undo && undo.row.affiliationType === group.type ? undo : undefined}
            dispatch={dispatch}
            errors={errors}
            readOnly={readOnly}
          />
        ))}
      </div>
    </EditorSectionCard>
  );
}

interface AffiliationGroupProps {
  group: AffiliationGroupDef;
  allRows: readonly AffRow[];
  undo: AffUndo | undefined;
  dispatch: (a: EditorAction) => void;
  errors: Record<string, string>;
  readOnly: boolean;
}

function AffiliationGroup({ group, allRows, undo, dispatch, errors, readOnly }: AffiliationGroupProps) {
  const { type, heading, addLabel } = group;
  const spec = affiliationFieldSpec(type);
  const rows = rowsOfType(allRows, type);
  const base = `aff-${type}`;

  // Expanded rows survive a save (new keys → stored ids).
  const { expanded, setOpen } = useExpandedRows(() => rows.filter(isBlankAff).map((r) => r.key));
  const focusTarget = useRef<string | null>(null);
  const focusables = useRef(new Map<string, HTMLElement>());
  const addRef = useRef<HTMLButtonElement>(null);

  // Move focus after the render that shows its target (new row, Done, Undo).
  useEffect(() => {
    const target = focusTarget.current;
    if (target === null) return;
    const el = focusables.current.get(target);
    focusTarget.current = null;
    el?.focus();
  });

  const register = (id: string) => (el: HTMLElement | null) => {
    if (el) focusables.current.set(id, el);
    else focusables.current.delete(id);
  };

  const { atCap, note } = capState(rows.length, AFFILIATION_RULES.capPerType);
  const capError = errors[`affiliations.${type}`];

  const onAdd = () => {
    if (atCap || readOnly) return;
    const key = newRowKey();
    dispatch({ type: 'addAffiliation', affiliationType: type, key });
    setOpen(key, true);
    focusTarget.current = `name:${key}`;
  };

  const onRemove = (row: AffRow) => {
    dispatch({ type: 'removeAffiliation', key: row.key, at: Date.now() });
    setOpen(row.key, false);
  };

  const onUndo = () => {
    if (!undo) return;
    const key = undo.row.key;
    dispatch({ type: 'undoRemove', listKey: 'affiliations' });
    focusTarget.current = expanded.has(key) || rowHasError(errors, key) ? `name:${key}` : `edit:${key}`;
  };

  const renderShowToggle = (row: AffRow, id: string, nameId: string) => (
    <div className="flex items-center gap-2">
      <input
        id={`${id}-show`}
        type="checkbox"
        checked={row.showOnProfile}
        onChange={(e) => dispatch({ type: 'updateAffiliation', key: row.key, patch: { showOnProfile: e.target.checked } })}
        disabled={readOnly}
        aria-describedby={nameId}
        className={`h-[18px] w-[18px] shrink-0 rounded accent-[var(--color-sage)] disabled:opacity-50 ${BUTTON_FOCUS}`}
      />
      <label htmlFor={`${id}-show`} className="text-sm text-[var(--color-ink)]">
        {SHOW_ON_PROFILE_LABEL}
      </label>
    </div>
  );

  const renderRow = (row: AffRow) => {
    const id = `${base}-${domSafeKey(row.key)}`;
    const nameId = `${id}-summary`;
    const label = rowLabel(row.name, row.description);
    const isOpen = expanded.has(row.key) || rowHasError(errors, row.key);
    const patch = (p: AffPatch) => dispatch({ type: 'updateAffiliation', key: row.key, patch: p });

    if (!isOpen) {
      const desc = oneLine(row.description, SUMMARY_DESCRIPTION_MAX);
      const loc = oneLine(row.location, SUMMARY_DESCRIPTION_MAX);
      return (
        <li key={row.key} className="bg-white rounded-lg border border-[var(--color-border)] px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p id={nameId} className="text-sm text-[var(--color-ink)] truncate">
                <span className="font-medium">{label || 'Untitled entry'}</span>
                {loc && <span className="text-[var(--color-muted)]"> · {loc}</span>}
              </p>
              {desc && row.name.trim() !== '' && (
                <p className="text-sm text-[var(--color-muted)] truncate">{desc}</p>
              )}
              <div className="mt-2">{renderShowToggle(row, id, nameId)}</div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                ref={register(`edit:${row.key}`)}
                type="button"
                onClick={() => {
                  setOpen(row.key, true);
                  focusTarget.current = `name:${row.key}`;
                }}
                disabled={readOnly}
                aria-label={`Edit ${label || 'entry'}`}
                className={`${TEXT_BUTTON} text-[var(--color-muted)] hover:text-[var(--color-ink)]`}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onRemove(row)}
                disabled={readOnly}
                aria-label={`Remove ${label || 'entry'}`}
                className={`${TEXT_BUTTON} text-red-600 hover:text-red-700`}
              >
                Remove
              </button>
            </div>
          </div>
        </li>
      );
    }

    return (
      <li key={row.key} className="bg-white rounded-lg border border-[var(--color-border)] px-4 py-3">
        <div className="space-y-3">
          <AffiliationNameCombobox
            id={`${id}-name`}
            inputRef={register(`name:${row.key}`)}
            label={spec.nameLabel}
            value={row.name}
            onChange={(v) => patch({ name: v })}
            affiliationType={type}
            max={spec.nameMax}
            required
            error={errors[`${row.key}.name`]}
            readOnly={readOnly}
          />
          <TextField
            id={`${id}-location`}
            label={spec.locationLabel}
            value={row.location}
            onChange={(v) => patch({ location: v })}
            max={spec.locationMax}
            required={spec.locationRequired}
            autoComplete={spec.locationRequired ? 'postal-code' : 'off'}
            error={errors[`${row.key}.location`]}
            readOnly={readOnly}
          />
          <TextArea
            id={`${id}-description`}
            label={spec.descriptionLabel}
            value={row.description}
            onChange={(v) => patch({ description: v })}
            max={spec.descriptionMax}
            error={errors[`${row.key}.description`]}
            readOnly={readOnly}
            rows={2}
          />
          <span id={nameId} className="sr-only">
            {label}
          </span>
          {renderShowToggle(row, id, nameId)}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(row.key, false);
                focusTarget.current = `edit:${row.key}`;
              }}
              disabled={readOnly}
              className={SECONDARY_BUTTON}
            >
              Done
            </button>
            <button
              type="button"
              onClick={() => onRemove(row)}
              disabled={readOnly}
              aria-label={`Remove ${label || 'entry'}`}
              className={`px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50 ${BUTTON_FOCUS}`}
            >
              Remove
            </button>
          </div>
        </div>
      </li>
    );
  };

  const items: React.ReactNode[] = rows.map(renderRow);
  if (undo) {
    const at = undoIndexInGroup(allRows, undo.index, type);
    items.splice(
      Math.min(at, items.length),
      0,
      <li key={`undo:${undo.row.key}:${undo.at}`}>
        <UndoRow
          label={rowLabel(undo.row.name, undo.row.description)}
          removedAt={undo.at}
          onUndo={onUndo}
          disabled={readOnly}
          onExpire={(hadFocus) => {
            if (hadFocus) addRef.current?.focus();
          }}
        />
      </li>,
    );
  }

  const headingId = `${base}-heading`;
  return (
    <div className="space-y-3" role="group" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold text-[var(--color-ink)]">
        {heading}
      </h3>
      {items.length > 0 && <ul className="space-y-2">{items}</ul>}
      {capError && <p className="text-[13px] text-red-700">{capError}</p>}
      <div className="flex items-center gap-3">
        <button
          ref={addRef}
          type="button"
          onClick={onAdd}
          disabled={atCap || readOnly}
          aria-describedby={`${base}-cap`}
          className={SECONDARY_BUTTON}
        >
          {addLabel}
        </button>
        <span id={`${base}-cap`} className="text-xs text-[var(--color-muted)] tabular-nums">
          {note}
        </span>
      </div>
    </div>
  );
}
