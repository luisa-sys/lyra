/**
 * KAN-309 follow-on: setFeatureEntitlement admin action contract.
 */
import { setFeatureEntitlement } from '@/app/admin/users/actions';

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

const mockGetCurrentAdmin = jest.fn();
const mockUpsert = jest.fn();
const mockLog = jest.fn();

jest.mock('@/lib/admin', () => ({
  getCurrentAdmin: () => mockGetCurrentAdmin(),
  getAdminServiceClient: () => ({
    from: () => ({ upsert: (...a: unknown[]) => mockUpsert(...a) }),
  }),
  logModerationAction: (...a: unknown[]) => mockLog(...a),
  logModerationActionsBatch: jest.fn(),
}));

jest.mock('@/lib/supabase-server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/beta-access/email', () => ({ sendBetaApprovedEmail: jest.fn() }));

const ADMIN = { userId: 'admin-user', profileId: 'admin-profile', email: 'a@a.com', displayName: 'A' };

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  Object.entries(obj).forEach(([k, v]) => f.set(k, v));
  return f;
}

describe('setFeatureEntitlement (KAN-309)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentAdmin.mockResolvedValue(ADMIN);
    mockUpsert.mockResolvedValue({ error: null });
    mockLog.mockResolvedValue('log-id');
  });

  it('rejects non-admins with no mutation', async () => {
    mockGetCurrentAdmin.mockResolvedValue(null);
    await expect(setFeatureEntitlement(fd({ profileId: 'p1', featureKey: 'convene', enabled: 'true' }))).rejects.toThrow('Not authorised');
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('rejects an unknown feature key', async () => {
    await expect(setFeatureEntitlement(fd({ profileId: 'p1', featureKey: 'hack', enabled: 'true' }))).rejects.toThrow('Invalid feature toggle');
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('enable: audits enable_feature and upserts enabled=true with granted_by', async () => {
    await setFeatureEntitlement(fd({ profileId: 'p1', featureKey: 'convene', enabled: 'true', slug: 'x' }));
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'enable_feature', targetProfileId: 'p1', metadata: { feature_key: 'convene' } }),
    );
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ profile_id: 'p1', feature_key: 'convene', enabled: true, granted_by: ADMIN.profileId }),
      { onConflict: 'profile_id,feature_key' },
    );
  });

  it('disable: audits disable_feature and upserts enabled=false', async () => {
    await setFeatureEntitlement(fd({ profileId: 'p1', featureKey: 'mcp', enabled: 'false', slug: 'x' }));
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'disable_feature' }));
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ feature_key: 'mcp', enabled: false }),
      { onConflict: 'profile_id,feature_key' },
    );
  });

  it('throws if the upsert fails (no silent success)', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'db down' } });
    await expect(setFeatureEntitlement(fd({ profileId: 'p1', featureKey: 'convene', enabled: 'true' }))).rejects.toThrow('Could not update feature');
  });
});
