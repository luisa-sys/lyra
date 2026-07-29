/**
 * KAN-417 — worked proof-of-concept for a category-(b) conversion.
 *
 * Behavioural equivalent of the text-scan block in
 * tests/unit/feature-entitlements.test.ts ("media_uploads gate covers BOTH
 * upload entrypoints"). That block asserts, by regexing the source of
 * files-actions.ts, that uploadProfileFile calls getMyFeatureEntitlements and
 * checks media_uploads before the storage upload.
 *
 * Invariant, stated behaviourally: an authenticated caller whose
 * media_uploads entitlement resolves to false is refused by
 * uploadProfileFile before any storage interaction; a caller whose
 * entitlement is true proceeds past the gate.
 *
 * The original text-scan test is NOT modified or removed here — under the
 * Test Integrity Policy that swap happens only in F4, after founder sign-off.
 * This file is additive evidence for the KAN-417 sign-off request.
 */
import { uploadProfileFile } from '@/app/dashboard/profile/files-actions';
import { getMyFeatureEntitlements } from '@/lib/features/entitlements';

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

jest.mock('@/lib/profile-rate-limit', () => ({
  checkProfileWriteRateLimit: jest.fn(async () => ({ allowed: true })),
}));

const storageFrom = jest.fn(() => ({ upload: jest.fn() }));

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'user-1' } } })) },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(async () => ({ data: { id: 'profile-1' } })),
        })),
      })),
    })),
    storage: { from: storageFrom },
  })),
}));

jest.mock('@/lib/features/entitlements', () => ({
  getMyFeatureEntitlements: jest.fn(),
}));

const mockedEntitlements = getMyFeatureEntitlements as jest.MockedFunction<
  typeof getMyFeatureEntitlements
>;

describe('KAN-417 PoC: uploadProfileFile media_uploads gate (behavioural)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refuses when media_uploads is revoked, before touching storage', async () => {
    mockedEntitlements.mockResolvedValue({
      media_uploads: false,
      discovery: true,
      mcp: false,
      convene: false,
      paid_gift_links: false,
      convene_paid_channels: false,
    });

    const result = await uploadProfileFile(new FormData());

    expect(result).toEqual({
      success: false,
      error: 'Media uploads are not enabled for your account.',
    });
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it('proceeds past the gate when media_uploads is granted', async () => {
    mockedEntitlements.mockResolvedValue({
      media_uploads: true,
      discovery: true,
      mcp: false,
      convene: false,
      paid_gift_links: false,
      convene_paid_channels: false,
    });

    // Empty FormData: with the gate open the action reaches file validation
    // and fails there instead — proving the entitlement gate was the refusal
    // in the previous test, not some other check.
    const result = await uploadProfileFile(new FormData());

    expect(result).toEqual({ success: false, error: 'No file supplied' });
  });
});
