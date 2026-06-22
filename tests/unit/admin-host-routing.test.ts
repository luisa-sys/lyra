/**
 * KAN-309 / KAN-312: middleware host routing for admin.checklyra.com.
 *
 * Verifies the three behaviours that keep the admin tools isolated to the
 * subdomain WITHOUT breaking the main app — and that the whole thing is inert
 * until ADMIN_HOST_ENFORCED=true (non-breaking rollout).
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    }),
  }),
}));

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

function get(host: string, path: string): NextRequest {
  return new NextRequest(new URL(`https://${host}${path}`), {
    headers: { host },
  });
}

describe('admin host routing (KAN-312)', () => {
  afterEach(() => {
    delete process.env.ADMIN_HOST_ENFORCED;
    delete process.env.ADMIN_HOST;
  });

  it('is inert when enforcement is off (no rewrite of /admin on the admin host)', async () => {
    const res = await middleware(get('admin.checklyra.com', '/users'));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('location')).toBeNull();
  });

  it('rewrites non-/admin paths to /admin/* on the admin host when enforced', async () => {
    process.env.ADMIN_HOST_ENFORCED = 'true';
    const res = await middleware(get('admin.checklyra.com', '/users'));
    const rewrite = res.headers.get('x-middleware-rewrite');
    expect(rewrite).not.toBeNull();
    expect(new URL(rewrite as string).pathname).toBe('/admin/users');
  });

  it('rewrites the admin-host root to /admin when enforced', async () => {
    process.env.ADMIN_HOST_ENFORCED = 'true';
    const res = await middleware(get('admin.checklyra.com', '/'));
    expect(new URL(res.headers.get('x-middleware-rewrite') as string).pathname).toBe('/admin');
  });

  it('redirects /admin on a non-admin host to the admin subdomain when enforced', async () => {
    process.env.ADMIN_HOST_ENFORCED = 'true';
    const res = await middleware(get('checklyra.com', '/admin/users'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://admin.checklyra.com/admin/users');
  });

  it('does not block /admin on the main host when enforcement is off', async () => {
    const res = await middleware(get('checklyra.com', '/admin/users'));
    expect(res.headers.get('location')).toBeNull();
  });
});
