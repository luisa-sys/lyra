/**
 * KAN-486 — validateFreeText: limits are ENFORCED (rejected), never cut, and
 * multiline fields keep their line breaks (spec v0.8 §3, §10 billboard).
 * Expected messages are literals.
 */
import { validateFreeText, countChars } from '@/modules/profile/free-text';

const BIO = { label: 'Short intro', max: 500, multiline: true } as const;

describe('KAN-486 validateFreeText — line breaks', () => {
  test('multiline keeps breaks, normalises CRLF and caps blank runs at one', () => {
    expect(validateFreeText('a\r\nb\n\n\n\nc', BIO)).toEqual({ ok: true, value: 'a\nb\n\nc' });
  });

  test('multiline trims each line and collapses spaces within a line', () => {
    expect(validateFreeText('  hello    world  \n  second\tline ', BIO)).toEqual({
      ok: true,
      value: 'hello world\nsecond line',
    });
  });

  test('single-line collapses breaks to spaces', () => {
    expect(validateFreeText('a\r\nb\n\nc', { label: 'Headline', max: 100 })).toEqual({ ok: true, value: 'a b c' });
  });
});

describe('KAN-486 validateFreeText — limits', () => {
  test('exactly at the limit is accepted, whole', () => {
    const r = validateFreeText('a'.repeat(500), BIO);
    expect(r).toEqual({ ok: true, value: 'a'.repeat(500) });
  });

  test('one over the limit is rejected with the exact message, not truncated', () => {
    expect(validateFreeText('a'.repeat(501), BIO)).toEqual({
      ok: false,
      error: 'Short intro is too long: 501 characters (limit 500, including spaces).',
    });
  });

  test('a line break counts as one character', () => {
    const text = `${'a'.repeat(250)}\n${'b'.repeat(249)}`; // 500 code points
    expect(validateFreeText(text, BIO)).toEqual({ ok: true, value: text });
    expect(validateFreeText(`${text}b`, BIO).ok).toBe(false);
  });

  test('emoji count as one character each (code points, like Postgres length())', () => {
    expect(countChars('😀😀')).toBe(2);
    expect(validateFreeText('😀'.repeat(500), BIO).ok).toBe(true);
    expect(validateFreeText('😀'.repeat(501), BIO).ok).toBe(false);
  });
});

describe('KAN-486 validateFreeText — content', () => {
  test('HTML tags are stripped', () => {
    expect(validateFreeText('<b>hi</b> there', BIO)).toEqual({ ok: true, value: 'hi there' });
  });

  test('empty / whitespace / null become null when optional', () => {
    expect(validateFreeText('   \n  ', BIO)).toEqual({ ok: true, value: null });
    expect(validateFreeText(null, BIO)).toEqual({ ok: true, value: null });
    expect(validateFreeText(undefined, BIO)).toEqual({ ok: true, value: null });
  });

  test('empty is an error when required', () => {
    expect(validateFreeText(' ', { label: 'Title', max: 100, required: true })).toEqual({
      ok: false,
      error: 'Title is required.',
    });
  });

  test('contact details are rejected with the exact correction message', () => {
    expect(validateFreeText('Ring 07700 900123', { label: 'My boundaries', max: 500, multiline: true })).toEqual({
      ok: false,
      error:
        'My boundaries: please remove personal information such as contact details (email, phone number or postal address). Your profile is public.',
    });
  });

  test("'places' allows an address but not a phone; 'off' allows both", () => {
    expect(validateFreeText('12 High Street', { label: 'City', max: 80, contact: 'places' }).ok).toBe(true);
    expect(validateFreeText('07700 900123', { label: 'City', max: 80, contact: 'places' }).ok).toBe(false);
    expect(validateFreeText('07700 900123', { label: 'X', max: 80, contact: 'off' }).ok).toBe(true);
  });
});
