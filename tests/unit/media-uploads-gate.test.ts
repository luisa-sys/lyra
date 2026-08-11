/**
 * KAN-414 F4 (KAN-417 §8 group 2) — the behavioural replacement for the
 * "media_uploads gate covers BOTH upload entrypoints" text scan that used to
 * live in tests/unit/feature-entitlements.test.ts.
 *
 * THE INVARIANT, IN WORDS
 * -----------------------
 * `media_uploads` is scoped to "Profile photo & file/media uploads". When an
 * admin revokes it, BOTH upload entrypoints must refuse — `uploadProfileFile`
 * AND `uploadAvatar` — and each must refuse BEFORE touching storage. A revoke
 * that stops only one path is a half-effective admin action, and the half that
 * still works is the one nobody tests.
 *
 * WHAT THE OLD TEST DID, AND WHY THIS IS STRONGER
 * ----------------------------------------------
 * The old block regexed the source of both files for `getMyFeatureEntitlements`
 * and compared string indices to guess that the gate preceded the upload. That
 * passes if the identifier merely appears — in a comment, in dead code, in a
 * function that is never called. It also breaks on any file move, which is what
 * F4 exists to end.
 *
 * This executes both actions with the entitlement revoked and asserts the
 * refusal, then asserts storage was never reached. It also runs each with the
 * entitlement GRANTED and asserts the action proceeds past the gate to fail at
 * the next check — which is what proves the earlier refusal came from the gate
 * and not from some unrelated guard upstream.
 *
 * MUTATION PROOF (KAN-417 §8 group 2, required before the text block is deleted)
 * ------------------------------------------------------------------------------
 * Deleting the `if (!features.media_uploads)` block from files-actions.ts turns
 * "refuses ... before touching storage" red; deleting it from actions.ts turns
 * the uploadAvatar case red. Both were confirmed 2026-07-31 and reverted.
 */
import { uploadProfileFile } from '@/app/dashboard/profile/files-actions';
import { uploadAvatar } from '@/app/dashboard/profile/actions';
import { getMyFeatureEntitlements } from '@/modules/features/entitlements';

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

jest.mock('@/modules/guards/profile-rate-limit', () => ({
  checkProfileWriteRateLimit: jest.fn(async () => ({ allowed: true })),
}));

const storageFrom = jest.fn(() => ({ upload: jest.fn() }));

jest.mock('@/modules/platform/supabase-server', () => ({
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

jest.mock('@/modules/features/entitlements', () => ({
  getMyFeatureEntitlements: jest.fn(),
}));

const mockedEntitlements = getMyFeatureEntitlements as jest.MockedFunction<
  typeof getMyFeatureEntitlements
>;

const REVOKED = {
  media_uploads: false,
  discovery: true,
  mcp: false,
  convene: false,
  paid_gift_links: false,
  convene_paid_channels: false,
} as const;
const GRANTED = { ...REVOKED, media_uploads: true } as const;

describe('media_uploads gate — uploadProfileFile (behavioural)', () => {
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

describe('media_uploads gate — uploadAvatar (behavioural)', () => {
  // The second entrypoint. The text scan this replaces covered BOTH, so
  // omitting this would quietly halve the coverage while looking like a
  // modernisation.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refuses when media_uploads is revoked, before touching storage', async () => {
    mockedEntitlements.mockResolvedValue(REVOKED);

    const result = await uploadAvatar(new FormData());

    expect(result).toEqual({
      success: false,
      error: 'Media uploads are not enabled for your account.',
    });
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it('proceeds past the gate when media_uploads is granted', async () => {
    mockedEntitlements.mockResolvedValue(GRANTED);

    // Empty FormData: with the gate open the action reaches file validation and
    // fails there instead. That is what proves the previous refusal came from
    // the entitlement gate rather than from some unrelated guard upstream.
    const result = await uploadAvatar(new FormData());

    // Avoid narrowing gymnastics on the ActionResult union: assert it failed,
    // and that it did NOT fail with the gate's message. That is the whole
    // claim — the refusal in the previous case came from the gate, not from
    // whatever check happens to run next.
    expect(result.success).toBe(false);
    expect(result).not.toEqual({
      success: false,
      error: 'Media uploads are not enabled for your account.',
    });
    expect(storageFrom).not.toHaveBeenCalled();
  });
});
