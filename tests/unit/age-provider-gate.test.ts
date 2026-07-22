/**
 * KAN-408: provider age-verification gate (keyed on the global switch).
 */
const mockGlobally = jest.fn();
jest.mock('@/lib/features/global-switches-service', () => ({
  isFeatureGloballyEnabled: (...a: unknown[]) => mockGlobally(...a),
}));

import { passedProviderAgeCheck, isProviderAgeCheckActive } from '@/lib/age/provider-gate';

describe('provider-gate (KAN-408)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passedProviderAgeCheck is true ONLY for status "passed"', () => {
    expect(passedProviderAgeCheck('passed')).toBe(true);
    for (const s of ['none', 'pending', 'failed', 'manual_review', '', null, undefined]) {
      expect(passedProviderAgeCheck(s)).toBe(false);
    }
  });

  it('isProviderAgeCheckActive delegates to the age_verification global switch', async () => {
    mockGlobally.mockResolvedValue(true);
    await expect(isProviderAgeCheckActive()).resolves.toBe(true);
    expect(mockGlobally).toHaveBeenCalledWith('age_verification');

    mockGlobally.mockResolvedValue(false);
    await expect(isProviderAgeCheckActive()).resolves.toBe(false);
  });
});
