/**
 * KAN-487 — §09 "Random Questions & Answers" grouping (spec v0.8 §09 and
 * "Configurable question bank"; plan §C row 09). Expected values are
 * literals from the spec / plan.
 */
import {
  customMoveState,
  groupQuestions,
  presetAnswerLimit,
  questionUndoSlot,
} from '@/modules/profile/editor/question-sections';
import type {
  CustomQuestionRow,
  PresetPrompt,
  PresetQuestionRow,
  QuestionRow,
  UndoEntry,
} from '@/modules/profile/editor/editor-state';

function preset(id: string, prompt: string, answerMax: number | null, sortOrder: number | null): PresetPrompt {
  return { id, prompt, answerMax, sortOrder };
}

function answer(
  key: string,
  promptId: string,
  text: string,
  opts: { id?: string | null; prompt?: string; isActive?: boolean } = {},
): PresetQuestionRow {
  return {
    kind: 'preset',
    key,
    id: opts.id === undefined ? key : opts.id,
    promptId,
    prompt: opts.prompt ?? `Prompt ${promptId}`,
    answerMax: 350,
    answer: text,
    isActive: opts.isActive ?? true,
  };
}

function custom(key: string, customPrompt: string, text: string, sortOrder: number): CustomQuestionRow {
  return { kind: 'custom', key, id: key, customPrompt, answer: text, sortOrder, createdAt: null };
}

const NONE: ReadonlySet<string> = new Set();

const PRESETS: PresetPrompt[] = [
  preset('p-dinner', 'Who you’d invite for a dinner party, dead or alive?', 350, 1),
  preset('p-b', 'Second question', 200, 2),
  preset('p-c', 'Third question', null, 3),
];

describe('KAN-487 presetAnswerLimit — each preset’s own limit, nothing hard-coded', () => {
  test('uses the preset’s answer max (spec table: dinner party = 350)', () => {
    expect(presetAnswerLimit(350)).toBe(350);
  });

  test('a different configured limit is used as-is', () => {
    expect(presetAnswerLimit(120)).toBe(120);
  });

  test('unknown limit falls back to the DB default of 500', () => {
    expect(presetAnswerLimit(null)).toBe(500);
    expect(presetAnswerLimit(undefined)).toBe(500);
  });

  test('clamped to the table ceiling of 2000', () => {
    expect(presetAnswerLimit(5000)).toBe(2000);
  });
});

describe('KAN-487 groupQuestions — Answered', () => {
  test('includes answers to deactivated presets, with the stored wording', () => {
    const old = answer('a-old', 'p-retired', 'My answer', { prompt: 'Original wording', isActive: false });
    const g = groupQuestions([old], PRESETS, NONE);
    expect(g.answered.map((q) => [q.key, q.prompt])).toEqual([['a-old', 'Original wording']]);
  });

  test('a deactivated preset is never offered as unanswered', () => {
    const g = groupQuestions([], PRESETS, NONE);
    expect(g.unanswered.map((u) => u.preset.id)).toEqual(['p-dinner', 'p-b', 'p-c']);
    expect(g.unanswered.map((u) => u.preset.id)).not.toContain('p-retired');
  });

  test('a stored answer cleared to blank stays in Answered (so it can be retyped)', () => {
    const g = groupQuestions([answer('a1', 'p-b', '', { id: 'db-1' })], PRESETS, NONE);
    expect(g.answered.map((q) => q.key)).toEqual(['a1']);
    expect(g.unanswered.map((u) => u.preset.id)).toEqual(['p-dinner', 'p-c']);
  });

  test('a new blank answer row is not answered: the preset stays offered', () => {
    const g = groupQuestions([answer('new:1', 'p-b', '', { id: null })], PRESETS, NONE);
    expect(g.answered).toEqual([]);
    expect(g.unanswered.map((u) => u.preset.id)).toEqual(['p-dinner', 'p-b', 'p-c']);
    expect(g.unanswered[1].row?.key).toBe('new:1');
  });

  test('an answer still being drafted stays in Unanswered with its row', () => {
    const row = answer('new:2', 'p-c', 'Half typed', { id: null });
    const g = groupQuestions([row], PRESETS, new Set(['p-c']));
    expect(g.answered).toEqual([]);
    expect(g.unanswered.map((u) => [u.preset.id, u.row?.answer ?? null])).toEqual([
      ['p-dinner', null],
      ['p-b', null],
      ['p-c', 'Half typed'],
    ]);
  });

  test('once drafting ends, a typed answer moves to Answered', () => {
    const row = answer('new:2', 'p-c', 'Done typing', { id: null });
    const g = groupQuestions([row], PRESETS, NONE);
    expect(g.answered.map((q) => q.key)).toEqual(['new:2']);
    expect(g.unanswered.map((u) => u.preset.id)).toEqual(['p-dinner', 'p-b']);
  });
});

