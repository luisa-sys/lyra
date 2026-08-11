/**
 * KAN-415 D7 part 2 — first unit coverage for the user-moderation actions.
 *
 * Same story as report-actions: these were unexported `'use server'` closures
 * and therefore untestable by construction.
 *
 * ⚠️ THE ASYMMETRY IS PINNED, NOT FIXED. Suspend and publish-state both refuse
 * self-moderation; item deletion does not check at all. That is reproduced
 * exactly from the pre-move code and asserted here so it cannot drift further
 * while a decision is pending. Adding a guard where none existed would be a
 * behaviour change, and this commit is a behaviour-preserving move — doing
 * both at once means neither can be verified.
 *
 * The test named "...has NO self-moderation guard" is therefore asserting
 * something we may well want to change. It is written that way on purpose: an
 * undocumented gap is a bug waiting to be rediscovered, whereas a gap with a
 * test around it is a decision someone has to make deliberately to alter.
 */
import {
  isSelfModeration,
  setSuspendState,
  setPublishedState,
  deleteProfileItem,
} from '@/modules/trust-safety/user-actions';

let calls: string[] = [];
let logShouldThrow = false;
const admin = { userId: 'u-1', profileId: 'admin-profile', email: 'ops@checklyra.com' };
let currentAdmin: typeof admin | null = admin;

jest.mock('next/navigation', () => ({
  redirect: jest.fn((to: string) => {
    calls.push(`redirect:${to}`);
    const err = new Error(`NEXT_REDIRECT:${to}`);
    (err as unknown as { digest: string }).digest = `NEXT_REDIRECT;${to}`;
    throw err;
  }),
}));

jest.mock('@/lib/admin', () => ({
  getCurrentAdmin: jest.fn(async () => currentAdmin),
  logModerationAction: jest.fn(async (input: { action: string }) => {
    calls.push(`log:${input.action}`);
    if (logShouldThrow) throw new Error('Failed to write moderation_logs row: boom');
    return 'row-1';
  }),
  getAdminServiceClient: jest.fn(() => ({
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => ({
        eq: async () => {
          calls.push(`update:${table}:${Object.keys(payload).sort().join(',')}`);
          return { error: null };
        },
      }),
      delete: () => ({
        eq: async () => {
          calls.push(`delete:${table}`);
          return { error: null };
        },
      }),
    }),
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminModule = require('@/lib/admin');

beforeEach(() => {
  calls = [];
  logShouldThrow = false;
  currentAdmin = admin;
  jest.clearAllMocks();
});

/** Every action redirects on success; swallow it and inspect `calls`. */
async function run(fn: () => Promise<void>): Promise<void> {
  await expect(fn()).rejects.toThrow(/NEXT_REDIRECT/);
}

describe('isSelfModeration — one implementation, previously two', () => {
  test('matches only when both ids are present AND equal', () => {
    expect(isSelfModeration('p1', 'p1')).toBe(true);
    expect(isSelfModeration('p1', 'p2')).toBe(false);
  });

  test('a null admin profileId never matches, including against an empty target', () => {
    // The dangerous shape: if "unknown" compared equal to "unknown", an admin
    // whose profileId failed to load would be silently unable to moderate
    // anyone whose id was also blank — a guard failing CLOSED on bad data
    // looks identical to the feature not working.
    expect(isSelfModeration(null, '')).toBe(false);
    expect(isSelfModeration(undefined, '')).toBe(false);
    expect(isSelfModeration('', '')).toBe(false);
  });
});

describe('setSuspendState', () => {
  test('logs before mutating, then redirects to the profile', async () => {
    await run(() => setSuspendState('target-1', 'alice', 'abuse', true));
    expect(calls).toEqual([
      'log:suspend',
      'update:profiles:is_suspended,suspended_at,suspension_reason',
      'redirect:/admin/users/alice',
    ]);
  });

  test('unsuspending clears the reason and timestamp, it does not just flip the flag', async () => {
    // A stale suspended_at/suspension_reason on a live member would read as
    // "currently suspended" to anything inspecting the row rather than the flag.
    await run(() => setSuspendState('target-1', 'alice', '', false));
    expect(adminModule.logModerationAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'unsuspend' }),
    );
    expect(calls).toContain('update:profiles:is_suspended,suspended_at,suspension_reason');
  });

  test('a failed audit write suspends NOBODY', async () => {
    logShouldThrow = true;
    await expect(setSuspendState('target-1', 'alice', 'x', true)).rejects.toThrow(
      /moderation_logs/,
    );
    expect(calls.some((c) => c.startsWith('update:'))).toBe(false);
  });

  test('an admin cannot suspend themselves — bails before logging', async () => {
    await run(() => setSuspendState(admin.profileId, 'me', 'x', true));
    expect(calls).toEqual(['redirect:/admin/users/me']);
    expect(adminModule.logModerationAction).not.toHaveBeenCalled();
  });

  test('a non-admin caller is redirected to / and writes nothing', async () => {
    currentAdmin = null;
    await run(() => setSuspendState('target-1', 'alice', 'x', true));
    expect(calls).toEqual(['redirect:/']);
  });
});

describe('setPublishedState', () => {
  test('logs before mutating', async () => {
    await run(() => setPublishedState('target-1', 'alice', 'spam', false));
    expect(calls).toEqual([
      'log:unpublish',
      'update:profiles:is_published',
      'redirect:/admin/users/alice',
    ]);
  });

  test('republish is a distinct audited action, not an unpublish with a flag', async () => {
    await run(() => setPublishedState('target-1', 'alice', '', true));
    expect(adminModule.logModerationAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'republish' }),
    );
  });

  test('a failed audit write leaves the profile visible as it was', async () => {
    logShouldThrow = true;
    await expect(setPublishedState('t', 'alice', 'x', false)).rejects.toThrow(/moderation_logs/);
    expect(calls.some((c) => c.startsWith('update:'))).toBe(false);
  });

  test('an admin cannot unpublish themselves — bails before logging', async () => {
    await run(() => setPublishedState(admin.profileId, 'me', 'x', false));
    expect(calls).toEqual(['redirect:/admin/users/me']);
    expect(adminModule.logModerationAction).not.toHaveBeenCalled();
  });
});

describe('deleteProfileItem', () => {
  test('logs before deleting, recording both the profile and the item', async () => {
    await run(() => deleteProfileItem('item-7', 'target-1', 'alice', 'off-policy'));
    expect(calls).toEqual(['log:delete_item', 'delete:profile_items', 'redirect:/admin/users/alice']);
    expect(adminModule.logModerationAction).toHaveBeenCalledWith(
      expect.objectContaining({ targetProfileId: 'target-1', targetItemId: 'item-7' }),
    );
  });

  test('a failed audit write deletes NOTHING', async () => {
    logShouldThrow = true;
    await expect(deleteProfileItem('item-7', 't', 'alice', 'x')).rejects.toThrow(
      /moderation_logs/,
    );
    expect(calls.some((c) => c.startsWith('delete:'))).toBe(false);
  });

  test('⚠️ it has NO self-moderation guard — pinned as a finding, not endorsed', async () => {
    // Suspend and publish-state both refuse this; deletion does not check.
    // Reproduced from the pre-move code so the extraction stays behaviour-
    // preserving. If the answer is "an admin may tidy their own profile",
    // this test becomes the documentation of that decision; if it is "no",
    // this test is the one that goes red when the guard is added.
    await run(() => deleteProfileItem('item-7', admin.profileId, 'me', 'x'));
    expect(calls).toEqual(['log:delete_item', 'delete:profile_items', 'redirect:/admin/users/me']);
  });
});
