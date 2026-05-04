/**
 * KAN-112: Real unit tests for src/lib/sanitise.ts
 *
 * KAN-171 / CodeQL alerts #1 + #3 (2026-04-28):
 *   - File converted from .js → .ts so it imports the real source rather
 *     than running an inline copy. The previous structure had a mirror
 *     `function stripHtml(input)` defined here in the test that drifted
 *     from the real source — meaning a fix in src/lib/sanitise.ts would
 *     never be exercised by these tests. Now we import the real exports.
 *   - Added attack-pattern tests for nested-tag bypass: <scr<script>ipt>
 *     and similar patterns that the previous single-pass regex would have
 *     let through.
 *
 * Tests pure functions — no mocking needed.
 */
import * as fs from 'fs';
import * as path from 'path';
import { stripHtml, sanitiseText, sanitiseUrl } from '@/lib/sanitise';

// ── Source verification ────────────────────────────────
// Light-touch sanity check that the imports resolve to functions and the
// source still defines the named exports. (If the imports above failed,
// jest would already have errored before reaching these tests — but the
// existence checks here mirror the original test's intent.)
describe('sanitise.ts source verification', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/lib/sanitise.ts'),
    'utf8'
  );

  test('source contains stripHtml function', () => {
    expect(source).toContain('function stripHtml');
  });

  test('source contains sanitiseText function', () => {
    expect(source).toContain('function sanitiseText');
  });

  test('source contains sanitiseUrl function', () => {
    expect(source).toContain('function sanitiseUrl');
  });

  test('imported functions are callable', () => {
    expect(typeof stripHtml).toBe('function');
    expect(typeof sanitiseText).toBe('function');
    expect(typeof sanitiseUrl).toBe('function');
  });
});

// ── stripHtml tests ────────────────────────────────────
describe('stripHtml', () => {
  test('strips simple HTML tags', () => {
    expect(stripHtml('<b>bold</b>')).toBe('bold');
  });

  test('strips nested HTML tags', () => {
    expect(stripHtml('<div><span>nested</span></div>')).toBe('nested');
  });

  test('strips script tags (XSS)', () => {
    expect(stripHtml('<script>alert("xss")</script>')).toBe('alert("xss")');
  });

  test('handles empty string', () => {
    expect(stripHtml('')).toBe('');
  });

  test('handles string with no HTML', () => {
    expect(stripHtml('plain text')).toBe('plain text');
  });

  test('strips img tags with src attributes', () => {
    expect(stripHtml('<img src="x" onerror="alert(1)">')).toBe('');
  });

  // ── KAN-171 / CodeQL alerts #1 + #3: nested-tag bypass attacks ──
  test('strips nested-tag bypass attack <scr<script>ipt>', () => {
    // Before the loop-until-stable fix, this would have produced
    // '<script>alert(1)</script>' (the inner tags getting stripped left
    // an outer <script> intact). After the fix, every <…> substring is
    // gone.
    const result = stripHtml('<scr<script>ipt>alert(1)</script>');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('<');
  });

  test('strips interleaved-tag bypass attack <<script>script>', () => {
    const result = stripHtml('<<script>script>alert(1)</<script>script>');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('<');
  });

  test('handles deeply nested malformed input', () => {
    // <<<<>>>> — pathological but bounded. Document the behaviour:
    // every <…> substring is consumed. Stray > characters CAN remain
    // (they are not the XSS vector — < is) so we explicitly check
    // there is no surviving < character.
    const result = stripHtml('<<<<>>>>');
    expect(result).not.toContain('<');
  });

  test('handles tag with embedded angle brackets in attributes', () => {
    // Real-world adjacent: <a href="x>y"> — the inner > closes the tag
    // early and leaves y"> dangling. Loop-until-stable handles this
    // correctly: first pass strips <a href="x>, leaves y">, second pass
    // is stable (no < introducer). y"> is an acceptable post-strip
    // remnant — it's not an XSS vector.
    const result = stripHtml('<a href="x>y">link</a>');
    expect(result).not.toContain('<');
  });
});

// ── sanitiseText tests ─────────────────────────────────
describe('sanitiseText', () => {
  test('truncates text at max length', () => {
    const long = 'a'.repeat(600);
    expect(sanitiseText(long)).toHaveLength(500);
  });

  test('truncates at custom max length', () => {
    expect(sanitiseText('abcdefgh', 5)).toBe('abcde');
  });

  test('strips HTML before truncating', () => {
    expect(sanitiseText('<b>hello</b> world', 5)).toBe('hello');
  });

  test('normalises whitespace', () => {
    expect(sanitiseText('hello    world')).toBe('hello world');
  });

  test('trims leading and trailing whitespace', () => {
    expect(sanitiseText('  hello  ')).toBe('hello');
  });

  test('handles empty string', () => {
    expect(sanitiseText('')).toBe('');
  });

  test('handles unicode characters', () => {
    expect(sanitiseText('café résumé')).toBe('café résumé');
  });

  test('strips XSS payloads', () => {
    const xss = '<script>alert("xss")</script><p>safe content</p>';
    expect(sanitiseText(xss)).toBe('alert("xss")safe content');
  });

  // ── KAN-171 — verify sanitiseText also resists the bypass ──
  test('rejects nested-tag bypass via sanitiseText', () => {
    const result = sanitiseText('<scr<script>ipt>alert(1)</script>');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('<');
  });
});

// ── sanitiseUrl tests ──────────────────────────────────
describe('sanitiseUrl', () => {
  test('accepts valid https URL', () => {
    expect(sanitiseUrl('https://example.com')).toBe('https://example.com/');
  });

  test('accepts valid http URL', () => {
    expect(sanitiseUrl('http://example.com')).toBe('http://example.com/');
  });

  test('rejects javascript: protocol', () => {
    expect(sanitiseUrl('javascript:alert(1)')).toBe('');
  });

  test('rejects data: protocol', () => {
    expect(sanitiseUrl('data:text/html,<h1>hi</h1>')).toBe('');
  });

  test('rejects invalid URL', () => {
    expect(sanitiseUrl('not a url')).toBe('');
  });

  test('trims whitespace', () => {
    expect(sanitiseUrl('  https://example.com  ')).toBe('https://example.com/');
  });

  test('rejects ftp: protocol', () => {
    expect(sanitiseUrl('ftp://files.example.com')).toBe('');
  });

  test('truncates at max length', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(2100);
    expect(sanitiseUrl(longUrl).length).toBeLessThanOrEqual(2048 + 50);
  });

  test('handles empty string', () => {
    expect(sanitiseUrl('')).toBe('');
  });
});
