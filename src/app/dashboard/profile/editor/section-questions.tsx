'use client';

/**
 * KAN-487 — v0.8 profile editor §09 "Random Questions & Answers" (spec v0.8
 * §09, "Configurable question bank"; plan §C row 09). Section id stays
 * `starters` (kan469 asserts it).
 *
 * Three groups (split by the pure `groupQuestions`):
 *   - **Answered**: every preset answer the member has, including answers to
 *     presets deactivated since, with the wording stored on the row. Edit
 *     expands inline; Remove dispatches `removeQuestion` and shows an undo
 *     row in place (8 s; the delete is committed only on save).
 *   - **Unanswered**: active presets not yet answered, in display order.
 *     Each expands to an answer field whose counter uses that preset's own
 *     `answerMax` (nothing hard-coded). Typing dispatches `answerPreset`; the
 *     answer moves to Answered when the member closes it with Done.
 *   - **Your own questions**: up to 10 (question 180, answer 500). "Move up"
 *     / "Move down" buttons dispatch `moveCustomQuestion` (keyboard only, no
 *     drag), are disabled at the ends, keep focus on the moved question and
 *     announce its new position. "Add your own question" is disabled at 10.
 *
 * Every "Your answer" field carries its question in a screen-reader-only
 * part of its label (`answerLabelContext`), so the many answer fields are
 * told apart (WCAG 1.3.1 / 2.4.6).
 * Errors come from `validateEditorState`: `<rowKey>.answer`,
 * `<rowKey>.custom_prompt`, and `questions.custom` (cap). A row with an
 * error is always shown expanded.
 */

import { useEffect, useRef, useState } from 'react';
import { newRowKey } from '@/modules/profile/editor/editor-state';
import {
  CUSTOM_ANSWER_MAX,
  CUSTOM_PROMPT_MAX,
  CUSTOM_QUESTION_CAP,
} from '@/modules/profile/editor/validate-save-payload';
import {
  customMoveState,
  groupQuestions,
  presetAnswerLimit,
  questionUndoSlot,
} from '@/modules/profile/editor/question-sections';
import { answerLabelContext, capState, rowHasError, rowLabel } from '@/modules/profile/editor/editor-ui-helpers';
import { domSafeKey } from '@/modules/profile/editor/editor-shell';
import type { CustomQuestionRow, PresetQuestionRow, QuestionRow, SectionProps } from './editor-context';
import { EditorSectionCard } from './editor-section-card';
import { TextArea, TextField } from './text-field';
import { UndoRow } from './undo-row';
import { useExpandedRows } from './use-expanded-rows';

const BUTTON_FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-sage)] focus-visible:outline-offset-2';
const SECONDARY_BUTTON = `px-4 py-2 rounded-lg bg-[#f4efe7] text-sm font-medium text-[var(--color-ink)] hover:bg-[#ece7df] disabled:opacity-50 transition-colors ${BUTTON_FOCUS}`;
const TEXT_BUTTON = `text-xs font-medium px-2 py-1 rounded-lg disabled:opacity-50 ${BUTTON_FOCUS}`;
const MUTED_TEXT_BUTTON = `${TEXT_BUTTON} text-[var(--color-muted)] hover:text-[var(--color-ink)]`;
const REMOVE_TEXT_BUTTON = `${TEXT_BUTTON} text-red-600 hover:text-red-700`;
const ROW_CLASS = 'bg-white rounded-lg border border-[var(--color-border)] px-4 py-3';
const GROUP_HEADING = 'text-sm font-semibold text-[var(--color-ink)]';

function questionLabel(q: QuestionRow): string {
  return q.kind === 'preset' ? rowLabel(q.prompt, q.answer) : rowLabel(q.customPrompt, q.answer);
}

