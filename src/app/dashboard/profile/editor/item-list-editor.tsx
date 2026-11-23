'use client';

/**
 * KAN-487 — v0.8 profile editor: the generic member list (spec v0.8 §01
 * causes / proud of, §03 gifts, §04 not for me, §06 favourites, §07 tips,
 * §08 problems; plan §C list rules).
 *
 *   - Each row shows a compact summary (title, one line of description, link
 *     chip, legacy group tag) with Edit and Remove. Edit expands the row
 *     inline; Done collapses it. New rows, blank rows on load, and rows with
 *     a validation error are shown expanded.
 *   - Remove dispatches `removeRow` (with `at = Date.now()`); the row is
 *     replaced in place by an UndoRow that expires after 8 s. The delete is
 *     committed only on save.
 *   - Add dispatches `addRow` with a client key, opens the new row and moves
 *     focus to its first field. At the cap Add is disabled with "n of cap".
 *   - Limits/caps default to `ITEM_RULES` for the list's new-row category;
 *     the link field defaults to off for categories that take no link.
 *   - Errors come from `validateEditorState`: `<rowKey>.title`,
 *     `<rowKey>.description`, `<rowKey>.url`, and `lists.<listKey>` (cap).
 *   - Line breaks (KAN-487 decision): descriptions are always a textarea and
 *     keep their breaks; a title is a one-line <input>, except a quote's
 *     text (`itemTitleIsMultiline`), which is a textarea.
 *   - Each expanded row is a `role="group"` labelled "‹list›, entry n of m"
 *     (and its fields are described by it), so the repeated "Title" /
 *     "Description" / "Link" labels have context for screen readers.
 *   - Expanded rows stay expanded across a save (`useExpandedRows`).
 */

import { useEffect, useRef } from 'react';
import { ITEM_RULES, URL_MAX } from '@/modules/profile/profile-rules';
import { itemTitleIsMultiline } from '@/modules/profile/field-validation';
import { domSafeKey } from '@/modules/profile/editor/editor-shell';
import { LIST_CATEGORIES, newRowKey } from '@/modules/profile/editor/editor-state';
import { NO_URL_CATEGORIES, isBlankRow } from '@/modules/profile/editor/validate-save-payload';
import {
  capState,
  linkChip,
  listRowGroupLabel,
  oneLine,
  rowHasError,
  rowLabel,
  SUMMARY_DESCRIPTION_MAX,
} from '@/modules/profile/editor/editor-ui-helpers';
import type { EditorAction, EditorRow, ListKey, ListUndoEntry, UndoEntry } from './editor-context';
import { TextArea, TextField } from './text-field';
import { UndoRow } from './undo-row';
import { useExpandedRows } from './use-expanded-rows';

export interface ItemFieldConfig {
  label: string;
  /** Defaults to the list's ITEM_RULES limit. */
  max?: number;
  required?: boolean;
  helper?: string;
  placeholder?: string;
}

export interface ItemListFields {
  title: ItemFieldConfig;
  /** Omit for title-only lists (causes, proud of). */
  description?: ItemFieldConfig;
  /** Show the Link field. Defaults to whether the category takes a link. */
  url?: boolean;
}

export interface ItemListEditorProps {
  listKey: ListKey;
  rows: readonly EditorRow[];
  fields: ItemListFields;
  /** Defaults to the list's ITEM_RULES cap. */
  cap?: number;
  dispatch: (a: EditorAction) => void;
  errors: Record<string, string>;
  /** `state.undo[listKey]`. */
  undo?: UndoEntry;
  /** e.g. "Add gift". */
  addLabel: string;
  /** Sub-list heading (e.g. "Quotes" in Favourites), rendered as an <h3>. */
  heading?: string;
  /** Prompt / helper shown under the heading. */
  description?: React.ReactNode;
  /**
   * The list's name for screen readers ("Gift ideas"), used in each expanded
   * row's group label. Defaults to `heading`.
   */
  listLabel?: string;
  readOnly?: boolean;
}

const BUTTON_FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-sage)] focus-visible:outline-offset-2';
const SECONDARY_BUTTON = `px-4 py-2 rounded-lg bg-[#f4efe7] text-sm font-medium text-[var(--color-ink)] hover:bg-[#ece7df] disabled:opacity-50 transition-colors ${BUTTON_FOCUS}`;
const TEXT_BUTTON = `text-xs font-medium px-2 py-1 rounded-lg disabled:opacity-50 ${BUTTON_FOCUS}`;

