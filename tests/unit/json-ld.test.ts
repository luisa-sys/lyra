/**
 * SEC-08 (TDD 2026-06-21): jsonLdSafe must escape characters that could break out
 * of a <script type="application/ld+json"> block, so user-controlled profile
 * fields cannot inject markup even though JSON.stringify alone does not escape `<`.
 */
import { jsonLdSafe } from '@/lib/json-ld';

describe('jsonLdSafe (SEC-08)', () => {
  test('neutralises a </script> breakout attempt in a string value', () => {
    const out = jsonLdSafe({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('\\u003c');
  });

  test('escapes < > & and the unicode line/paragraph separators', () => {
    const out = jsonLdSafe({ a: '<', b: '>', c: '&', d: '\u2028', e: '\u2029' });
    expect(out).not.toMatch(/[<>&]/);
    expect(out).toContain('\\u003c');
    expect(out).toContain('\\u003e');
    expect(out).toContain('\\u0026');
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
  });

  test('output is still valid JSON that parses back to the original object', () => {
    const obj = { '@type': 'Person', name: 'Alice <3 & Bob', city: 'Paris' };
    expect(JSON.parse(jsonLdSafe(obj))).toEqual(obj);
  });
});
