/**
 * KAN-487 — v0.8 profile editor §09 "Random Questions & Answers": how the
 * editor's questions are split into the three groups the section shows
 * (spec v0.8 §09 and "Configurable question bank"; plan §C row 09).
 *
 * Pure data in / data out, so the section component stays thin and Jest
 * (no DOM) can test the rules:
 *
 *   - **Answered**: every preset answer the member has, INCLUDING answers to
 *     presets deactivated since (spec: "NEVER removes existing answers"),
 *     shown with the wording stored on the row. A stored answer the member
 *     has cleared stays here so it can be retyped (saving it blank deletes
 *     it). A new answer being typed in the Unanswered group stays there until
 *     the member closes it ("drafting"), so the field does not jump away
 *     mid-typing.
 *   - **Unanswered**: ACTIVE presets with no answer yet, in display order
 *     (`sortOrder`, then the order the loader gave). Deactivated presets are
 *     never offered. A preset whose removed answer is still undoable is not
 *     offered either, so Undo can never create a second answer to the same
 *     preset.
 *   - **Your own questions**: custom questions in display order.
 *
 * Answer limits come from each preset's own `answerMax` (configurable in the
 * question bank, nothing hard-coded); a missing one falls back to the DB
 * default and every limit is clamped to the table ceiling, exactly like the
 * validator.
 */

import type {
  CustomQuestionRow,
  PresetPrompt,
  PresetQuestionRow,
  QuestionRow,
  UndoEntry,
} from '@/modules/profile/editor/editor-state';
import { ANSWER_HARD_MAX, DEFAULT_PRESET_ANSWER_MAX } from '@/modules/profile/editor/validate-save-payload';

export interface UnansweredPreset {
  preset: PresetPrompt;
  /** The answer being drafted for it this session, if typing has started. */
  row: PresetQuestionRow | null;
}

export interface QuestionGroups {
  answered: PresetQuestionRow[];
  unanswered: UnansweredPreset[];
  custom: CustomQuestionRow[];
}

/** The answer limit for a preset: its own `answerMax`, else the DB default, clamped. */
export function presetAnswerLimit(answerMax: number | null | undefined): number {
  const n = typeof answerMax === 'number' && Number.isFinite(answerMax) ? answerMax : DEFAULT_PRESET_ANSWER_MAX;
  return Math.max(1, Math.min(Math.floor(n), ANSWER_HARD_MAX));
}

function isBlank(v: string): boolean {
  return v.trim() === '';
}

/** True when a preset row belongs in the Answered group. */
export function isAnsweredPreset(q: PresetQuestionRow, drafting: ReadonlySet<string>): boolean {
  if (drafting.has(q.promptId)) return false;
  return q.id !== null || !isBlank(q.answer);
}

/**
 * Split the questions into the section's three groups.
 * `drafting` = prompt ids opened from the Unanswered group and not yet closed.
 * `undo` = `state.undo.questions`, if any.
 */
export function groupQuestions(
  questions: readonly QuestionRow[],
  presets: readonly PresetPrompt[],
  drafting: ReadonlySet<string>,
  undo?: UndoEntry,
): QuestionGroups {
  const answered: PresetQuestionRow[] = [];
  const custom: CustomQuestionRow[] = [];
  const presetRowById = new Map<string, PresetQuestionRow>();
  for (const q of questions) {
    if (q.kind === 'custom') {
      custom.push(q);
      continue;
    }
    if (!presetRowById.has(q.promptId)) presetRowById.set(q.promptId, q);
    if (isAnsweredPreset(q, drafting)) answered.push(q);
  }

  const answeredIds = new Set(answered.map((q) => q.promptId));
  const undoPromptId =
    undo !== undefined && undo.listKey === 'questions' && undo.row.kind === 'preset' ? undo.row.promptId : null;

  const ordered = presets
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const sa = a.p.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const sb = b.p.sortOrder ?? Number.MAX_SAFE_INTEGER;
      return sa !== sb ? sa - sb : a.i - b.i;
    })
    .map(({ p }) => p);

  const unanswered: UnansweredPreset[] = [];
  const seen = new Set<string>();
  for (const p of ordered) {
    if (seen.has(p.id) || answeredIds.has(p.id) || p.id === undoPromptId) continue;
    seen.add(p.id);
    unanswered.push({ preset: p, row: presetRowById.get(p.id) ?? null });
  }

  return { answered, unanswered, custom };
}

/**
 * Where the pending undo row goes: which group, and its position in that
 * group (the number of that group's rows that came before it in
 * `questions`). Null when there is no question undo.
 */
export function questionUndoSlot(
  questions: readonly QuestionRow[],
  drafting: ReadonlySet<string>,
  undo?: UndoEntry,
): { group: 'answered' | 'custom'; position: number } | null {
  if (undo === undefined || undo.listKey !== 'questions') return null;
  const before = questions.slice(0, Math.max(0, undo.index));
  if (undo.row.kind === 'custom') {
    return { group: 'custom', position: before.filter((q) => q.kind === 'custom').length };
  }
  return {
    group: 'answered',
    position: before.filter((q) => q.kind === 'preset' && isAnsweredPreset(q, drafting)).length,
  };
}

/** Whether a custom question at `index` of `count` can move up / down. */
export function customMoveState(index: number, count: number): { canMoveUp: boolean; canMoveDown: boolean } {
  return { canMoveUp: index > 0 && index < count, canMoveDown: index >= 0 && index < count - 1 };
}
