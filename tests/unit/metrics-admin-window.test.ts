/**
 * BUGS-71: the admin monitoring dashboard reads window metrics through the
 * SERVICE-ROLE client, because `get_metrics_for_window` is EXECUTE-able only by
 * `service_role` since the BUGS-44 / SEC-07 (F-14) lockdown. These tests pin
 * that contract so a future refactor can't silently route it back through the
 * anon SSR client (which throws 42501 -> the page renders "data unavailable").
 */

const rpcSpy = jest.fn();
const serviceClientSpy = jest.fn(() => ({ rpc: rpcSpy }));
const anonCreateClientSpy = jest.fn();

jest.mock('@/modules/platform/supabase-service', () => ({
  createServiceRoleClient: () => serviceClientSpy(),
}));

// metrics.ts imports createClient from supabase-server at module load; mock it
// both to prove getAnomalyWindowAdmin never touches it AND to avoid pulling in
// next/headers (cookies) in the node test env.
jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: (...args: unknown[]) => anonCreateClientSpy(...args),
}));

import { getAnomalyWindowAdmin } from '@/lib/metrics';

const SNAPSHOT = {
  profile_signups: 3,
  profile_publishes: 1,
  profile_items_added: 7,
  reports_filed: 0,
  window_start_at: '2026-07-25T00:00:00.000Z',
  window_end_at: '2026-07-25T01:00:00.000Z',
};

describe('getAnomalyWindowAdmin (BUGS-71 service-role metrics read)', () => {
  beforeEach(() => {
    rpcSpy.mockReset();
    serviceClientSpy.mockClear();
    anonCreateClientSpy.mockClear();
  });

  it('reads via the service-role client, never the anon SSR client', async () => {
    rpcSpy.mockResolvedValue({ data: SNAPSHOT, error: null });
    await getAnomalyWindowAdmin('24h');
    expect(serviceClientSpy).toHaveBeenCalledTimes(1);
    expect(anonCreateClientSpy).not.toHaveBeenCalled();
  });

  it('calls get_metrics_for_window with ISO window bounds and returns the snapshot', async () => {
    rpcSpy.mockResolvedValue({ data: SNAPSHOT, error: null });
    const result = await getAnomalyWindowAdmin('1h');
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const [fn, args] = rpcSpy.mock.calls[0] as [string, { p_start_at: string; p_end_at: string }];
    expect(fn).toBe('get_metrics_for_window');
    expect(typeof args.p_start_at).toBe('string');
    expect(typeof args.p_end_at).toBe('string');
    // 1h window: end - start === 3_600_000 ms
    const delta = new Date(args.p_end_at).getTime() - new Date(args.p_start_at).getTime();
    expect(delta).toBe(60 * 60 * 1000);
    expect(result).toEqual(SNAPSHOT);
  });

  it('throws on an RPC error (e.g. permission denied) so safeWindow can degrade to "data unavailable"', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { message: 'permission denied for function get_metrics_for_window' },
    });
    await expect(getAnomalyWindowAdmin('7d')).rejects.toThrow(/permission denied/);
  });
});
