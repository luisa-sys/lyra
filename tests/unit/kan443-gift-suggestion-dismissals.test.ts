/**
 * KAN-443 — "not for me": a member can remove ONE auto-generated gift
 * suggestion, and it stays gone.
 *
 * Three things have to hold for that sentence to be true, and they are tested
 * in that order:
 *
 *   1. The KEY is stable. What a visitor sees is a product resolved at request
 *      time from a concept; the product changes, the concept does not. A key
 *      derived from the product would let a dismissed idea reappear wearing a
 *      different label.
 *   2. The FILTERS actually drop it — on BOTH the V1 concept list and the V2
 *      output, because a sparse profile gets evergreen concepts that never
 *      passed through the V1 list.
 *   3. The WRITE is a proper write path: authenticated, rate-limited, and
 *      scoped to the caller's own profile in code as well as by RLS.
 *
 * The Supabase mock dispatches by table and throws on an unexpected one, and
 * the upsert / delete are captured on separate spies — so the ownership
 * pre-read of `profiles` can never satisfy an assertion meant for the write.
 *
 * MUTATION PROOF (2026-08-03). Each mutation was applied to the real subject,
 * this suite re-run, and the subject restored from a /tmp copy and confirmed
 * byte-identical by shasum. Baseline: 37 passed, 0 failed. Sixteen mutations,
 * every one of them RED:
 *
 *   mutation                                                         failures
 *   ------------------------------------------------------------------------
 *   giftSuggestionKey stops normalising the title (case + whitespace)       7
 *   giftSuggestionKey drops the length cap                                  1
 *   withoutDismissedV2 returns its input unchanged                          1
 *   withoutDismissedRecommendations returns its input unchanged             2
 *   dismissGiftSuggestion: delete the rate-limit check                      1
 *   dismissGiftSuggestion: delete the empty-key guard                       2
 *   dismissGiftSuggestion: stop sanitising / capping the key                3
 *   dismissGiftSuggestion: drop ignoreDuplicates from the upsert options    1
 *   restoreGiftSuggestion: drop .eq('profile_id', …) from the delete        1
 *   [slug]/page.tsx: remove the withoutDismissedV2 call                     1
 *   [slug]/page.tsx: remove the dismissals read                             2
 *   dashboard/profile/page.tsx: remove the dismissals read                  1
 *   migration: remove `enable row level security`                           1
 *   migration: revoke from `public` only (gotcha #26)                       1
 *   migration: remove the gift_voucher_hint column add                      1
 *   migration: grant to anon instead of authenticated                       1
 */

import fs from 'node:fs';
import path from 'node:path';
import { SRC } from '../support/source-paths';

// ---------------------------------------------------------------------------
// Mocks — declared before the imports they intercept (jest hoists jest.mock).
// ---------------------------------------------------------------------------
const mockUpsertCapture = jest.fn();
const mockDeleteEq = jest.fn();
const mockRevalidatePath = jest.fn();
const mockRateLimit = jest.fn();

let mockUser: { id: string } | null = { id: 'test-user-id' };
let mockProfileRow: { id: string } | null = { id: 'test-profile-id' };
let mockUpsertError: { message: string } | null = null;

jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

jest.mock('@/modules/guards/profile-rate-limit', () => ({
  checkProfileWriteRateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: () => Promise.resolve({ data: { user: mockUser } }),
    },
    from: jest.fn().mockImplementation((tableName: string) => {
      if (tableName === 'profiles') {
        return {
          select: () => ({
            eq: () => ({ single: () => Promise.resolve({ data: mockProfileRow }) }),
          }),
        };
      }
      if (tableName === 'gift_suggestion_dismissals') {
        return {
          upsert: (row: unknown, options: unknown) => {
            mockUpsertCapture(row, options);
            return Promise.resolve({ error: mockUpsertError });
          },
          delete: () => {
            // Chainable + awaitable, so each .eq() is recorded individually and
            // an assertion about owner-scoping cannot be satisfied by the other
            // .eq() in the same chain.
            const chain = {
              eq: (column: string, value: unknown) => {
                mockDeleteEq(column, value);
                return chain;
              },
              then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
            };
            return chain;
          },
        };
      }
      throw new Error(`Unexpected table in mock: ${tableName}`);
    }),
  }),
}));

import {
  giftSuggestionKey,
  keyForRecommendation,
  keyForConcept,
  withoutDismissedRecommendations,
  withoutDismissedV2,
  MAX_SUGGESTION_KEY_LENGTH,
} from '@/lib/recommend/dismissals';
import { dismissGiftSuggestion, restoreGiftSuggestion } from '@/app/dashboard/profile/actions';

