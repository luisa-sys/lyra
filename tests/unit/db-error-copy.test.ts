/**
 * BUGS-87 — the shared database-error mapper.
 *
 * The load-bearing test here is "does NOT collide with the file cap". The
 * obvious implementation of this module — lift `capErrorCopy` out of
 * conversation-starters-actions.ts verbatim — passes every other assertion in
 * this file and still ships a real bug, because that function matches
 * `/limit \(\d+\) reached/` anywhere in the message and
 * `Profile file limit (10) reached` satisfies it.
 *
 * A member who exceeded the ten-FILE upload cap would have been told
 * "You can answer up to 10 prompts." It would have landed invisibly, because
 * the file-upload result is discarded at the call site today — so no screen
 * and no other test exercises it — and surfaced later with no code change at
 * all, the moment file errors get wired to the UI.
 */
import {
  memberFacingDbError,
  dbErrorFor,
  GENERIC_DB_ERROR,
} from '@/lib/db-error-copy';

jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Sentry = require('@sentry/nextjs');

/** Quoted verbatim from the migrations that raise them. */
const TRIGGER_MESSAGES = {
  customQuestion: 'Custom question limit (3) reached',
  answers10: 'Conversation-starter answer limit (10) reached',
  answers5: 'Conversation-starter answer limit (5) reached',
  files: 'Profile file limit (10) reached',
};

beforeEach(() => jest.clearAllMocks());

describe('BUGS-87: memberFacingDbError', () => {
  it('maps the custom-question cap to its own copy', () => {
    expect(memberFacingDbError({ message: TRIGGER_MESSAGES.customQuestion })).toMatch(
      /up to 3 of your own questions/,
    );
  });

  it('maps both answer-cap variants to the answers copy', () => {
    for (const m of [TRIGGER_MESSAGES.answers10, TRIGGER_MESSAGES.answers5]) {
      expect(memberFacingDbError({ message: m })).toMatch(/answer up to 10 prompts/);
    }
  });

  it('does NOT collide the FILE cap with the prompt cap', () => {
    // The whole reason the matchers are anchored per-trigger instead of the
    // generic /limit \(\d+\) reached/ the old mapper used.
    const copy = memberFacingDbError({ message: TRIGGER_MESSAGES.files });
    expect(copy).toMatch(/upload up to 10 files/);
    expect(copy).not.toMatch(/prompts/);
    expect(copy).not.toMatch(/questions/);
  });

  it('proves the naive implementation WOULD have collided', () => {
    // Pins the reason this module is not a verbatim lift. If someone later
    // "simplifies" the matchers back to the generic pattern, the assertion
    // above breaks — and this one explains why.
    const naive = /limit \(\d+\) reached/;
    expect(naive.test(TRIGGER_MESSAGES.files)).toBe(true);
    expect(naive.test(TRIGGER_MESSAGES.customQuestion)).toBe(true);
  });

  it('keeps the custom-question cap ahead of the answer cap', () => {
    // Ordering was documented as load-bearing in the original mapper: a member
    // who filled their three own questions must not be told to remove one of
    // their ten answers.
    expect(memberFacingDbError({ message: TRIGGER_MESSAGES.customQuestion })).not.toMatch(
      /answer up to 10 prompts/,
    );
  });

  it('maps 23505 to the already-answered copy', () => {
    expect(memberFacingDbError({ message: 'duplicate key value', code: '23505' })).toMatch(
      /already answered this prompt/,
    );
  });

  it('returns the generic sentence for anything unrecognised', () => {
    for (const m of [
      'relation "public.gift_suggestion_dismissals" does not exist',
      'new row for relation "profile_conversation_starters" violates check constraint "pcs_prompt_source_xor"',
      'permission denied for table profiles',
    ]) {
      expect(memberFacingDbError({ message: m })).toBe(GENERIC_DB_ERROR);
    }
  });

  it('never leaks internal vocabulary in the generic copy', () => {
    // The specific strings BUGS-87 is about.
    expect(GENERIC_DB_ERROR).not.toMatch(/relation|constraint|pcs_|public\.|permission denied/i);
  });

  it('handles null/undefined/empty without throwing', () => {
    expect(memberFacingDbError(null)).toBe(GENERIC_DB_ERROR);
    expect(memberFacingDbError(undefined)).toBe(GENERIC_DB_ERROR);
    expect(memberFacingDbError({})).toBe(GENERIC_DB_ERROR);
    expect(memberFacingDbError({ message: null, code: null })).toBe(GENERIC_DB_ERROR);
  });
});

describe('BUGS-87: dbErrorFor also preserves the diagnostic', () => {
  it('reports the REAL error to Sentry when the copy is generic', () => {
    // Removing error.message from the return value without this is a net loss:
    // these files had no logging at all, so the leaked string was the only
    // record the failure ever happened.
    const raw = 'relation "public.gift_suggestion_dismissals" does not exist';
    const copy = dbErrorFor('gift-dismissals', { message: raw, code: '42P01' });

    expect(copy).toBe(GENERIC_DB_ERROR);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);

    const [err, ctx] = Sentry.captureException.mock.calls[0];
    expect(err.message).toContain(raw);
    expect(err.message).toContain('gift-dismissals');
    expect(ctx.tags).toMatchObject({ area: 'gift-dismissals', ticket: 'BUGS-87' });
    expect(ctx.extra).toMatchObject({ code: '42P01' });
  });

  it('does NOT page on a recognised cap — that is the product working', () => {
    const copy = dbErrorFor('conversation-starters', {
      message: TRIGGER_MESSAGES.customQuestion,
    });
    expect(copy).toMatch(/up to 3 of your own questions/);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('does not report when there is no error at all', () => {
    expect(dbErrorFor('anything', null)).toBe(GENERIC_DB_ERROR);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
