/**
 * KAN-484 — pure rules for the admin question bank and per-question answer
 * limits (spec v0.8 §09).
 */

import {
  validateQuestionInput,
  nextSortOrder,
  swapForMove,
  cleanPromptText,
} from '@/modules/admin/question-bank';
import { answerLimitFor } from '@/app/dashboard/profile/conversation-starters-fields';

describe('validateQuestionInput', () => {
  it('accepts a normal question and limit', () => {
    expect(validateQuestionInput('  What is your  favourite tea? ', '350')).toEqual({
      ok: true,
      value: { prompt: 'What is your favourite tea?', answerMax: 350 },
    });
  });

  it('rejects an empty question', () => {
    expect(validateQuestionInput('   ', 300).ok).toBe(false);
  });

  it('rejects a question over 300 characters rather than truncating it', () => {
    const res = validateQuestionInput('q'.repeat(301), 300);
    expect(res.ok).toBe(false);
  });

  it.each([49, 2001, 0, -5, 12.5, 'abc', ''])('rejects answer limit %p', (bad) => {
    expect(validateQuestionInput('A fine question?', bad).ok).toBe(false);
  });

  it.each([50, 2000])('accepts boundary limit %p', (ok) => {
    expect(validateQuestionInput('A fine question?', ok).ok).toBe(true);
  });

  it('rejects markup in the wording instead of stripping it', () => {
    expect(validateQuestionInput('What <b>really</b> matters?', 300).ok).toBe(false);
    expect(validateQuestionInput('Is 3 > 2?', 300).ok).toBe(false);
  });

  it('collapses whitespace in the wording', () => {
    expect(cleanPromptText('  What   really\n matters? ')).toBe('What really matters?');
  });
});

describe('nextSortOrder', () => {
  it('places a new question after every existing one', () => {
    expect(nextSortOrder([{ id: 'a', sort_order: 10 }, { id: 'b', sort_order: 160 }])).toBe(170);
  });
  it('starts at 10 for an empty bank', () => {
    expect(nextSortOrder([])).toBe(10);
  });
});

describe('swapForMove', () => {
  const rows = [
    { id: 'a', sort_order: 10 },
    { id: 'b', sort_order: 20 },
    { id: 'c', sort_order: 30 },
  ];

  it('swaps sort_order with the neighbour above', () => {
    expect(swapForMove(rows, 'b', 'up')).toEqual([
      { id: 'b', sort_order: 10 },
      { id: 'a', sort_order: 20 },
    ]);
  });

  it('swaps sort_order with the neighbour below', () => {
    expect(swapForMove(rows, 'b', 'down')).toEqual([
      { id: 'b', sort_order: 30 },
      { id: 'c', sort_order: 20 },
    ]);
  });

  it('is a no-op at either end', () => {
    expect(swapForMove(rows, 'a', 'up')).toBeNull();
    expect(swapForMove(rows, 'c', 'down')).toBeNull();
  });

  it('never changes an id — only sort_order — so answers cannot be reassigned', () => {
    const swap = swapForMove(rows, 'c', 'up');
    expect(swap?.map((s) => s.id).sort()).toEqual(['b', 'c']);
  });

  it('still moves when two questions share a sort_order', () => {
    const tied = [{ id: 'a', sort_order: 10 }, { id: 'b', sort_order: 10 }];
    const swap = swapForMove(tied, 'b', 'up');
    expect(swap).not.toBeNull();
    const [moved, other] = swap!;
    expect(moved.sort_order).toBeLessThan(other.sort_order);
  });
});

describe('answerLimitFor', () => {
  it('uses the preset’s own limit', () => {
    expect(answerLimitFor(200, false)).toBe(200);
    expect(answerLimitFor(1000, false)).toBe(1000);
  });
  it('uses 500 for a member-written question regardless of any limit passed', () => {
    expect(answerLimitFor(1000, true)).toBe(500);
  });
  it('falls back to 500 when a preset has no limit (pre-migration database)', () => {
    expect(answerLimitFor(null, false)).toBe(500);
    expect(answerLimitFor(undefined, false)).toBe(500);
  });
  it('never exceeds the 2000-character table ceiling', () => {
    expect(answerLimitFor(5000, false)).toBe(2000);
  });
});
