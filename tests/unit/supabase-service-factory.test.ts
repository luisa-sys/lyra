/**
 * KAN-352 (finding web-arch-4): the ONE hardened service-role client factory.
 *
 * These tests pin the factory's contract so the ~30 call sites it centralises
 * all inherit the same hardened options:
 *   - it constructs against the service-role URL + key (bypasses RLS)
 *   - it bakes in auth.persistSession=false + autoRefreshToken=false
 *   - it returns a fresh client each call (no shared mutable singleton)
 */

const createClientSpy = jest.fn((..._args: unknown[]) => ({ __client: true }));

jest.mock('@/modules/platform/env', () => ({
  env: {
    supabaseUrl: () => 'https://svc.supabase.co',
    supabaseServiceRoleKey: () => 'service-role-key',
  },
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientSpy(...args),
}));

import { createServiceRoleClient } from '@/modules/platform/supabase-service';

describe('createServiceRoleClient (KAN-352 hardened factory)', () => {
  beforeEach(() => {
    createClientSpy.mockClear();
  });

  it('constructs with the service-role URL and key', () => {
    createServiceRoleClient();
    expect(createClientSpy).toHaveBeenCalledTimes(1);
    const [url, key] = createClientSpy.mock.calls[0];
    expect(url).toBe('https://svc.supabase.co');
    expect(key).toBe('service-role-key');
  });

  it('bakes in the hardened auth options (no session persistence, no auto-refresh)', () => {
    createServiceRoleClient();
    const options = createClientSpy.mock.calls[0][2] as {
      auth: { persistSession: boolean; autoRefreshToken: boolean };
    };
    expect(options.auth.persistSession).toBe(false);
    expect(options.auth.autoRefreshToken).toBe(false);
  });

  it('returns a fresh client on each call (no shared singleton)', () => {
    createServiceRoleClient();
    createServiceRoleClient();
    expect(createClientSpy).toHaveBeenCalledTimes(2);
  });
});
