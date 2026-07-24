/**
 * KAN-277 — /admin/beta-queue page gating.
 *
 *   - non-admin (getCurrentAdmin → null) → notFound() (404).
 *   - admin → renders, loading the 'requested' queue ordered by request time.
 *
 * We mock next/navigation so notFound() throws (assertable), and stub the
 * admin service client so loadQueue resolves.
 */

const mockNotFound = jest.fn(() => {
  throw new Error('NOT_FOUND');
});
jest.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
  redirect: jest.fn(),
}));

const mockGetCurrentAdmin = jest.fn();

// Records the filter/order applied to the profiles query so we can assert the
// page queries the queue correctly.
const queryCapture: { eq?: [string, string]; order?: [string, unknown] } = {};
const getUserByIdMock = jest.fn();

function fakeServiceClient() {
  const builder = {
    select: () => builder,
    eq: (col: string, val: string) => {
      queryCapture.eq = [col, val];
      return builder;
    },
    order: (col: string, opts: unknown) => {
      queryCapture.order = [col, opts];
      return Promise.resolve({ data: [] });
    },
  };
  return {
    from: () => builder,
    auth: { admin: { getUserById: getUserByIdMock } },
  };
}

jest.mock('@/lib/admin', () => ({
  getCurrentAdmin: () => mockGetCurrentAdmin(),
  getAdminServiceClient: () => fakeServiceClient(),
}));

import BetaQueuePage from '@/app/admin/beta-queue/page';

beforeEach(() => {
  mockNotFound.mockClear();
  mockGetCurrentAdmin.mockReset();
  getUserByIdMock.mockReset();
  queryCapture.eq = undefined;
  queryCapture.order = undefined;
});

describe('KAN-277 BetaQueuePage gating', () => {
  test('calls notFound() for a non-admin', async () => {
    mockGetCurrentAdmin.mockResolvedValue(null);
    await expect(BetaQueuePage()).rejects.toThrow('NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  test('renders for an admin and queries the requested queue by request time', async () => {
    mockGetCurrentAdmin.mockResolvedValue({
      userId: 'u',
      profileId: 'p',
      email: 'a@b.com',
      displayName: 'Admin',
    });
    const result = await BetaQueuePage();
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(result).toBeTruthy();
    // The queue query filters status='requested' and orders by beta_requested_at asc.
    expect(queryCapture.eq).toEqual(['beta_access_status', 'requested']);
    expect(queryCapture.order).toEqual([
      'beta_requested_at',
      { ascending: true },
    ]);
  });
});