beforeEach(() => {
  mockUpsertCapture.mockClear();
  mockDeleteEq.mockClear();
  mockRevalidatePath.mockClear();
  mockRateLimit.mockReset();
  mockRateLimit.mockResolvedValue({ allowed: true });
  mockUser = { id: 'test-user-id' };
  mockProfileRow = { id: 'test-profile-id' };
  mockUpsertError = null;
});

// ===========================================================================
// 1. The key
//    Every expected value below is a LITERAL. Deriving one by calling the
//    function under test would produce a test that cannot fail.
// ===========================================================================
describe('the identity of a dismissed suggestion', () => {
  test('is category + title, lower-cased', () => {
    expect(giftSuggestionKey('books_reading', 'Something to read')).toBe(
      'books_reading:something to read',
    );
  });

  test('collapses runs of whitespace, so a stray double space cannot resurrect it', () => {
    expect(giftSuggestionKey('food_drink', 'A  cookery   class')).toBe(
      'food_drink:a cookery class',
    );
  });

  test('ignores surrounding whitespace', () => {
    expect(giftSuggestionKey('experiences', '  A day out  ')).toBe('experiences:a day out');
  });

  test('is capped, so a hostile caller cannot store an unbounded string', () => {
    const key = giftSuggestionKey('experiences', 'x'.repeat(4000));
    expect(key.length).toBe(MAX_SUGGESTION_KEY_LENGTH);
    expect(MAX_SUGGESTION_KEY_LENGTH).toBe(200);
  });

  // The two surfaces must agree. The editor dismisses using a V1
  // RecommendationResult; the public profile filters the V2 pipeline, whose
  // concepts are built from those same results (`conceptTitle: r.title`). If
  // these two ever produced different strings, "not for me" would appear to
  // work in the editor and change nothing for visitors.
  test('a V1 result and the V2 concept built from it produce the SAME key', () => {
    expect(keyForRecommendation({ categoryKey: 'books_reading', title: 'Something to read' }))
      .toBe('books_reading:something to read');
    expect(keyForConcept({ categoryKey: 'books_reading', conceptTitle: 'Something to read' }))
      .toBe('books_reading:something to read');
  });
});

// ===========================================================================
// 2. The filters
// ===========================================================================
describe('dismissed suggestions are dropped from what a visitor sees', () => {
  const v1 = [
    { categoryKey: 'books_reading', title: 'Something to read', score: 12 },
    { categoryKey: 'food_drink', title: 'A cookery class', score: 9 },
    { categoryKey: 'experiences', title: 'A day out', score: 7 },
  ];

  test('the dismissed concept goes, and the others stay in order', () => {
    const kept = withoutDismissedRecommendations(v1, new Set(['food_drink:a cookery class']));
    expect(kept.map((r) => r.title)).toEqual(['Something to read', 'A day out']);
  });

  test('nothing dismissed leaves the list untouched', () => {
    const kept = withoutDismissedRecommendations(v1, new Set<string>());
    expect(kept.map((r) => r.title)).toEqual([
      'Something to read',
      'A cookery class',
      'A day out',
    ]);
  });

  test('a differently-cased stored key still matches', () => {
    const kept = withoutDismissedRecommendations(
      [{ categoryKey: 'books_reading', title: 'SOMETHING TO READ' }],
      new Set(['books_reading:something to read']),
    );
    expect(kept).toEqual([]);
  });

  // The V2 pass is NOT redundant with the V1 one: evergreen concepts are
  // substituted inside the pipeline and never appear in the V1 list, so
  // without this filter a dismissed evergreen suggestion comes straight back.
  test('an evergreen concept the member dismissed does not come back', () => {
    const v2 = [
      { concept: { categoryKey: 'experiences', conceptTitle: 'A memorable experience' }, id: 'a' },
      { concept: { categoryKey: 'books_reading', conceptTitle: 'Something to read' }, id: 'b' },
    ];
    const kept = withoutDismissedV2(v2, new Set(['books_reading:something to read']));
    expect(kept.map((r) => r.id)).toEqual(['a']);
  });

  test('the V2 filter leaves undismissed recommendations alone', () => {
    const v2 = [
      { concept: { categoryKey: 'experiences', conceptTitle: 'A memorable experience' }, id: 'a' },
    ];
    expect(withoutDismissedV2(v2, new Set(['food_drink:a cookery class'])).map((r) => r.id))
      .toEqual(['a']);
  });
});

