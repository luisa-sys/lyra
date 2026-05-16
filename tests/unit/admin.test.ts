/**
 * KAN-141: tests for the admin module shape.
 *
 * The admin module's behaviour is mostly hitting Supabase, which we
 * mock. These tests pin:
 *   - getCurrentAdmin returns null when there's no session
 *   - getCurrentAdmin returns null when the profile is_admin=false
 *   - getCurrentAdmin returns the admin record when is_admin=true
 *   - logModerationAction inserts a correctly-shaped row
 *   - logModerationAction throws when the insert fails (we don't swallow)
 */

// Mocks must be set up BEFORE any import of the module under test.
// `jest` is the global injected by ts-jest / @swc/jest — don't import
// it from @jest/globals or hoisting won't apply correctly.

jest.mock('@/lib/env', () => ({
  env: {
    supabaseUrl: () => 'https://test.supabase.co',
    supabaseServiceRoleKey: () => 'test-service-role-key',
  },
}));

const authGetUser = jest.fn();
const fromMock = jest.fn();
jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: authGetUser },
    from: fromMock,
  })),
}));

const serviceFromMock = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: serviceFromMock })),
}));

import { getCurrentAdmin, logModerationAction } from '@/lib/admin';

beforeEach(() => {
  authGetUser.mockReset();
  fromMock.mockReset();
  serviceFromMock.mockReset();
});

describe('KAN-141 admin — getCurrentAdmin', () => {
  test('returns null when no auth session', async () => {
    authGetUser.mockResolvedValue({ data: { user: null } });
    expect(await getCurrentAdmin()).toBeNull();
  });

  test('returns null when profile.is_admin = false', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } } });
    const mockEq = jest.fn().mockReturnThis();
    const mockMaybeSingle = jest.fn().mockResolvedValue({
      data: { id: 'p1', display_name: 'Alice', is_admin: false },
      error: null,
    });
    fromMock.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: mockEq,
      maybeSingle: mockMaybeSingle,
    });
    expect(await getCurrentAdmin()).toBeNull();
  });

  test('returns the admin record when is_admin = true', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'admin@b.com' } } });
    fromMock.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: 'p1', display_name: 'Admin', is_admin: true },
        error: null,
      }),
    });

    const admin = await getCurrentAdmin();
    expect(admin).toEqual({
      userId: 'u1',
      profileId: 'p1',
      email: 'admin@b.com',
      displayName: 'Admin',
    });
  });

  test('returns null when the profile lookup errors', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: null } } });
    fromMock.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'rls denied' },
      }),
    });
    expect(await getCurrentAdmin()).toBeNull();
  });
});

describe('KAN-141 admin — logModerationAction', () => {
  const admin = {
    userId: 'admin-u',
    profileId: 'admin-p',
    email: 'admin@b.com',
    displayName: 'Admin',
  };

  test('inserts a moderation_logs row with the expected shape', async () => {
    const insertMock = jest.fn().mockReturnThis();
    const selectMock = jest.fn().mockReturnThis();
    const singleMock = jest.fn().mockResolvedValue({ data: { id: 'log-1' }, error: null });
    serviceFromMock.mockReturnValue({
      insert: insertMock,
      select: selectMock,
      single: singleMock,
    });

    const id = await logModerationAction({
      admin,
      action: 'suspend',
      targetProfileId: 'target-p',
      reason: 'spam',
      metadata: { reportId: 'r-1' },
    });

    expect(id).toBe('log-1');
    expect(serviceFromMock).toHaveBeenCalledWith('moderation_logs');
    expect(insertMock).toHaveBeenCalledWith({
      actor_user_id: 'admin-u',
      action: 'suspend',
      target_profile_id: 'target-p',
      target_item_id: null,
      reason: 'spam',
      metadata: { reportId: 'r-1' },
    });
  });

  test('throws when the insert fails (we never swallow audit failures)', async () => {
    serviceFromMock.mockReturnValue({
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { message: 'rls denied' } }),
    });

    await expect(logModerationAction({
      admin,
      action: 'suspend',
      targetProfileId: 'target-p',
    })).rejects.toThrow(/moderation_logs/);
  });

  test('handles missing optional fields cleanly', async () => {
    const insertMock = jest.fn().mockReturnThis();
    serviceFromMock.mockReturnValue({
      insert: insertMock,
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: 'log-2' }, error: null }),
    });

    await logModerationAction({ admin, action: 'warn' });

    expect(insertMock).toHaveBeenCalledWith({
      actor_user_id: 'admin-u',
      action: 'warn',
      target_profile_id: null,
      target_item_id: null,
      reason: null,
      metadata: {},
    });
  });
});
