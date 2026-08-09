/**
 * KAN-443 — the optional "I'd rather choose my own" line.
 *
 * Two separate contracts are pinned here, and the second is the dangerous one.
 *
 * 1. It is PUBLIC text on the profile, so it must travel the same path as every
 *    other public field a member types: sanitise, then moderate, then write.
 *
 * 2. `gift_voucher_hint` is a NEW column on `profiles` — the busiest table in
 *    the app. PostgREST builds the UPDATE column list from the payload KEYS, so
 *    naming it on an environment where migration
 *    20260803170000_kan443_gift_redesign.sql has not run yet fails the WHOLE
 *    request with PGRST204, EVEN WHEN THE VALUE IS NULL. Code reaches an
 *    environment before its migration does. `npm run type-check` cannot see
 *    this: src/lib/supabase-server.ts builds an UNTYPED client. So the tests
 *    below assert on the payload KEYS, not on the values.
 *
 * The mock dispatches by table and captures the UPDATE payload specifically, so
 * the ownership pre-read (`profiles.select('id')`) can never satisfy an
 * assertion meant for the write.
 *
 * MUTATION PROOF (2026-08-03). Each mutation was applied to the real subject,
 * this suite re-run, and the file restored from a /tmp copy and confirmed
 * byte-identical by shasum. Baseline: 14 passed, 0 failed.
 *
 *   mutation                                                    failures
 *   -------------------------------------------------------------------
 *   giftVoucherHintPayload always returns the key (never omits)        4
 *   giftVoucherHintPayload never returns null (cannot clear)           1
 *   drop 'gift_voucher_hint' from ALLOWED_PROFILE_FIELDS               5
 *   updateProfileFields writes strings without sanitiseText            1
 *   updateProfileFields skips moderation for string fields             2
 */

const mockUpdateCapture = jest.fn();
const mockEqResolve = jest.fn();
const mockRevalidatePath = jest.fn();
const mockModerate = jest.fn();

jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

// The factory RETURNS the spy's result rather than a fixed `{ ok: true }`. A
// factory that swallowed it would make the "blocked hint" case below unable to
// fail — the vacuous-guard shape this repo keeps finding.
jest.mock('@/lib/moderation-audit', () => ({
  moderateAndAudit: (_supabase: unknown, args: { text: string; field: string }) =>
    mockModerate(args),
}));

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } } }),
    },
    from: jest.fn().mockImplementation((tableName: string) => {
      if (tableName !== 'profiles') {
        throw new Error(`Unexpected table in mock: ${tableName}`);
      }
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: { id: 'test-profile-id' }, error: null }),
            maybeSingle: () => Promise.resolve({ data: { age_status: 'passed' }, error: null }),
          }),
        }),
        update: (data: unknown) => {
          mockUpdateCapture(data);
          return { eq: mockEqResolve };
        },
      };
    }),
  }),
}));

import { updateProfileFields } from '@/app/dashboard/profile/actions';
import { giftVoucherHintPayload } from '@/app/dashboard/profile/profile-fields';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SRC } from '../support/source-paths';

beforeEach(() => {
  mockUpdateCapture.mockClear();
  mockRevalidatePath.mockClear();
  mockEqResolve.mockClear();
  mockEqResolve.mockResolvedValue({ error: null });
  mockModerate.mockReset();
  mockModerate.mockImplementation(() => Promise.resolve({ ok: true }));
});

// ===========================================================================
// The payload decision — "is there anything to say about this column?"
// ===========================================================================
describe('giftVoucherHintPayload — the key is present only when there is something to write', () => {
  test('a hint the member typed is written', () => {
    expect(giftVoucherHintPayload('a book token is always welcome', null)).toEqual({
      gift_voucher_hint: 'a book token is always welcome',
    });
  });

  test('surrounding whitespace is trimmed off before it is written', () => {
    expect(giftVoucherHintPayload('   a book token   ', null)).toEqual({
      gift_voucher_hint: 'a book token',
    });
  });

  // The PGRST204 guard. Assert on KEYS: `{ gift_voucher_hint: null }` would
  // pass a value-based assertion while still failing the whole request on an
  // environment where the column does not exist yet.
  test('nothing typed and nothing stored omits the key ENTIRELY, never null', () => {
    const payload = giftVoucherHintPayload('', null);
    expect(Object.keys(payload)).toEqual([]);
    expect('gift_voucher_hint' in payload).toBe(false);
  });

  test('a whitespace-only entry with nothing stored also omits the key', () => {
    expect(Object.keys(giftVoucherHintPayload('   ', null))).toEqual([]);
  });

  test('an undefined stored value (column absent from the row) omits the key', () => {
    // This is exactly the shape select('*') returns on an environment that has
    // not run the migration: the key simply is not on the row.
    expect(Object.keys(giftVoucherHintPayload('', undefined))).toEqual([]);
  });

  test('a stored blank is not a stored hint, so there is still nothing to clear', () => {
    expect(Object.keys(giftVoucherHintPayload('', '   '))).toEqual([]);
  });

  // The fix must not overshoot: clearing a hint that really exists is a real
  // write, and it is safe precisely because a stored value proves the column
  // exists on that environment.
  test('clearing a hint that IS stored writes null', () => {
    const payload = giftVoucherHintPayload('', 'a book token');
    expect('gift_voucher_hint' in payload).toBe(true);
    expect(payload.gift_voucher_hint).toBeNull();
  });

  test('replacing a stored hint writes the new text, not null', () => {
    expect(giftVoucherHintPayload('a plant, ideally', 'a book token')).toEqual({
      gift_voucher_hint: 'a plant, ideally',
    });
  });
});

