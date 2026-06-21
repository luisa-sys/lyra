/**
 * SEC-18 (F-07) — tests for the busy-time sharing opt-in action.
 */

const mockRevalidatePath = jest.fn();
jest.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a) }));

let mockUserId: string | null = 'u1';
let updateError: unknown = null;
const captured = { updates: [] as Record<string, unknown>[] };

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: jest.fn(async () => ({ data: { user: mockUserId ? { id: mockUserId } : null } })) },
    from: jest.fn(() => ({
      update: (vals: Record<string, unknown>) => {
        captured.updates.push(vals);
        const c: Record<string, unknown> = {};
        c.eq = () => c;
        c.then = (r: (v: unknown) => unknown) => r({ error: updateError });
        return c;
      },
    })),
  })),
}));

import { setAvailabilitySharing } from '@/app/dashboard/convene/connections/availability-actions';

beforeEach(() => {
  mockUserId = 'u1';
  updateError = null;
  captured.updates = [];
  mockRevalidatePath.mockClear();
});

describe('setAvailabilitySharing', () => {
  test('opting in writes the flag true and revalidates', async () => {
    const res = await setAvailabilitySharing(true);
    expect(res).toEqual({ ok: true });
    expect(captured.updates[0].share_availability_with_contacts).toBe(true);
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/convene/connections');
  });

  test('opting out writes the flag false', async () => {
    const res = await setAvailabilitySharing(false);
    expect(res).toEqual({ ok: true });
    expect(captured.updates[0].share_availability_with_contacts).toBe(false);
  });

  test('rejects unauthenticated callers', async () => {
    mockUserId = null;
    const res = await setAvailabilitySharing(true);
    expect(res.ok).toBe(false);
    expect(captured.updates).toHaveLength(0);
  });

  test('surfaces a generic error on db failure', async () => {
    updateError = { message: 'boom' };
    const res = await setAvailabilitySharing(true);
    expect(res.ok).toBe(false);
  });
});
