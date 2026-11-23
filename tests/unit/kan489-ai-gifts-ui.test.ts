/**
 * KAN-489 — the editor slot's pure decisions and copy
 * (src/modules/profile/editor/ai-gifts-ui.ts). Literals throughout.
 */
import {
  AI_CONSENT_COPY,
  aiCapReached,
  aiCounterText,
  aiGenerateDisabled,
  aiRemainingAfter,
  aiResultMessage,
} from '@/modules/profile/editor/ai-gifts-ui';
import { AI_CONSENT_VERSION, type GenerateResult } from '@/modules/profile/ai-gifts/types';

function ok(inserted: number, droppedForCap = 0, droppedByFilter = 0): GenerateResult {
  return {
    ok: true,
    inserted: Array.from({ length: inserted }, (_, i) => ({ id: `${i}`, title: `T${i}`, description: null })),
    droppedForCap,
    droppedByFilter,
    sessionRemaining: 2,
    dailyRemaining: 9,
  };
}

describe('aiCounterText', () => {
  it('"n of 5 left this session", clamped to 0..5', () => {
    expect(aiCounterText(5)).toBe('5 of 5 left this session');
    expect(aiCounterText(0)).toBe('0 of 5 left this session');
    expect(aiCounterText(-2)).toBe('0 of 5 left this session');
    expect(aiCounterText(9)).toBe('5 of 5 left this session');
  });
});

describe('aiGenerateDisabled', () => {
  const on = { readOnly: false, pending: false, sessionRemaining: 1, retained: 9 };
  it('enabled with 1 left and 9 held', () => {
    expect(aiGenerateDisabled(on)).toBe(false);
  });
  it.each([
    ['read-only', { ...on, readOnly: true }],
    ['a request running', { ...on, pending: true }],
    ['0 left', { ...on, sessionRemaining: 0 }],
    ['10 held', { ...on, retained: 10 }],
    ['11 held', { ...on, retained: 11 }],
  ])('disabled when %s', (_l, s) => {
    expect(aiGenerateDisabled(s)).toBe(true);
  });
  it('aiCapReached at 10, not at 9', () => {
    expect(aiCapReached(10)).toBe(true);
    expect(aiCapReached(9)).toBe(false);
  });
});

describe('aiResultMessage', () => {
  it.each<[GenerateResult, string]>([
    [ok(10), 'Added 10 suggestions.'],
    [ok(1), 'Added 1 suggestion.'],
    [ok(7, 3), 'Added 7 suggestions. 3 more didn’t fit: you can keep up to 10. Remove one to make room.'],
    [ok(9, 1), 'Added 9 suggestions. 1 more didn’t fit: you can keep up to 10. Remove one to make room.'],
    [ok(8, 0, 2), 'Added 8 suggestions. Some suggestions were filtered out.'],
    [ok(0, 0, 10), 'Some suggestions were filtered out.'],
    [ok(0), 'Something went wrong, try again later.'],
    [{ ok: false, reason: 'refused' }, 'We couldn’t generate suggestions from this profile.'],
    [{ ok: false, reason: 'busy' }, 'Something went wrong, try again later.'],
    [{ ok: false, reason: 'failed' }, 'Something went wrong, try again later.'],
    [{ ok: false, reason: 'invalid_session' }, 'Something went wrong, try again later.'],
    [{ ok: false, reason: 'no_content' }, 'Add a few things about yourself first.'],
    [{ ok: false, reason: 'cap_full' }, 'Remove a suggestion to generate more'],
    [{ ok: false, reason: 'not_configured' }, 'AI gift suggestions aren’t available yet.'],
    [{ ok: false, reason: 'session_limit' }, 'You’ve used all 5 generations for this session.'],
    [{ ok: false, reason: 'daily_limit' }, 'You’ve reached today’s limit for AI suggestions. Please try again tomorrow.'],
    [{ ok: false, reason: 'cooldown' }, 'Please wait a few seconds before generating again.'],
    [{ ok: false, reason: 'rate_limited' }, 'You’re going a little fast. Please wait a moment and try again.'],
    [{ ok: false, reason: 'unauthenticated' }, 'Please sign in again to generate suggestions.'],
    [{ ok: false, reason: 'consent_required' }, 'Please reload the editor and read the note about AI suggestions first.'],
    [{ ok: false, reason: 'suspended' }, 'AI gift suggestions aren’t available for this account.'],
  ])('%o → %s', (r, msg) => {
    expect(aiResultMessage(r)).toBe(msg);
  });
});

describe('aiRemainingAfter', () => {
  it('takes the server figure when there is one, else keeps the previous', () => {
    expect(aiRemainingAfter(5, ok(3))).toBe(2);
    expect(aiRemainingAfter(5, { ok: false, reason: 'refused', sessionRemaining: 3 })).toBe(3);
    expect(aiRemainingAfter(4, { ok: false, reason: 'no_content' })).toBe(4);
    expect(aiRemainingAfter(4, { ok: false, reason: 'session_limit' })).toBe(0);
  });

  it('review fix — after a success the counter is the SMALLER of the session and daily allowance', () => {
    const r = (sessionRemaining: number, dailyRemaining: number): GenerateResult => ({
      ok: true,
      inserted: [],
      droppedForCap: 0,
      droppedByFilter: 0,
      sessionRemaining,
      dailyRemaining,
    });
    expect(aiRemainingAfter(5, r(4, 1))).toBe(1);
    expect(aiRemainingAfter(5, r(2, 9))).toBe(2);
  });

  it('review fix — daily_limit sets the counter to 0 even when the session count is higher', () => {
    // Was 3 (the session figure) before the review fix: the counter then
    // promised generations the server would refuse.
    expect(aiRemainingAfter(4, { ok: false, reason: 'daily_limit', sessionRemaining: 3 })).toBe(0);
  });
});

describe('consent copy (founder-approved 2026-11-23)', () => {
  it('the copy below is consent version v1-2026-11-23 (bump the version when the copy changes)', () => {
    expect(AI_CONSENT_VERSION).toBe('v1-2026-11-23');
  });

  it('names what is shared, what is not, the provider, and that nothing is public until approved', () => {
    expect(AI_CONSENT_COPY).toBe(
      'When on, Lyra sends the text you’ve written on this profile (not your name, location, photo or affiliations) to our AI provider, Anthropic, to suggest gift ideas. Nothing is shown publicly until you approve it.',
    );
  });
});
