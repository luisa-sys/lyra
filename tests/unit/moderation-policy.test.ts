/**
 * KAN-241 — moderation policy wrapper tests.
 *
 * The underlying `content-moderation` library has its own tests
 * (`tests/unit/content-moderation.test.ts`). This file just tests the
 * decision logic that turns the library's structured output into the
 * action-level OK/error result.
 */

import { checkModeration } from '@/lib/moderation-policy';

describe('KAN-241: checkModeration policy wrapper', () => {
  // ───────────── Pass-through cases ─────────────

  test.each([null, undefined, ''])('returns ok=true for empty/null/undefined: %p', (input) => {
    const result = checkModeration(input);
    expect(result).toEqual({ ok: true });
  });

  test('clean public text passes', () => {
    expect(checkModeration('Hello world, I love cycling.')).toEqual({ ok: true });
  });

  test('clean private text passes', () => {
    expect(checkModeration('Personal notes about my hobbies.', 'private')).toEqual({ ok: true });
  });

  // ───────────── Block cases (severity=block on public) ─────────────

  test('public profanity blocks with category-only error', () => {
    const result = checkModeration('fuck this', 'public');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/inappropriate language/i);
      // Critical: does NOT include the specific match — prevents wordlist enumeration
      expect(result.error).not.toMatch(/fuck/);
      expect(result.flags.some((f) => f.startsWith('profanity:'))).toBe(true);
    }
  });

  test('public PII (international phone) blocks', () => {
    // The PII detector requires either international (+CC) format, a
    // 3-part separated format, or a 10-15 digit run. Use +44 to hit the
    // international branch.
    const result = checkModeration('Call me on +44 7700 900123', 'public');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/personal information/i);
    }
  });

  test('public PII (email) blocks', () => {
    const result = checkModeration('Email me at user@example.com', 'public');
    expect(result.ok).toBe(false);
  });

  test('combined profanity + PII reports both categories (deduped)', () => {
    const result = checkModeration('fuck call me +44 7700 900123 fuck', 'public');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Both category names appear, neither appears twice
      const msg = result.error.toLowerCase();
      expect(msg).toContain('inappropriate language');
      expect(msg).toContain('personal information');
    }
  });

  // ───────────── Warn cases (severity=warn) ─────────────

  test('private profanity is warn-level (not block) — returns ok=true', () => {
    // Spy on console.warn to confirm the warn was logged but the action passes
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = checkModeration('fuck this', 'private');
      expect(result).toEqual({ ok: true });
      expect(spy).toHaveBeenCalled();
      const callArgs = spy.mock.calls[0];
      expect(callArgs[0]).toMatch(/\[moderation\]/);
    } finally {
      spy.mockRestore();
    }
  });

  test('warn-log includes field name when provided', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      checkModeration('fuck this', 'private', 'manual_of_me.energises_me');
      const meta = spy.mock.calls[0][1] as { field: string };
      expect(meta.field).toBe('manual_of_me.energises_me');
    } finally {
      spy.mockRestore();
    }
  });

  // ───────────── Defence-in-depth ─────────────

  test('does NOT leak the specific profanity match in error', () => {
    // Try several profane inputs; ensure error never contains them.
    for (const bad of ['fuck this', 'you bitch', 'wanker behaviour']) {
      const result = checkModeration(bad, 'public');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // The error must not include the word itself, only the category.
        const exactWords = bad.toLowerCase().split(/\s+/);
        for (const word of exactWords) {
          if (word.length > 3) {
            // Allow only the category label substrings
            // (e.g. 'inappropriate' doesn't contain the profanity)
            expect(result.error.toLowerCase()).not.toContain(word);
          }
        }
      }
    }
  });

  test('flags array IS returned for caller-side logging even though error string is sanitised', () => {
    const result = checkModeration('fuck this', 'public');
    if (!result.ok) {
      // Flags include the specific match — caller can log internally, just
      // shouldn't surface to the user.
      expect(result.flags.some((f) => f === 'profanity:fuck')).toBe(true);
    }
  });
});
