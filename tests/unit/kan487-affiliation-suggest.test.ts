/**
 * KAN-487 — spec v0.8 §02 affiliation autocomplete from Lyra's own entries
 * (plan §B "Affiliation autocomplete RPC"). Drives the real
 * `suggestAffiliationNamesRpc` against a mocked `rpc`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { suggestAffiliationNamesRpc } from '@/modules/profile/affiliation-suggest';

function client(rpc: jest.Mock): SupabaseClient {
  return { rpc } as unknown as SupabaseClient;
}

describe('KAN-487 suggestAffiliationNamesRpc', () => {
  test('calls suggest_affiliation_names with the trimmed prefix and limit 8; returns names', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [{ name: 'Greenfield Primary' }, { name: ' Greenhill ' }], error: null });
    await expect(suggestAffiliationNamesRpc(client(rpc), 'school', '  Gre  ')).resolves.toEqual([
      'Greenfield Primary',
      'Greenhill',
    ]);
    expect(rpc).toHaveBeenCalledWith('suggest_affiliation_names', { p_type: 'school', p_prefix: 'Gre', p_limit: 8 });
  });

  test.each(['organisation', 'community'])('accepts type %s', async (type) => {
    const rpc = jest.fn().mockResolvedValue({ data: [{ name: 'Acme' }], error: null });
    await expect(suggestAffiliationNamesRpc(client(rpc), type, 'Acm')).resolves.toEqual(['Acme']);
  });

  const noCall: Array<[string, unknown, unknown]> = [
    ['a 2-character prefix', 'school', 'Gr'],
    ['a prefix that is 2 characters once trimmed', 'school', '  Gr  '],
    ['an empty prefix', 'school', ''],
    ['a non-string prefix', 'school', 123],
    ['an unknown type', 'club', 'Greenfield'],
    ['a missing type', undefined, 'Greenfield'],
  ];

  test('the no-call corpus is non-empty', () => {
    expect(noCall.length).toBeGreaterThan(0);
  });

  test.each(noCall)('%s → [] without calling the RPC', async (_label, type, prefix) => {
    const rpc = jest.fn();
    await expect(suggestAffiliationNamesRpc(client(rpc), type, prefix)).resolves.toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  test('an RPC error → []', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'permission denied', code: '42501' } });
    await expect(suggestAffiliationNamesRpc(client(rpc), 'school', 'Greenfield')).resolves.toEqual([]);
  });

  test('an RPC that throws → []', async () => {
    const rpc = jest.fn().mockRejectedValue(new Error('network'));
    await expect(suggestAffiliationNamesRpc(client(rpc), 'school', 'Greenfield')).resolves.toEqual([]);
  });

  test('blank or non-string names are dropped', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [{ name: '' }, { name: null }, {}, { name: 'Real' }], error: null });
    await expect(suggestAffiliationNamesRpc(client(rpc), 'school', 'Rea')).resolves.toEqual(['Real']);
  });
});
