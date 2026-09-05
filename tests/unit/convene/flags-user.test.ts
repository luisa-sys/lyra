/**
 * KAN-408: the per-user Convene gate now ANDs the environment global switch:
 *   available  IFF  CONVENE_ENABLED  AND  global 'convene' switch on  AND  user entitled.
 */
import { isConveneEnabledForCurrentUser } from '@/lib/convene/flags-user';

const mockIsConveneEnabled = jest.fn();
const mockGetMyEntitlements = jest.fn();
const mockIsGloballyEnabled = jest.fn();

jest.mock('@/lib/convene/flags', () => ({ isConveneEnabled: () => mockIsConveneEnabled() }));
jest.mock('@/modules/features/entitlements', () => ({
  getMyFeatureEntitlements: () => mockGetMyEntitlements(),
}));
jest.mock('@/modules/features/global-switches-service', () => ({
  isFeatureGloballyEnabled: (...a: unknown[]) => mockIsGloballyEnabled(...a),
}));

describe('isConveneEnabledForCurrentUser (KAN-408 AND semantics)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsConveneEnabled.mockReturnValue(true);
    mockIsGloballyEnabled.mockResolvedValue(true);
    mockGetMyEntitlements.mockResolvedValue({ convene: true });
  });

  it('true when env flag on AND global switch on AND user entitled', async () => {
    await expect(isConveneEnabledForCurrentUser()).resolves.toBe(true);
    expect(mockIsGloballyEnabled).toHaveBeenCalledWith('convene');
  });

  it('false when the env flag is off — never reads global switch or entitlement', async () => {
    mockIsConveneEnabled.mockReturnValue(false);
    await expect(isConveneEnabledForCurrentUser()).resolves.toBe(false);
    expect(mockIsGloballyEnabled).not.toHaveBeenCalled();
    expect(mockGetMyEntitlements).not.toHaveBeenCalled();
  });

  it('false when the global switch is off, even if entitled — never reads entitlement', async () => {
    mockIsGloballyEnabled.mockResolvedValue(false);
    await expect(isConveneEnabledForCurrentUser()).resolves.toBe(false);
    expect(mockGetMyEntitlements).not.toHaveBeenCalled();
  });

  it('false when env + global on but the user is not entitled', async () => {
    mockGetMyEntitlements.mockResolvedValue({ convene: false });
    await expect(isConveneEnabledForCurrentUser()).resolves.toBe(false);
  });
});
