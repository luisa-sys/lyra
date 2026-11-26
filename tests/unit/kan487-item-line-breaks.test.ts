/**
 * KAN-487 PR2 review Major 4 — line breaks in item text (founder decision
 * 2026-11-23): item DESCRIPTIONS (every category) and the QUOTE text are
 * multiline and keep their line breaks; every other item title is one line
 * (whitespace collapsed). The edit path's null-category ceiling keeps titles
 * single-line. Expected values are literals.
 */
import {
  itemTitleIsMultiline,
  validateItemDescription,
  validateItemTitle,
} from '@/modules/profile/field-validation';

describe('KAN-487 item descriptions keep line breaks (every category)', () => {
  const categories = ['gift_ideas', 'gifts_to_avoid', 'life_hacks', 'current_problems', 'quotes', 'favourite_books'];

  test('the category corpus is non-empty', () => {
    expect(categories.length).toBeGreaterThan(0);
  });

  test.each(categories)('%s: a description keeps "\\n"', (category) => {
    expect(validateItemDescription(category, 'Line one\nLine two')).toEqual({ ok: true, value: 'Line one\nLine two' });
  });

  test('the edit path (null category) keeps a description’s line break too', () => {
    expect(validateItemDescription(null, 'Line one\nLine two')).toEqual({ ok: true, value: 'Line one\nLine two' });
  });
});

describe('KAN-487 item titles are one line, except a quote', () => {
  test('a non-quote title collapses its line break', () => {
    expect(validateItemTitle('life_hacks', 'Batch\ncook')).toEqual({ ok: true, value: 'Batch cook' });
    expect(validateItemTitle('causes', 'Clean\n\nrivers')).toEqual({ ok: true, value: 'Clean rivers' });
    expect(validateItemTitle('proud_of', 'Ran a\nmarathon')).toEqual({ ok: true, value: 'Ran a marathon' });
  });

  test('a quote keeps its line break', () => {
    expect(validateItemTitle('quotes', 'Be brave.\nBe kind.')).toEqual({ ok: true, value: 'Be brave.\nBe kind.' });
  });

  test('the edit path (null category) keeps titles single-line', () => {
    expect(validateItemTitle(null, 'Be brave.\nBe kind.')).toEqual({ ok: true, value: 'Be brave. Be kind.' });
  });

  test('itemTitleIsMultiline: quotes only', () => {
    expect(itemTitleIsMultiline('quotes')).toBe(true);
    expect(itemTitleIsMultiline('causes')).toBe(false);
    expect(itemTitleIsMultiline('gift_ideas')).toBe(false);
    expect(itemTitleIsMultiline(null)).toBe(false);
  });
});
