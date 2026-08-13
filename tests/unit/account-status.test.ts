/**
 * SEC-57: unit tests for the account-standing helper used to refuse credential
 * issuance for suspended (or unverifiable) accounts.
 *
 * Covers the tri-state contract and the fail-closed predicate:
 *   - is_suspended === true            -> 'suspended'
 *   - is_suspended === false / absent  -> 'ok'
 *   - lookup error                     -> 'unknown'   (fail closed for mints)
 *   - no profile row                   -> 'unknown'   (fail closed for mints)
 *   - shouldRefuseIssuance refuses on anything but 'ok'
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccountStanding, shouldRefuseIssuance } from '@/modules/access/account-status';

/** Build a minimal supabase-shaped client whose profiles read resolves to `res`. */
function clientReturning(res: { data: unknown; error: unknown }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(res),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe('SEC-57 getAccountStanding', () => {
  test('returns "suspended" when is_suspended is true', async () => {
    const c = clientReturning({ data: { is_suspended: true }, error: null });
    await expect(getAccountStanding(c, 'user-1')).resolves.toBe('suspended');
  });

  test('returns "ok" when is_suspended is false', async () => {
    const c = clientReturning({ data: { is_suspended: false }, error: null });
    await expect(getAccountStanding(c, 'user-1')).resolves.toBe('ok');
  });

  test('returns "ok" when is_suspended is absent/null (not positively suspended)', async () => {
    const c = clientReturning({ data: { is_suspended: null }, error: null });
    await expect(getAccountStanding(c, 'user-1')).resolves.toBe('ok');
  });

  test('returns "unknown" on a lookup error (fail closed)', async () => {
    const c = clientReturning({ data: null, error: { message: 'pgrst timeout' } });
    await expect(getAccountStanding(c, 'user-1')).resolves.toBe('unknown');
  });

  test('returns "unknown" when no profile row exists (fail closed)', async () => {
    const c = clientReturning({ data: null, error: null });
    await expect(getAccountStanding(c, 'user-1')).resolves.toBe('unknown');
  });

  test('queries profiles by the passed user id', async () => {
    const eqSpy = jest.fn(() => ({ maybeSingle: () => Promise.resolve({ data: { is_suspended: false }, error: null }) }));
    const selectSpy = jest.fn(() => ({ eq: eqSpy }));
    const fromSpy = jest.fn(() => ({ select: selectSpy }));
    const c = { from: fromSpy } as unknown as SupabaseClient;
    await getAccountStanding(c, 'user-xyz');
    expect(fromSpy).toHaveBeenCalledWith('profiles');
    expect(selectSpy).toHaveBeenCalledWith('is_suspended');
    expect(eqSpy).toHaveBeenCalledWith('user_id', 'user-xyz');
  });
});

describe('SEC-57 shouldRefuseIssuance (fail closed)', () => {
  test('refuses when suspended', () => {
    expect(shouldRefuseIssuance('suspended')).toBe(true);
  });
  test('refuses when unknown', () => {
    expect(shouldRefuseIssuance('unknown')).toBe(true);
  });
  test('allows only when ok', () => {
    expect(shouldRefuseIssuance('ok')).toBe(false);
  });
});
