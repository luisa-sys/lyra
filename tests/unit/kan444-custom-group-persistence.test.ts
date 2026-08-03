/**
 * KAN-444 — the member's own group name reaches the database, safely.
 *
 * `group_label` is the one genuinely new piece of stored data in KAN-444, and
 * it is PUBLIC text: it becomes a heading on the member's profile. So it must
 * travel the same path as any other public field the member types — sanitise,
 * then moderate, then write — rather than being appended to the insert as a
 * trusted string. These cases assert that path behaviourally, by capturing the
 * row `addProfileItem` actually inserts.
 *
 * The mock shape mirrors `tests/unit/profile-item-url.test.ts` (KAN-219),
 * which covers the sibling `url` field on the same action.
 *
 * MUTATION PROOF (2026-08-03). Each mutation was applied to the real
 * `addProfileItem`, this suite re-run, and actions.ts restored from a /tmp
 * copy and confirmed byte-identical by shasum. Baseline: 5 passed, 0 failed.
 *
 *   mutation                                            failures it causes
 *   ----------------------------------------------------------------------
 *   drop `group_label` from the insert payload                    3
 *   delete the group_label moderation block (write it raw)        2
 *   coerce a blank/absent label to '' instead of NULL             2
 */

const mockInsertCapture = jest.fn();
const mockRevalidatePath = jest.fn();
const mockModerate = jest.fn();

jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

// Record every field moderation is asked to check, so we can assert the group
// name is not quietly exempted from it. The factory RETURNS the spy's result
// rather than a fixed `{ ok: true }` — a factory that swallows it would make
// the "blocked name" case below unable to fail, which is precisely the
// vacuous-guard shape this repo keeps finding.
jest.mock('@/lib/moderation-audit', () => ({
  moderateAndAudit: (_supabase: unknown, args: { text: string; field: string }) => mockModerate(args),
}));

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } } }),
    },
    from: jest.fn().mockImplementation((tableName: string) => {
      if (tableName === 'profiles') {
        return {
          select: () => ({
            eq: () => ({ single: () => Promise.resolve({ data: { id: 'test-profile-id' } }) }),
          }),
        };
      }
      if (tableName === 'profile_items') {
        return {
          insert: (data: unknown) => {
            mockInsertCapture(data);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`Unexpected table in mock: ${tableName}`);
    }),
  }),
}));

import { addProfileItem } from '@/app/dashboard/profile/actions';
import { CUSTOM_FAVOURITE_CATEGORY } from '@/app/dashboard/profile/favourites';

beforeEach(() => {
  mockInsertCapture.mockClear();
  mockRevalidatePath.mockClear();
  mockModerate.mockReset();
  mockModerate.mockImplementation(() => Promise.resolve({ ok: true }));
});

describe('KAN-444: addProfileItem — the member’s custom group name', () => {
  test('persists the group name alongside the item', async () => {
    const result = await addProfileItem({
      category: CUSTOM_FAVOURITE_CATEGORY,
      title: 'Wingspan',
      description: 'best with four players',
      groupLabel: 'Board games',
    });

    expect(result).toEqual({ success: true });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        category: CUSTOM_FAVOURITE_CATEGORY,
        title: 'Wingspan',
        group_label: 'Board games',
      }),
    );
  });

  test('moderates the group name — it is a public heading, not metadata', async () => {
    await addProfileItem({
      category: CUSTOM_FAVOURITE_CATEGORY,
      title: 'Wingspan',
      groupLabel: 'Board games',
    });

    const moderatedFields = mockModerate.mock.calls.map((c) => c[0].field);
    expect(moderatedFields).toContain('profile_items.group_label');

    const groupCall = mockModerate.mock.calls.find(
      (c) => c[0].field === 'profile_items.group_label',
    );
    expect(groupCall[0].text).toBe('Board games');
  });

  test('a blocked group name stops the write entirely', async () => {
    mockModerate.mockImplementation((args: { field: string }) =>
      args.field === 'profile_items.group_label'
        ? Promise.resolve({ ok: false, error: 'That name cannot be used.' })
        : Promise.resolve({ ok: true }),
    );

    const result = await addProfileItem({
      category: CUSTOM_FAVOURITE_CATEGORY,
      title: 'Wingspan',
      groupLabel: 'something blocked',
    });

    expect(result.success).toBe(false);
    // Nothing partial reaches the table.
    expect(mockInsertCapture).not.toHaveBeenCalled();
  });

  // The group name becomes a HEADING on the public profile, so it must travel
  // the same sanitise path as any other public text — not just moderation.
  // Replacing sanitiseText() with a bare .trim() previously left the whole
  // suite green, because the only assertion checked the moderated value, which
  // an unsanitised string satisfies identically.
  test('an over-long group name is capped, not stored whole', async () => {
    await addProfileItem({
      category: CUSTOM_FAVOURITE_CATEGORY,
      title: 'Wingspan',
      groupLabel: 'B'.repeat(200),
    });
    const payload = mockInsertCapture.mock.calls[0][0] as Record<string, unknown>;
    expect((payload.group_label as string).length).toBeLessThanOrEqual(60);
  });

  test('HTML in a group name is stripped before it becomes a public heading', async () => {
    await addProfileItem({
      category: CUSTOM_FAVOURITE_CATEGORY,
      title: 'Wingspan',
      groupLabel: '<b>Board</b> games',
    });
    const payload = mockInsertCapture.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.group_label).not.toContain('<b>');
  });

  // The next two are the migration-ordering guard, not a style preference.
  // PostgREST derives the INSERT column list from the payload keys, so sending
  // `group_label: null` on an environment where the column does not exist yet
  // fails the WHOLE request with PGRST204 — breaking every add path in the
  // editor and the legacy wizard, not just add-your-own. The key must be
  // ABSENT, so assert on the keys rather than on the value.
  test('an item with no group name omits group_label entirely (never null)', async () => {
    await addProfileItem({ category: 'favourite_books', title: 'Piranesi' });
    const payload = mockInsertCapture.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain('group_label');
  });

  test('a whitespace-only group name is treated as no name, and omits the key', async () => {
    await addProfileItem({
      category: CUSTOM_FAVOURITE_CATEGORY,
      title: 'Azul',
      groupLabel: '   ',
    });
    const payload = mockInsertCapture.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain('group_label');
  });

  test('every other column is still written when there is no group name', async () => {
    await addProfileItem({ category: 'favourite_books', title: 'Piranesi' });
    const payload = mockInsertCapture.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ['category', 'description', 'profile_id', 'title', 'url', 'visibility'],
    );
  });
});