export function ItemListEditor({
  listKey,
  rows,
  fields,
  cap,
  dispatch,
  errors,
  undo,
  addLabel,
  heading,
  description,
  listLabel,
  readOnly = false,
}: ItemListEditorProps) {
  const category = LIST_CATEGORIES[listKey].newCategory;
  const rule = ITEM_RULES[category];
  const listCap = cap ?? rule.cap;
  const titleMax = fields.title.max ?? rule.titleMax;
  const descriptionMax = fields.description?.max ?? rule.descriptionMax;
  const showUrl = fields.url ?? !NO_URL_CATEGORIES.has(category);
  const titleMultiline = itemTitleIsMultiline(category);
  const groupName = listLabel ?? heading ?? fields.title.label;
  const base = `list-${listKey}`;

  const { expanded, setOpen } = useExpandedRows(() => rows.filter((r) => isBlankRow(r)).map((r) => r.key));
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

  const { atCap, note } = capState(rows.length, listCap);
  const listError = errors[`lists.${listKey}`];
  const listUndo: ListUndoEntry | undefined = undo && undo.listKey === listKey ? (undo as ListUndoEntry) : undefined;

  const onAdd = () => {
    if (atCap || readOnly) return;
    const key = newRowKey();
    dispatch({ type: 'addRow', listKey, key });
    setOpen(key, true);
    focusTarget.current = `title:${key}`;
  };

  const onRemove = (row: EditorRow) => {
    dispatch({ type: 'removeRow', listKey, key: row.key, at: Date.now() });
    setOpen(row.key, false);
  };

  const onUndo = () => {
    if (!listUndo) return;
    const key = listUndo.row.key;
    dispatch({ type: 'undoRemove', listKey });
    focusTarget.current = expanded.has(key) || rowHasError(errors, key) ? `title:${key}` : `edit:${key}`;
  };

  const renderRow = (row: EditorRow, index: number) => {
    const id = `${base}-${domSafeKey(row.key)}`;
    const label = rowLabel(row.title, row.description);
    const isOpen = expanded.has(row.key) || rowHasError(errors, row.key);
    const patch = (p: Partial<Pick<EditorRow, 'title' | 'description' | 'url'>>) =>
      dispatch({ type: 'updateRow', listKey, key: row.key, patch: p });

    if (!isOpen) {
      const chip = showUrl || row.url ? linkChip(row.url) : { text: '', href: null };
      const desc = oneLine(row.description, SUMMARY_DESCRIPTION_MAX);
      return (
        <li key={row.key} className="bg-white rounded-lg border border-[var(--color-border)] px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-[var(--color-ink)] truncate">
                <span className="font-medium">{label || 'Untitled entry'}</span>
                {desc && row.title.trim() !== '' && <span className="text-[var(--color-muted)]"> — {desc}</span>}
              </p>
              {(chip.text || row.groupLabel) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {row.groupLabel && (
                    <span className="rounded-full px-[9px] py-[2px] text-[11.5px] text-[var(--color-muted)] bg-[#f4efe7]">
                      {row.groupLabel}
                    </span>
                  )}
                  {chip.text &&
                    (chip.href ? (
                      <a
                        href={chip.href}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className={`rounded-full px-[11px] py-[3px] text-[12.5px] text-[var(--color-sage)] bg-[var(--color-accent-soft)] hover:underline ${BUTTON_FOCUS}`}
                      >
                        {chip.text}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <span className="rounded-full px-[11px] py-[3px] text-[12.5px] text-[var(--color-muted)] bg-[#f4efe7]">
                        {chip.text}
                      </span>
                    ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                ref={register(`edit:${row.key}`)}
                type="button"
                onClick={() => {
                  setOpen(row.key, true);
                  focusTarget.current = `title:${row.key}`;
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

    const groupId = `${id}-group`;
    const titleProps = {
      id: `${id}-title`,
      describedBy: groupId,
      label: fields.title.label,
      value: row.title,
      onChange: (v: string) => patch({ title: v }),
      max: titleMax,
      required: fields.title.required,
      helper: fields.title.helper,
      placeholder: fields.title.placeholder,
      error: errors[`${row.key}.title`],
      readOnly,
    };
    return (
      <li key={row.key} className="bg-white rounded-lg border border-[var(--color-border)] px-4 py-3">
        <div className="space-y-3" role="group" aria-labelledby={groupId}>
          <span id={groupId} className="sr-only">
            {listRowGroupLabel(groupName, index, rows.length)}
          </span>
          {titleMultiline ? (
            <TextArea ref={register(`title:${row.key}`)} rows={3} {...titleProps} />
          ) : (
            <TextField ref={register(`title:${row.key}`)} {...titleProps} />
          )}
          {fields.description && (
            <TextArea
              id={`${id}-description`}
              describedBy={groupId}
              label={fields.description.label}
              value={row.description}
              onChange={(v) => patch({ description: v })}
              max={descriptionMax}
              required={fields.description.required}
              helper={fields.description.helper}
              placeholder={fields.description.placeholder}
              error={errors[`${row.key}.description`]}
              readOnly={readOnly}
              rows={2}
            />
          )}
          {(showUrl || row.url !== '') && (
            <TextField
              id={`${id}-url`}
              describedBy={groupId}
              type="url"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              label="Link"
              value={row.url}
              onChange={(v) => patch({ url: v })}
              placeholder="https://"
              error={errors[`${row.key}.url`]}
              readOnly={readOnly}
              max={URL_MAX}
            />
          )}
          {row.groupLabel && (
            <p className="text-xs text-[var(--color-muted)]">
              Group:{' '}
              <span className="rounded-full px-[9px] py-[2px] text-[11.5px] bg-[#f4efe7]">{row.groupLabel}</span>
            </p>
          )}
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
  if (listUndo) {
    const at = Math.max(0, Math.min(listUndo.index, items.length));
    items.splice(
      at,
      0,
      <li key={`undo:${listUndo.row.key}:${listUndo.at}`}>
        <UndoRow
          label={rowLabel(listUndo.row.title, listUndo.row.description)}
          removedAt={listUndo.at}
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
    <div className="space-y-3" role={heading ? 'group' : undefined} aria-labelledby={heading ? headingId : undefined}>
      {heading && (
        <h3 id={headingId} className="text-sm font-semibold text-[var(--color-ink)]">
          {heading}
        </h3>
      )}
      {description && <div className="text-sm text-[var(--color-muted)] leading-relaxed">{description}</div>}
      {items.length > 0 && <ul className="space-y-2">{items}</ul>}
      {listError && <p className="text-[13px] text-red-700">{listError}</p>}
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