// ===========================================================================
// The write path — allowlist, sanitise, moderation
// ===========================================================================
describe('updateProfileFields — the voucher hint is treated as public text', () => {
  test('an allowlisted hint reaches the UPDATE payload', async () => {
    const result = await updateProfileFields({
      gift_voucher_hint: 'A book token is always welcome',
    });

    expect(result).toEqual({ success: true });
    expect(mockUpdateCapture).toHaveBeenCalledWith({
      gift_voucher_hint: 'A book token is always welcome',
    });
  });

  test('HTML is stripped before it becomes public profile text', async () => {
    await updateProfileFields({ gift_voucher_hint: '<b>A book token</b> please' });
    const payload = mockUpdateCapture.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.gift_voucher_hint).not.toContain('<b>');
    expect(payload.gift_voucher_hint).toBe('A book token please');
  });

  test('it is moderated, under its own field name', async () => {
    await updateProfileFields({ gift_voucher_hint: 'A book token is always welcome' });

    const moderatedFields = mockModerate.mock.calls.map((c) => c[0].field);
    expect(moderatedFields).toContain('profiles.gift_voucher_hint');

    const hintCall = mockModerate.mock.calls.find(
      (c) => c[0].field === 'profiles.gift_voucher_hint',
    );
    expect(hintCall![0].text).toBe('A book token is always welcome');
  });

  test('a blocked hint stops the write entirely', async () => {
    mockModerate.mockImplementation((args: { field: string }) =>
      args.field === 'profiles.gift_voucher_hint'
        ? Promise.resolve({ ok: false, error: 'That cannot be used.' })
        : Promise.resolve({ ok: true }),
    );

    const result = await updateProfileFields({ gift_voucher_hint: 'something blocked' });

    expect(result.success).toBe(false);
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });

  // BUGS-74 contract, restated for the new column: "not provided" must never be
  // coerced into "clear this".
  test('an undefined hint is omitted from the payload, leaving a stored one alone', async () => {
    await updateProfileFields({
      display_name: 'Alice',
      gift_voucher_hint: undefined as unknown as string,
    });

    const payload = mockUpdateCapture.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('gift_voucher_hint');
    expect(payload).toEqual({ display_name: 'Alice' });
  });

  test('an explicit null still clears the column', async () => {
    await updateProfileFields({ gift_voucher_hint: null });
    expect(mockUpdateCapture.mock.calls[0][0]).toEqual({ gift_voucher_hint: null });
  });
});

// ───────────── The member-facing half is actually wired ─────────────

// Everything above tests the modules. Review found the surfaces unguarded:
// the ONLY call site of the PGRST204 guard could be replaced with a raw
// `{ gift_voucher_hint: value }`, the gift list could be deleted from every
// public profile, and the one-line row layout could be flipped back to the
// old stacked label — all three with the full suite green. The repo has no
// component test library, so these are comment-stripped source assertions on
// exactly that wiring; comments are stripped so none can satisfy them (KAN-459).
describe('KAN-443: the gift surfaces are wired to the guarded helpers', () => {
  const ROOT = resolve(__dirname, '../..');
  const stripComments = (src: string): string =>
    src
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const read = (rel: string) => stripComments(readFileSync(resolve(ROOT, rel), 'utf-8'));

  const section = read(`${SRC.profile}/sections/gift-extras-section.tsx`);
  const editor = read(SRC.editProfileForm);
  const itemsStep = read(SRC.itemsStep);
  const publicPage = read(SRC.slugPage);

  // The whole point of giftVoucherHintPayload is that the key never reaches a
  // payload when there is nothing to write. Bypassing it reintroduces PGRST204.
  test('the voucher hint is written through giftVoucherHintPayload, never a raw object', () => {
    expect(section).toContain('giftVoucherHintPayload(');
    expect(section).not.toMatch(/\{\s*gift_voucher_hint\s*:\s*value\s*\}/);
  });

  test('the gifts section renders one-line rows, not the old stacked label', () => {
    expect(editor).toMatch(/rowLayout:\s*'inline'/);
    expect(editor).toMatch(/rowLayout=\{s\.rowLayout\}/);
    expect(itemsStep).toMatch(/rowLayout\s*===\s*'inline'/);
  });

  test('the public profile still renders the gift list', () => {
    expect(publicPage).toContain('<GiftLines');
  });
});
