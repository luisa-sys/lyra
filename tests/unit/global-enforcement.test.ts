/**
 * KAN-408: the global feature switch is wired into the ACTUAL enforcement gates
 * (not just admin UI) for age verification, paid referrals, and MCP key issuance.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mockGloballyEnabled = jest.fn();
jest.mock('@/modules/features/global-switches-service', () => ({
  isFeatureGloballyEnabled: (...a: unknown[]) => mockGloballyEnabled(...a),
}));

import { isPaidLinksAllowedForRecipient } from '@/modules/features/entitlements-service';
import { SRC } from '../support/source-paths';

describe('paid referrals — global switch enforcement (KAN-408)', () => {
  const OLD = process.env.PAID_LINKS_COMPLIANCE_READY;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAID_LINKS_COMPLIANCE_READY = 'true'; // get past the compliance gate
  });
  afterAll(() => {
    if (OLD === undefined) delete process.env.PAID_LINKS_COMPLIANCE_READY;
    else process.env.PAID_LINKS_COMPLIANCE_READY = OLD;
  });

  it('off globally → not allowed, even with a recipient and compliance ready', async () => {
    mockGloballyEnabled.mockResolvedValue(false);
    await expect(isPaidLinksAllowedForRecipient('recipient-1')).resolves.toBe(false);
    expect(mockGloballyEnabled).toHaveBeenCalledWith('paid_gift_links');
  });

  it('fails closed on a missing recipient before touching the switch', async () => {
    await expect(isPaidLinksAllowedForRecipient(null)).resolves.toBe(false);
    expect(mockGloballyEnabled).not.toHaveBeenCalled();
  });
});

describe('enforcement wiring is present at each gate (KAN-408)', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf-8');

  it('age: BOTH web publish paths gate on the provider age check (global switch)', () => {
    const actions = read(SRC.profileActions);
    expect(
      (actions.match(/isProviderAgeCheckActive\(\)/g) || []).length,
    ).toBeGreaterThanOrEqual(2);
    // and the provider gate itself is keyed on the age_verification global switch
    const gate = read(SRC.providerGate);
    expect(gate).toMatch(/isFeatureGloballyEnabled\('age_verification'\)/);
  });

  it('paid: the recipient gate ANDs the global paid_gift_links switch', () => {
    const svc = read(SRC.entitlementsService);
    expect(svc).toMatch(/isFeatureGloballyEnabled\('paid_gift_links'\)/);
  });

  it('mcp: API-key generation gates on the global mcp switch', () => {
    const settings = read(SRC.settingsActions);
    expect(settings).toMatch(/isFeatureGloballyEnabled\('mcp'\)/);
  });
});
