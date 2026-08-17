/**
 * KAN-415 D7 — the first unit coverage these actions have ever had.
 *
 * Suspending a member and closing a report are among the most
 * audit-sensitive writes in the product. Until this commit they lived as
 * UNEXPORTED `'use server'` closures inside
 * `src/app/admin/reports/[id]/page.tsx`, so they could not be imported and
 * therefore could not be tested. Not "were not tested" — *could not be*.
 *
 * The property worth protecting is ORDERING, and ordering is exactly what
 * review does not catch: swapping two `await`s reads like tidying. So these
 * tests assert the sequence directly, through a call log, rather than
 * asserting that each write merely happened.
 *
 * ⚠️ THE FROZEN CONTRACT: audit-first. `logModerationAction` throws when the
 * `moderation_logs` insert fails, and it is called BEFORE the mutation it
 * describes. A moderation action we could not record must not commit — the
 * alternative is a suspended member with no forensic record of who suspended
 * them or why. The second test in each block is the one that matters: it
 * proves the mutation does NOT happen when the audit write fails.
 */
import { resolveReport, suspendProfileFromReport } from '@/modules/trust-safety/report-actions';

/** Ordered log of everything the module did, in the order it did it. */
let calls: string[] = [];
let logShouldThrow = false;

const admin = { userId: 'admin-user-1', email: 'ops@checklyra.com' };
let currentAdmin: typeof admin | null = admin;

jest.mock('next/navigation', () => ({
  redirect: jest.fn((to: string) => {
    // The real redirect() throws to unwind the render; mimic that, because a
    // test that let execution continue past it would assert behaviour the
    // runtime never reaches.
    calls.push(`redirect:${to}`);
    const err = new Error(`NEXT_REDIRECT:${to}`);
    (err as unknown as { digest: string }).digest = `NEXT_REDIRECT;${to}`;
    throw err;
  }),
}));

jest.mock('@/modules/admin/admin', () => ({
  getCurrentAdmin: jest.fn(async () => currentAdmin),
  logModerationAction: jest.fn(async (input: { action: string; targetProfileId?: unknown }) => {
    calls.push(`log:${input.action}`);
    if (logShouldThrow) throw new Error('Failed to write moderation_logs row: boom');
    return 'log-row-1';
  }),
  getAdminServiceClient: jest.fn(() => {
    const chain = (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            calls.push(`select:${table}`);
            return { data: { profile_id: 'profile-9', profile_item_id: 'item-3' } };
          },
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: async () => {
          calls.push(`update:${table}:${Object.keys(payload).sort().join(',')}`);
          return { error: null };
        },
      }),
    });
    return { from: (table: string) => chain(table) };
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminModule = require('@/modules/admin/admin');

beforeEach(() => {
  calls = [];
  logShouldThrow = false;
  currentAdmin = admin;
  jest.clearAllMocks();
});

describe('resolveReport — closing a report', () => {
  test('writes the audit log BEFORE updating the report', async () => {
    await resolveReport('report-1', 'dismissed', 'dismiss_report', 'not a breach');

    const logIdx = calls.indexOf('log:dismiss_report');
    const updIdx = calls.findIndex((c) => c.startsWith('update:reports'));
    expect(logIdx).toBeGreaterThanOrEqual(0);
    expect(updIdx).toBeGreaterThanOrEqual(0);
    expect(logIdx).toBeLessThan(updIdx);
  });

  test('a failed audit write ABORTS the update — the frozen contract', async () => {
    logShouldThrow = true;
    await expect(
      resolveReport('report-1', 'dismissed', 'dismiss_report', 'x'),
    ).rejects.toThrow(/moderation_logs/);
    // The whole point: no mutation reached the database.
    expect(calls.some((c) => c.startsWith('update:'))).toBe(false);
  });

  test('the log row names the reported profile AND item, read before the update', async () => {
    // Read first so the audit trail records what was moderated — after the
    // status change that association is harder to reconstruct.
    await resolveReport('report-1', 'actioned', 'resolve_report', 'breach');
    expect(adminModule.logModerationAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'resolve_report',
        targetProfileId: 'profile-9',
        targetItemId: 'item-3',
        metadata: { reportId: 'report-1' },
      }),
    );
    expect(calls.indexOf('select:reports')).toBeLessThan(calls.indexOf('log:resolve_report'));
  });

  test('an empty reason is stored as null, not as an empty string', async () => {
    await resolveReport('report-1', 'dismissed', 'dismiss_report', '');
    expect(adminModule.logModerationAction).toHaveBeenCalledWith(
      expect.objectContaining({ reason: null }),
    );
  });

  test('a non-admin caller is redirected and writes nothing', async () => {
    currentAdmin = null;
    await expect(resolveReport('report-1', 'dismissed', 'dismiss_report', 'x')).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(calls).toEqual(['redirect:/']);
  });
});

describe('suspendProfileFromReport — the highest-consequence write', () => {
  test('the order is log, then suspend, then close the report', async () => {
    await suspendProfileFromReport('report-1', 'profile-9', 'repeated abuse');

    expect(calls).toEqual([
      'log:suspend',
      'update:profiles:is_suspended,suspended_at,suspension_reason',
      'update:reports:resolved_at,resolved_by,status',
    ]);
  });

  test('a failed audit write means NOBODY gets suspended', async () => {
    logShouldThrow = true;
    await expect(suspendProfileFromReport('report-1', 'profile-9', 'x')).rejects.toThrow(
      /moderation_logs/,
    );
    expect(calls.some((c) => c.startsWith('update:'))).toBe(false);
  });

  test('the report is closed LAST, so a partial failure leaves it open', async () => {
    // An open report about an already-suspended member is a visible
    // inconsistency someone will resolve. A CLOSED report about a member who
    // was never suspended looks like a decision that was made, and nobody
    // goes back to it. The ordering is the difference between those two.
    await suspendProfileFromReport('report-1', 'profile-9', 'x');
    expect(calls[calls.length - 1]).toMatch(/^update:reports/);
  });

  test('the suspension reason is defaulted, never left blank', async () => {
    await suspendProfileFromReport('report-1', 'profile-9', '');
    expect(adminModule.logModerationAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'suspend',
        targetProfileId: 'profile-9',
        reason: 'Action taken following report',
      }),
    );
  });

  test('a non-admin caller is redirected and suspends nobody', async () => {
    currentAdmin = null;
    await expect(suspendProfileFromReport('report-1', 'profile-9', 'x')).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(calls).toEqual(['redirect:/']);
  });
});
