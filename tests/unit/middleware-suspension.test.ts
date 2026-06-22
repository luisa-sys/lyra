/**
 * KAN-319: suspended users are redirected to /suspended on authenticated
 * navigation (the public profile is already hidden by RLS; this blocks the app).
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

let mockUser: { id: string } | null = { id: 'user-1' };
let mockSuspended = false;

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: mockUser } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { is_suspended: mockSuspended } }) }),
      }),
    }),
  }),
}));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

function get(path: string): NextRequest {
  return new NextRequest(new URL(`https://checklyra.com${path}`), {
    headers: { host: 'checklyra.com' },
  });
}

describe('suspended-user gate (KAN-319)', () => {
  beforeEach(() => {
    mockUser = { id: 'user-1' };
    mockSuspended = false;
    delete process.env.IS_BETA_DEPLOY;
    delete process.env.ADMIN_HOST_ENFORCED;
  });

  it('redirects a suspended user to /suspended', async () => {
    mockSuspended = true;
    const res = await middleware(get('/dashboard'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') as string).pathname).toBe('/suspended');
  });

  it('does not loop on the /suspended page itself', async () => {
    mockSuspended = true;
    const res = await middleware(get('/suspended'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('lets a non-suspended user through', async () => {
    mockSuspended = false;
    const res = await middleware(get('/dashboard'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('ignores anonymous visitors (no suspension lookup)', async () => {
    mockUser = null;
    const res = await middleware(get('/'));
    expect(res.headers.get('location')).toBeNull();
  });
});
