/**
 * KAN-486 — parseMemberUrl: http/https only, ≤ 2,048, rejected rather than cut
 * (spec v0.8 §3). Messages are literals.
 */
import { parseMemberUrl } from '@/modules/profile/member-url';

const SCHEME = 'Invalid URL — must start with http:// or https://';
const TOO_LONG = 'That link is too long (limit 2,048 characters).';
const CREDS = "Links can't include a username or password.";
const INVALID = "That link doesn't look right. Please check it and try again.";

describe('KAN-486 parseMemberUrl — accepted', () => {
  test.each([
    ['https://example.com/a', 'https://example.com/a'],
    ['http://example.com', 'http://example.com/'],
    ['HTTPS://EXAMPLE.COM/A', 'https://example.com/A'],
    ['  https://example.com/x?y=1  ', 'https://example.com/x?y=1'],
  ])('%s → %s', (input, out) => {
    expect(parseMemberUrl(input)).toEqual({ ok: true, url: out });
  });
});

describe('KAN-486 parseMemberUrl — rejected', () => {
  test.each([
    ['example.com', SCHEME],
    ['www.example.com', SCHEME],
    ['//evil.com', SCHEME],
    ['http:example.com', SCHEME],
    ['javascript:alert(1)', SCHEME],
    ['JAVASCRIPT:alert(1)', SCHEME],
    ['vbscript:x', SCHEME],
    ['data:text/html,<script>1</script>', SCHEME],
    ['mailto:a@b.com', SCHEME],
    ['ftp://example.com', SCHEME],
    ['http://exa\nmple.com', INVALID],
    ['java\tscript:alert(1)', INVALID],
    ['http://user:pw@example.com', CREDS],
    ['http://user@example.com', CREDS],
    ['', INVALID],
  ])('%j → %s', (input, error) => {
    expect(parseMemberUrl(input)).toEqual({ ok: false, error });
  });

  test('over 2,048 characters is rejected, not truncated', () => {
    const long = `https://e.com/${'a'.repeat(2048)}`;
    expect(parseMemberUrl(long)).toEqual({ ok: false, error: TOO_LONG });
  });

  test('the limit applies to what the member typed, even if parsing would shorten it', () => {
    // ":443" is dropped by URL normalisation, so the parsed form is 4 shorter
    // than the input; the browser counter shows the typed length.
    const prefix = 'https://e.com:443/';
    const typed = prefix + 'a'.repeat(2049 - prefix.length);
    expect(typed.length).toBe(2049);
    expect(parseMemberUrl(typed)).toEqual({ ok: false, error: TOO_LONG });
  });

  test('exactly 2,048 characters is accepted', () => {
    const prefix = 'https://e.com/';
    const exact = prefix + 'a'.repeat(2048 - prefix.length);
    expect(exact.length).toBe(2048);
    expect(parseMemberUrl(exact)).toEqual({ ok: true, url: exact });
  });
});