describe('KAN-487 groupQuestions — Unanswered order', () => {
  test('active presets in display order (sort_order), not load order', () => {
    const shuffled = [preset('z', 'Z', 100, 3), preset('x', 'X', 100, 1), preset('y', 'Y', 100, 2)];
    expect(groupQuestions([], shuffled, NONE).unanswered.map((u) => u.preset.id)).toEqual(['x', 'y', 'z']);
  });

  test('ties keep load order; a missing sort order goes last', () => {
    const list = [preset('n', 'N', 100, null), preset('b', 'B', 100, 5), preset('a', 'A', 100, 5)];
    expect(groupQuestions([], list, NONE).unanswered.map((u) => u.preset.id)).toEqual(['b', 'a', 'n']);
  });

  test('12 or 18 active presets give 12 or 18 offered (no hard-coded count)', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => preset(`p${i}`, `Q${i}`, 300, i));
    expect(groupQuestions([], many(12), NONE).unanswered).toHaveLength(12);
    expect(groupQuestions([], many(18), NONE).unanswered).toHaveLength(18);
  });

  test('a preset whose removed answer can still be undone is not offered (no duplicate answers)', () => {
    const removed = answer('a1', 'p-b', 'Gone for now');
    const undo: UndoEntry = { listKey: 'questions', row: removed, index: 0, at: 1 };
    const g = groupQuestions([], PRESETS, NONE, undo);
    expect(g.unanswered.map((u) => u.preset.id)).toEqual(['p-dinner', 'p-c']);
  });

  test('a removed custom question does not hide any preset', () => {
    const undo: UndoEntry = { listKey: 'questions', row: custom('c1', 'Mine?', 'Yes', 0), index: 0, at: 1 };
    expect(groupQuestions([], PRESETS, NONE, undo).unanswered).toHaveLength(3);
  });
});

describe('KAN-487 groupQuestions — Your own questions', () => {
  test('custom questions in their display order, separate from presets', () => {
    const qs: QuestionRow[] = [answer('a1', 'p-b', 'Yes'), custom('c1', 'First?', 'One', 0), custom('c2', 'Second?', 'Two', 1)];
    const g = groupQuestions(qs, PRESETS, NONE);
    expect(g.custom.map((q) => q.key)).toEqual(['c1', 'c2']);
    expect(g.answered.map((q) => q.key)).toEqual(['a1']);
  });
});

describe('KAN-487 questionUndoSlot — the undo row stays where the row was', () => {
  const qs: QuestionRow[] = [
    answer('a1', 'p-dinner', 'One'),
    answer('a2', 'p-b', 'Two'),
    custom('c1', 'First?', 'x', 0),
    custom('c2', 'Second?', 'y', 1),
  ];

  test('no undo → null', () => {
    expect(questionUndoSlot(qs, NONE, undefined)).toBeNull();
  });

  test('a removed preset answer goes back into Answered at its position', () => {
    const undo: UndoEntry = { listKey: 'questions', row: answer('a3', 'p-c', 'Three'), index: 1, at: 1 };
    expect(questionUndoSlot(qs, NONE, undo)).toEqual({ group: 'answered', position: 1 });
  });

  test('a removed custom question goes back into Your own questions at its position', () => {
    const undo: UndoEntry = { listKey: 'questions', row: custom('c9', 'Gone?', 'z', 1), index: 3, at: 1 };
    expect(questionUndoSlot(qs, NONE, undo)).toEqual({ group: 'custom', position: 1 });
  });

  test('a drafted (not yet answered) preset before it does not count', () => {
    const withDraft: QuestionRow[] = [answer('new:d', 'p-dinner', 'drafting', { id: null }), ...qs.slice(1)];
    const undo: UndoEntry = { listKey: 'questions', row: answer('a3', 'p-c', 'Three'), index: 2, at: 1 };
    expect(questionUndoSlot(withDraft, new Set(['p-dinner']), undo)).toEqual({ group: 'answered', position: 1 });
  });
});

describe('KAN-487 customMoveState — Move up / Move down disabled at the ends', () => {
  test('first of three: only down', () => {
    expect(customMoveState(0, 3)).toEqual({ canMoveUp: false, canMoveDown: true });
  });

  test('middle of three: both', () => {
    expect(customMoveState(1, 3)).toEqual({ canMoveUp: true, canMoveDown: true });
  });

  test('last of three: only up', () => {
    expect(customMoveState(2, 3)).toEqual({ canMoveUp: true, canMoveDown: false });
  });

  test('a single question cannot move', () => {
    expect(customMoveState(0, 1)).toEqual({ canMoveUp: false, canMoveDown: false });
  });
});
