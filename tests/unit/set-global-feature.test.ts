/**
 * KAN-408: setGlobalFeature admin action contract.
 */
import { setGlobalFeature } from '@/app/admin/features/actions';

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

const mockGetCurrentAdmin = jest.fn();
const mockUpsert = jest.fn();
const mockLog = jest.fn();

jest.mock('@/modules/admin/admin', () => ({
  getCurrentAdmin: () => mockGetCurrentAdmin(),
  getAdminServiceClient: () => ({
    from: () => ({ upsert: (...a: unknown[]) => mockUpsert(...a) }),
  }),
  logModerationAction: (...a: unknown[]) => mockLog(...a),
}));

// Deterministic environment context: this "deployment" is dev, so only 'dev'
// is manageable. Keeps the real isDeployEnv shape.
jest.mock('@/modules/platform/deploy-env', () => ({
  isDeployEnv: (v: string) => ['dev', 'staging', 'beta', 'prod'].includes(v),
  manageableEnvironments: () => ['dev'],
  getDeployEnv: () => 'dev',
}));

const ADMIN = { userId: 'admin-user', profileId: 'admin-profile', email: 'a@a.com', displayName: 'A' };

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  Object.entries(obj).forEach(([k, v]) => f.set(k, v));
  return f;
}

describe('setGlobalFeature (KAN-408)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentAdmin.mockResolvedValue(ADMIN);
    mockUpsert.mockResolvedValue({ error: null });
    mockLog.mockResolvedValue('log-id');
  });

  it('rejects non-admins with no mutation', async () => {
    mockGetCurrentAdmin.mockResolvedValue(null);
    await expect(
      setGlobalFeature(fd({ environment: 'dev', featureKey: 'convene', enabled: 'false' })),
    ).rejects.toThrow('Not authorised');
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('rejects a feature key with no global switch (per-user-only key)', async () => {
    await expect(
      setGlobalFeature(fd({ environment: 'dev', featureKey: 'media_uploads', enabled: 'false' })),
    ).rejects.toThrow('Invalid feature key');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('rejects an environment this deployment cannot manage', async () => {
    await expect(
      setGlobalFeature(fd({ environment: 'prod', featureKey: 'convene', enabled: 'false' })),
    ).rejects.toThrow('not manageable');
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('rejects a malformed environment string', async () => {
    await expect(
      setGlobalFeature(fd({ environment: 'production', featureKey: 'convene', enabled: 'false' })),
    ).rejects.toThrow('not manageable');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('disable: audits disable_global_feature with env metadata and upserts enabled=false', async () => {
    await setGlobalFeature(fd({ environment: 'dev', featureKey: 'convene', enabled: 'false' }));
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'disable_global_feature',
        metadata: { feature_key: 'convene', environment: 'dev' },
      }),
    );
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'dev',
        feature_key: 'convene',
        enabled: false,
        updated_by: ADMIN.profileId,
      }),
      { onConflict: 'environment,feature_key' },
    );
  });

  it('enable: audits enable_global_feature and upserts enabled=true', async () => {
    await setGlobalFeature(fd({ environment: 'dev', featureKey: 'age_verification', enabled: 'true' }));
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'enable_global_feature' }),
    );
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ feature_key: 'age_verification', enabled: true }),
      { onConflict: 'environment,feature_key' },
    );
  });

  it('audits BEFORE mutating (audit-first)', async () => {
    const order: string[] = [];
    mockLog.mockImplementation(() => {
      order.push('log');
      return Promise.resolve('log-id');
    });
    mockUpsert.mockImplementation(() => {
      order.push('upsert');
      return Promise.resolve({ error: null });
    });
    await setGlobalFeature(fd({ environment: 'dev', featureKey: 'paid_gift_links', enabled: 'false' }));
    expect(order).toEqual(['log', 'upsert']);
  });

  it('throws if the upsert fails (no silent success)', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'db down' } });
    await expect(
      setGlobalFeature(fd({ environment: 'dev', featureKey: 'convene', enabled: 'false' })),
    ).rejects.toThrow('Could not update global feature switch');
  });
});