export function SectionQuestions({ state, dispatch, errors, readOnly = false }: SectionProps) {
  /** Prompt ids opened from Unanswered and not yet closed with Done. */
  const [drafting, setDrafting] = useState<ReadonlySet<string>>(() => new Set());
  /** Row keys of Answered / custom rows open for editing (kept across a save). */
  const { expanded, setOpen } = useExpandedRows(() => []);
  const [moveStatus, setMoveStatus] = useState('');
  const focusTarget = useRef<string | null>(null);
  const focusables = useRef(new Map<string, HTMLElement>());
  const addRef = useRef<HTMLButtonElement>(null);

  // Move focus after the render that shows its target.
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

  const setDraft = (promptId: string, open: boolean) =>
    setDrafting((prev) => {
      const next = new Set(prev);
      if (open) next.add(promptId);
      else next.delete(promptId);
      return next;
    });

  const undo = state.undo.questions;
  const groups = groupQuestions(state.questions, state.presets, drafting, undo);
  const undoSlot = questionUndoSlot(state.questions, drafting, undo);
  const { atCap, note } = capState(groups.custom.length, CUSTOM_QUESTION_CAP);
  const capError = errors['questions.custom'];

  /** Blank rows and rows with an error are always open. */
  const mustStayOpen = (q: QuestionRow) =>
    rowHasError(errors, q.key) ||
    (q.kind === 'preset' ? q.answer.trim() === '' : q.customPrompt.trim() === '' && q.answer.trim() === '');

  const isOpen = (q: QuestionRow) => expanded.has(q.key) || mustStayOpen(q);

  const firstFieldId = (q: QuestionRow) => (q.kind === 'preset' ? `answer:${q.key}` : `prompt:${q.key}`);

  const onEdit = (q: QuestionRow) => {
    setOpen(q.key, true);
    focusTarget.current = firstFieldId(q);
  };

  const onDone = (q: QuestionRow) => {
    setOpen(q.key, false);
    focusTarget.current = mustStayOpen(q) ? firstFieldId(q) : `edit:${q.key}`;
  };

  const onRemove = (q: QuestionRow) => {
    dispatch({ type: 'removeQuestion', key: q.key, at: Date.now() });
    setOpen(q.key, false);
  };

  const onUndo = () => {
    if (!undo || undo.listKey !== 'questions') return;
    const row = undo.row;
    dispatch({ type: 'undoRemove', listKey: 'questions' });
    focusTarget.current = isOpen(row) ? firstFieldId(row) : `edit:${row.key}`;
  };

  const onAddCustom = () => {
    if (atCap || readOnly) return;
    const key = newRowKey();
    dispatch({ type: 'addCustomQuestion', key });
    setOpen(key, true);
    focusTarget.current = `prompt:${key}`;
  };

  const onMove = (q: CustomQuestionRow, index: number, direction: -1 | 1) => {
    const count = groups.custom.length;
    const to = index + direction;
    if (to < 0 || to >= count) return;
    dispatch({ type: 'moveCustomQuestion', key: q.key, direction });
    // Keep focus on the moved question: the same button, or the other one
    // when the question has reached an end and this button is now disabled.
    const after = customMoveState(to, count);
    const same = direction === -1 ? after.canMoveUp : after.canMoveDown;
    const button = (direction === -1) === same ? 'up' : 'down';
    focusTarget.current = `${button}:${q.key}`;
    setMoveStatus(`Moved to position ${to + 1} of ${count}.`);
  };

  const onDraftToggle = (promptId: string, open: boolean, answered: boolean, rowKey: string | null) => {
    setDraft(promptId, open);
    if (open) {
      focusTarget.current = `draft:${promptId}`;
    } else if (answered && rowKey !== null) {
      // The answer now lives in Answered; follow it there (to its field
      // when an error keeps it open).
      focusTarget.current = rowHasError(errors, rowKey) ? `answer:${rowKey}` : `edit:${rowKey}`;
    } else {
      focusTarget.current = `toggle:${promptId}`;
    }
  };

  const undoItem = (group: 'answered' | 'custom'): React.ReactNode =>
    undo && undo.listKey === 'questions' && undoSlot?.group === group ? (
      <li key={`undo:${undo.row.key}:${undo.at}`}>
        <UndoRow
          label={questionLabel(undo.row)}
          removedAt={undo.at}
          onUndo={onUndo}
          disabled={readOnly}
          onExpire={(hadFocus) => {
            if (hadFocus) addRef.current?.focus();
          }}
        />
      </li>
    ) : null;

  const withUndo = (items: React.ReactNode[], group: 'answered' | 'custom'): React.ReactNode[] => {
    const u = undoItem(group);
    if (u === null || undoSlot === null) return items;
    const out = items.slice();
    out.splice(Math.max(0, Math.min(undoSlot.position, out.length)), 0, u);
    return out;
  };

  // ── Answered ──────────────────────────────────────────────────────────

  const renderAnswered = (q: PresetQuestionRow) => {
    const id = `q-${domSafeKey(q.key)}`;
    const label = questionLabel(q);
    const open = isOpen(q);
    return (
      <li key={q.key} className={ROW_CLASS}>
        <p id={`${id}-prompt`} className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-1">
          {q.prompt}
        </p>
        {open ? (
          <div className="space-y-3">
            <TextArea
              ref={register(`answer:${q.key}`)}
              id={`${id}-answer`}
              label="Your answer"
              labelContext={answerLabelContext(q.prompt)}
              value={q.answer}
              onChange={(answer) => dispatch({ type: 'updateQuestion', key: q.key, patch: { answer } })}
              max={presetAnswerLimit(q.answerMax)}
              error={errors[`${q.key}.answer`]}
              readOnly={readOnly}
              rows={3}
            />
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => onDone(q)} disabled={readOnly} className={SECONDARY_BUTTON}>
                Done
              </button>
              <button
                type="button"
                onClick={() => onRemove(q)}
                disabled={readOnly}
                aria-label={`Remove ${label || 'answer'}`}
                className={`px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50 ${BUTTON_FOCUS}`}
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 text-sm text-[var(--color-ink)] leading-relaxed whitespace-pre-line line-clamp-3">
              {q.answer}
            </p>
            <div className="flex items-center gap-1 shrink-0">
              <button
                ref={register(`edit:${q.key}`)}
                type="button"
                onClick={() => onEdit(q)}
                disabled={readOnly}
                aria-label={`Edit ${label || 'answer'}`}
                className={MUTED_TEXT_BUTTON}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onRemove(q)}
                disabled={readOnly}
                aria-label={`Remove ${label || 'answer'}`}
                className={REMOVE_TEXT_BUTTON}
              >
                Remove
              </button>
            </div>
          </div>
        )}
      </li>
    );
  };

  // ── Unanswered ────────────────────────────────────────────────────────

  const renderUnanswered = ({ preset, row }: (typeof groups.unanswered)[number]) => {
    const id = `qp-${domSafeKey(preset.id)}`;
    const open = drafting.has(preset.id);
    const value = row?.answer ?? '';
    const answered = value.trim() !== '';
    return (
      <li key={preset.id} className="bg-white rounded-lg border border-[var(--color-border)]">
        <h4 className="m-0">
          <button
            ref={register(`toggle:${preset.id}`)}
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-panel`}
            onClick={() => onDraftToggle(preset.id, !open, answered, row?.key ?? null)}
            disabled={readOnly}
            className={`w-full flex items-start gap-2 text-left px-4 py-3 text-sm text-[var(--color-ink)] rounded-lg hover:bg-[var(--color-paper)] disabled:opacity-50 ${BUTTON_FOCUS}`}
          >
            <span aria-hidden="true" className="text-[var(--color-muted)] shrink-0">
              {open ? '▾' : '▸'}
            </span>
            <span>{preset.prompt}</span>
          </button>
        </h4>
        <div id={`${id}-panel`} hidden={!open} className="px-4 pb-4 space-y-3">
          {open && (
            <>
              <TextArea
                ref={register(`draft:${preset.id}`)}
                id={`${id}-answer`}
                label="Your answer"
                labelContext={answerLabelContext(preset.prompt)}
                value={value}
                onChange={(text) =>
                  // The key only matters for the first keystroke (it creates the row).
                  dispatch({ type: 'answerPreset', promptId: preset.id, text, key: row?.key ?? newRowKey() })
                }
                max={presetAnswerLimit(preset.answerMax)}
                error={row ? errors[`${row.key}.answer`] : undefined}
                readOnly={readOnly}
                rows={3}
              />
              <button
                type="button"
                onClick={() => onDraftToggle(preset.id, false, answered, row?.key ?? null)}
                disabled={readOnly}
                className={SECONDARY_BUTTON}
              >
                Done
              </button>
            </>
          )}
        </div>
      </li>
    );
  };

  // ── Your own questions ────────────────────────────────────────────────

  const renderCustom = (q: CustomQuestionRow, index: number) => {
    const id = `qc-${domSafeKey(q.key)}`;
    const label = questionLabel(q);
    const open = isOpen(q);
    const { canMoveUp, canMoveDown } = customMoveState(index, groups.custom.length);
    const moveButtons = (
      <>
        <button
          ref={register(`up:${q.key}`)}
          type="button"
          onClick={() => onMove(q, index, -1)}
          disabled={readOnly || !canMoveUp}
          aria-label={`Move up: ${label || 'question'}`}
          className={MUTED_TEXT_BUTTON}
        >
          Move up
        </button>
        <button
          ref={register(`down:${q.key}`)}
          type="button"
          onClick={() => onMove(q, index, 1)}
          disabled={readOnly || !canMoveDown}
          aria-label={`Move down: ${label || 'question'}`}
          className={MUTED_TEXT_BUTTON}
        >
          Move down
        </button>
      </>
    );

    if (!open) {
      return (
        <li key={q.key} className={ROW_CLASS}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--color-ink)]">{q.customPrompt}</p>
              <p className="mt-1 text-sm text-[var(--color-ink)] leading-relaxed whitespace-pre-line line-clamp-3">
                {q.answer}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
              {moveButtons}
              <button
                ref={register(`edit:${q.key}`)}
                type="button"
                onClick={() => onEdit(q)}
                disabled={readOnly}
                aria-label={`Edit ${label || 'question'}`}
                className={MUTED_TEXT_BUTTON}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onRemove(q)}
                disabled={readOnly}
                aria-label={`Remove ${label || 'question'}`}
                className={REMOVE_TEXT_BUTTON}
              >
                Remove
              </button>
            </div>
          </div>
        </li>
      );
    }

    return (
      <li key={q.key} className={ROW_CLASS}>
        <div className="space-y-3">
          <TextField
            ref={register(`prompt:${q.key}`)}
            id={`${id}-prompt`}
            label="Your question"
            value={q.customPrompt}
            onChange={(customPrompt) => dispatch({ type: 'updateQuestion', key: q.key, patch: { customPrompt } })}
            max={CUSTOM_PROMPT_MAX}
            required
            error={errors[`${q.key}.custom_prompt`]}
            readOnly={readOnly}
          />
          <TextArea
            id={`${id}-answer`}
            label="Your answer"
            labelContext={answerLabelContext(q.customPrompt)}
            value={q.answer}
            onChange={(answer) => dispatch({ type: 'updateQuestion', key: q.key, patch: { answer } })}
            max={CUSTOM_ANSWER_MAX}
            required
            error={errors[`${q.key}.answer`]}
            readOnly={readOnly}
            rows={3}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onDone(q)} disabled={readOnly} className={SECONDARY_BUTTON}>
              Done
            </button>
            <button
              type="button"
              onClick={() => onRemove(q)}
              disabled={readOnly}
              aria-label={`Remove ${label || 'question'}`}
              className={`px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50 ${BUTTON_FOCUS}`}
            >
              Remove
            </button>
            <span className="ml-auto flex items-center gap-1">{moveButtons}</span>
          </div>
        </div>
      </li>
    );
  };

  const answeredItems = withUndo(groups.answered.map(renderAnswered), 'answered');
  const customItems = withUndo(groups.custom.map(renderCustom), 'custom');

  return (
    <EditorSectionCard id="starters" number={9} label="Random Questions & Answers">
      <div className="space-y-6">
        {answeredItems.length > 0 && (
          <div role="group" aria-labelledby="starters-answered-heading" className="space-y-3">
            <h3 id="starters-answered-heading" className={GROUP_HEADING}>
              Answered
            </h3>
            <ul className="space-y-2">{answeredItems}</ul>
          </div>
        )}

        {groups.unanswered.length > 0 && (
          <div role="group" aria-labelledby="starters-unanswered-heading" className="space-y-3">
            <h3 id="starters-unanswered-heading" className={GROUP_HEADING}>
              Unanswered
            </h3>
            <ul className="space-y-2">{groups.unanswered.map(renderUnanswered)}</ul>
          </div>
        )}

        <div role="group" aria-labelledby="starters-custom-heading" className="space-y-3">
          <h3 id="starters-custom-heading" className={GROUP_HEADING}>
            Your own questions
          </h3>
          {customItems.length > 0 && <ul className="space-y-2">{customItems}</ul>}
          <p role="status" aria-live="polite" className="sr-only">
            {moveStatus}
          </p>
          {capError && <p className="text-[13px] text-red-700">{capError}</p>}
          <div className="flex items-center gap-3">
            <button
              ref={addRef}
              type="button"
              onClick={onAddCustom}
              disabled={atCap || readOnly}
              aria-describedby="starters-custom-cap"
              className={SECONDARY_BUTTON}
            >
              Add your own question
            </button>
            <span id="starters-custom-cap" className="text-xs text-[var(--color-muted)] tabular-nums">
              {note}
            </span>
          </div>
        </div>
      </div>
    </EditorSectionCard>
  );
}