// ===========================================================================
// 3. The write path
// ===========================================================================
describe('dismissGiftSuggestion', () => {
  test('records the dismissal against the caller’s OWN profile', async () => {
    const result = await dismissGiftSuggestion('books_reading:something to read');

    expect(result).toEqual({ success: true });
    expect(mockUpsertCapture).toHaveBeenCalledTimes(1);
    expect(mockUpsertCapture.mock.calls[0][0]).toEqual({
      profile_id: 'test-profile-id',
      suggestion_key: 'books_reading:something to read',
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/profile');
  });

  test('is idempotent — dismissing twice is not an error', async () => {
    await dismissGiftSuggestion('books_reading:something to read');
    expect(mockUpsertCapture.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        onConflict: 'profile_id,suggestion_key',
        ignoreDuplicates: true,
      }),
    );
  });

  test('an unauthenticated caller writes nothing', async () => {
    mockUser = null;
    const result = await dismissGiftSuggestion('books_reading:something to read');

    expect(result).toEqual({ success: false, error: 'Not authenticated' });
    expect(mockUpsertCapture).not.toHaveBeenCalled();
  });

  test('a rate-limited caller writes nothing', async () => {
    mockRateLimit.mockResolvedValue({
      allowed: false,
      reason: 'user',
      retryAfter: 30,
      result: { success: false, error: 'You are saving too quickly.' },
    });

    const result = await dismissGiftSuggestion('books_reading:something to read');

    expect(result).toEqual({ success: false, error: 'You are saving too quickly.' });
    expect(mockUpsertCapture).not.toHaveBeenCalled();
  });

  test('a caller with no profile writes nothing', async () => {
    mockProfileRow = null;
    const result = await dismissGiftSuggestion('books_reading:something to read');

    expect(result).toEqual({ success: false, error: 'Profile not found' });
    expect(mockUpsertCapture).not.toHaveBeenCalled();
  });

  test('an empty key is rejected rather than stored', async () => {
    const result = await dismissGiftSuggestion('   ');
    expect(result.success).toBe(false);
    expect(mockUpsertCapture).not.toHaveBeenCalled();
  });

  test('a key that sanitises away to nothing is rejected too', async () => {
    const result = await dismissGiftSuggestion('<b></b>');
    expect(result.success).toBe(false);
    expect(mockUpsertCapture).not.toHaveBeenCalled();
  });

  // A server action is a public endpoint: the key is machine-generated by our
  // own UI, but the argument is whatever the client actually sends.
  test('an over-long key is capped before it is stored', async () => {
    await dismissGiftSuggestion('x'.repeat(4000));
    const row = mockUpsertCapture.mock.calls[0][0] as { suggestion_key: string };
    expect(row.suggestion_key.length).toBe(200);
  });

  test('a database error is surfaced, not swallowed', async () => {
    // BUGS-87 (founder-approved 2026-08-09): this asserted the RAW Postgres
    // string reached the caller — and `gift-extras-section.tsx` renders it
    // verbatim in a role="alert", so it reached the MEMBER. The test's real
    // intent is "the failure is surfaced, not swallowed"; that is preserved,
    // and strengthened by asserting the raw text is now absent.
    mockUpsertError = { message: 'relation does not exist' };
    const result = await dismissGiftSuggestion('books_reading:something to read');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Something went wrong saving that. Please try again.');
      expect(result.error).not.toMatch(/relation does not exist/);
    }
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe('restoreGiftSuggestion', () => {
  test('deletes exactly one row, scoped to the caller’s profile AND that key', async () => {
    const result = await restoreGiftSuggestion('books_reading:something to read');

    expect(result).toEqual({ success: true });
    expect(mockDeleteEq.mock.calls).toEqual([
      ['profile_id', 'test-profile-id'],
      ['suggestion_key', 'books_reading:something to read'],
    ]);
  });

  test('an unauthenticated caller deletes nothing', async () => {
    mockUser = null;
    const result = await restoreGiftSuggestion('books_reading:something to read');

    expect(result).toEqual({ success: false, error: 'Not authenticated' });
    expect(mockDeleteEq).not.toHaveBeenCalled();
  });

  test('a rate-limited caller deletes nothing', async () => {
    mockRateLimit.mockResolvedValue({
      allowed: false,
      reason: 'ip',
      retryAfter: 30,
      result: { success: false, error: 'Too many requests from your network.' },
    });

    const result = await restoreGiftSuggestion('books_reading:something to read');

    expect(result.success).toBe(false);
    expect(mockDeleteEq).not.toHaveBeenCalled();
  });

  test('an empty key deletes nothing', async () => {
    const result = await restoreGiftSuggestion('');
    expect(result.success).toBe(false);
    expect(mockDeleteEq).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4. Wiring — the filters are actually reached
//
//    These are source assertions, and source assertions are exactly where this
//    repo has repeatedly been fooled (SEC-100: `toContain('is_published')`
//    stayed green while the filter was deleted, because the string also
//    appeared in the COMMENT explaining the filter). So comments are stripped
//    first, and the stripper is itself tested below.
// ===========================================================================
const ROOT = path.resolve(__dirname, '../..');

/** Remove /* … *​/ blocks (which is also how JSX `{/* … *​/}` is written) and
 *  trailing `//` line comments, without eating `https://` inside a string. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

describe('the comment stripper used below actually strips', () => {
  test('removes a trailing line comment', () => {
    expect(stripComments('const a = 1; // withoutDismissedV2(x)')).not.toContain(
      'withoutDismissedV2',
    );
  });

  test('removes a JSX block comment', () => {
    expect(stripComments('{/* withoutDismissedV2(x) */}')).not.toContain('withoutDismissedV2');
  });

  test('leaves a URL in a string alone', () => {
    expect(stripComments("const u = 'https://example.com';")).toContain('https://example.com');
  });
});

describe('the public profile filters its recommendations by the dismissals', () => {
  const page = stripComments(fs.readFileSync(path.join(ROOT, SRC.slugPage), 'utf-8'));

  test('it reads the member’s dismissals', () => {
    expect(page).toMatch(/\.from\('gift_suggestion_dismissals'\)/);
    expect(page).toMatch(/dismissedKeys/);
  });

  test('the V1 concept list is filtered BEFORE the pipeline runs', () => {
    // Filtering before the pipeline is what lets the next-best concept take the
    // freed slot instead of the member simply losing a suggestion.
    expect(page).toMatch(/withoutDismissedRecommendations\(\s*getRecommendations\(/);
  });

  test('the pipeline OUTPUT is filtered too, for the evergreen fallbacks', () => {
    expect(page).toMatch(/withoutDismissedV2\(v2Result\.recommendations, dismissedKeys\)/);
  });

  test('the voucher hint is rendered', () => {
    expect(page).toMatch(/gift_voucher_hint/);
  });
});

describe('the editor offers the suggestions with their dismissed state', () => {
  const page = stripComments(fs.readFileSync(path.join(ROOT, SRC.profilePage), 'utf-8'));

  test('it reads the dismissals and marks each suggestion', () => {
    expect(page).toMatch(/\.from\('gift_suggestion_dismissals'\)/);
    expect(page).toMatch(/keyForRecommendation\(/);
    expect(page).toMatch(/dismissed: dismissedKeys\.has\(key\)/);
  });
});

// ===========================================================================
// 5. The migration — a new public table must not ship without RLS
// ===========================================================================
describe('the KAN-443 migration', () => {
  const file = fs
    .readdirSync(path.join(ROOT, SRC.migrations))
    .find((f) => f.endsWith('.sql') && f.includes('kan443'));

  // Non-vacuity: every assertion below reads this file, so a missing file must
  // fail loudly rather than skip.
  test('exists exactly once in the migration lineage', () => {
    const matches = fs
      .readdirSync(path.join(ROOT, SRC.migrations))
      .filter((f) => f.endsWith('.sql') && f.includes('kan443'));
    expect(matches).toHaveLength(1);
  });

  // SQL `--` comments are stripped for the same reason JS comments are above:
  // the header explains what the DDL does, so an unstripped scan would match
  // the explanation of a statement that had been deleted.
  const sql = stripComments(
    fs
      .readFileSync(path.join(ROOT, SRC.migrations, file!), 'utf-8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n'),
  ).toLowerCase();

  test('adds the voucher-hint column additively', () => {
    expect(sql).toMatch(/alter table public\.profiles\s+add column if not exists gift_voucher_hint text/);
  });

  test('enables row level security on the new table (BUGS-77)', () => {
    expect(sql).toMatch(/create table if not exists public\.gift_suggestion_dismissals/);
    expect(sql).toMatch(
      /alter table public\.gift_suggestion_dismissals enable row level security/,
    );
  });

  test('scopes the policy to the owner', () => {
    expect(sql).toMatch(/create policy[\s\S]*gift_suggestion_dismissals[\s\S]*auth\.uid\(\)/);
  });

  // Gotcha #26: revoking from `public` alone leaves anon and authenticated
  // holding Supabase's default grants.
  test('revokes from all three roles, not just public', () => {
    expect(sql).toMatch(
      /revoke all on table public\.gift_suggestion_dismissals from public, anon, authenticated/,
    );
  });

  test('grants back only what the dismiss / restore actions need', () => {
    expect(sql).toMatch(
      /grant select, insert, delete on table public\.gift_suggestion_dismissals to authenticated/,
    );
    expect(sql).not.toMatch(/to anon/);
  });
});
