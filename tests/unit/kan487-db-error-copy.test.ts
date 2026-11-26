/**
 * KAN-487 (spec v0.8 §1/§3, plan §B "Error mapping") — db-error-copy additions.
 *
 * 1. Constraint-aware 23505: a taken CheckLyra ID used to get "You already
 *    answered this prompt" because every unique violation shared one copy.
 * 2. Copy for the three messages `save_profile` raises.
 * 3. `parseSaveErrorDetail` for the jsonb DETAIL `save_profile` re-raises with.
 *
 * Expected strings are literals (approved copy in the KAN-487 brief), never
 * read back from the module under test.
 */
import {
  memberFacingDbError,
  dbErrorFor,
  parseSaveErrorDetail,
  GENERIC_DB_ERROR,
} from '@/modules/profile/db-error-copy';

jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));
const Sentry = require('@sentry/nextjs');

beforeEach(() => jest.clearAllMocks());

const SLUG_TAKEN = 'That CheckLyra ID is already taken.';
const PCS_TAKEN = 'You already answered this prompt — edit your existing answer instead.';

describe('KAN-487: 23505 copy depends on the constraint', () => {
  const slugConstraints = ['profiles_slug_lower_key', 'profiles_slug_key', 'profiles_slug_idx'];

  it('has a non-empty constraint corpus', () => {
    expect(slugConstraints.length).toBe(3);
  });

  it.each(slugConstraints)('%s in the message -> "already taken"', (name) => {
    expect(
      memberFacingDbError({
        code: '23505',
        message: `duplicate key value violates unique constraint "${name}"`,
        details: 'Key (lower(slug))=(alice) already exists.',
      }),
    ).toBe(SLUG_TAKEN);
  });

  it.each(slugConstraints)('%s in details only -> "already taken"', (name) => {
    expect(
      memberFacingDbError({
        code: '23505',
        message: 'duplicate key value',
        details: `constraint "${name}"`,
      }),
    ).toBe(SLUG_TAKEN);
  });

  it('the save_profile re-raise shape (jsonb detail, constraint in message) -> "already taken"', () => {
    expect(
      memberFacingDbError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "profiles_slug_lower_key"',
        details: '{"section": "profile", "client_key": null}',
      }),
    ).toBe(SLUG_TAKEN);
  });

  it('the pcs unique constraint keeps the conversation-starter copy', () => {
    expect(
      memberFacingDbError({
        code: '23505',
        message:
          'duplicate key value violates unique constraint "profile_conversation_starters_profile_id_prompt_id_key"',
        details: 'Key (profile_id, prompt_id)=(a, b) already exists.',
      }),
    ).toBe(PCS_TAKEN);
  });

  it('a 23505 with no constraint name keeps the conversation-starter copy', () => {
    expect(memberFacingDbError({ code: '23505', message: 'duplicate key value' })).toBe(PCS_TAKEN);
  });

  it('a slug constraint name WITHOUT 23505 is not treated as a unique violation', () => {
    expect(
      memberFacingDbError({ code: '42501', message: 'something about profiles_slug_lower_key' }),
    ).toBe(GENERIC_DB_ERROR);
  });

  it('does not match a longer identifier that merely contains the name', () => {
    expect(
      memberFacingDbError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "profiles_slug_lower_key_old"',
      }),
    ).toBe(PCS_TAKEN);
  });

  it('a taken slug is a recognised outcome, not paged to Sentry', () => {
    expect(
      dbErrorFor('save-profile', {
        code: '23505',
        message: 'duplicate key value violates unique constraint "profiles_slug_lower_key"',
      }),
    ).toBe(SLUG_TAKEN);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

describe('KAN-487: save_profile RPC messages', () => {
  const cases: Array<[string, string]> = [
    [
      'Your profile was saved somewhere else. Reload to see the latest version.',
      'Your profile was saved somewhere else. Reload to see the latest version.',
    ],
    [
      'Some entries no longer exist. Reload to see your latest profile.',
      'Some entries no longer exist. Reload to see your latest profile.',
    ],
    ['Editor is out of date', 'Editor is out of date. Reload to continue.'],
  ];

  it('has a non-empty corpus', () => {
    expect(cases.length).toBe(3);
  });

  it.each(cases)('%s -> %s', (message, expected) => {
    expect(memberFacingDbError({ code: 'P0001', message })).toBe(expected);
  });

  it('maps them regardless of the details payload', () => {
    expect(
      memberFacingDbError({
        code: 'P0001',
        message: 'Some entries no longer exist. Reload to see your latest profile.',
        details: '{"section": "items", "client_key": null}',
      }),
    ).toBe('Some entries no longer exist. Reload to see your latest profile.');
  });

  it('records Sentry context including details and hint for unknown errors', () => {
    dbErrorFor('save-profile', {
      code: 'XX000',
      message: 'boom',
      details: '{"section": "items", "client_key": "new:1"}',
      hint: 'h',
    });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [, ctx] = Sentry.captureException.mock.calls[0];
    expect(ctx.extra).toEqual({
      code: 'XX000',
      details: '{"section": "items", "client_key": "new:1"}',
      hint: 'h',
    });
  });
});

describe('KAN-487: parseSaveErrorDetail', () => {
  it('parses section + client_key', () => {
    expect(parseSaveErrorDetail('{"section": "items", "client_key": "new:abc"}')).toEqual({
      section: 'items',
      clientKey: 'new:abc',
    });
  });

  it('a null client_key becomes null', () => {
    expect(parseSaveErrorDetail('{"section": "profile", "client_key": null}')).toEqual({
      section: 'profile',
      clientKey: null,
    });
  });

  it('an absent client_key becomes null', () => {
    expect(parseSaveErrorDetail('{"section": "questions"}')).toEqual({
      section: 'questions',
      clientKey: null,
    });
  });

  const malformed: Array<[string, string | null | undefined]> = [
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace', '   '],
    ['plain Postgres detail', 'Key (lower(slug))=(alice) already exists.'],
    ['truncated JSON', '{"section": "items"'],
    ['JSON array', '["items", "new:1"]'],
    ['JSON string', '"items"'],
    ['JSON number', '42'],
    ['JSON null', 'null'],
    ['missing section', '{"client_key": "new:1"}'],
    ['null section', '{"section": null, "client_key": "new:1"}'],
    ['empty section', '{"section": "", "client_key": "new:1"}'],
    ['numeric section', '{"section": 3, "client_key": "new:1"}'],
    ['numeric client_key', '{"section": "items", "client_key": 7}'],
    ['object client_key', '{"section": "items", "client_key": {}}'],
    ['empty client_key', '{"section": "items", "client_key": ""}'],
  ];

  it('has a non-empty malformed corpus', () => {
    expect(malformed.length).toBe(17);
  });

  it.each(malformed)('%s -> null', (_label, input) => {
    expect(parseSaveErrorDetail(input)).toBeNull();
  });
});
