/**
 * SEC-112 — `publishProfile()` must write `is_published` on the SERVICE-ROLE
 * client, and must not write it at all when the age gate blocks.
 *
 * WHY THIS TEST IS THE LOAD-BEARING ONE
 * -------------------------------------
 * SEC-112 has two halves that are only safe together:
 *
 *   1. a BEFORE UPDATE trigger refusing any `is_published` change from a caller
 *      carrying a JWT (`profiles_block_is_published_self_set`), and
 *   2. this action writing `is_published` on a credential that has no JWT.
 *
 * Half 1 without half 2 does not merely fail to protect — it BREAKS PROFILE
 * PUBLISHING FOR EVERY USER IN EVERY ENVIRONMENT, because before SEC-112 this
 * write used `createClient()`, which is the anon key carrying the end user's
 * session JWT. That is the BUGS-60 over-revoking failure mode, and the ticket's
 * own implementation plan asserted the opposite ("it runs through server actions
 * on a service-role client") — the premise was wrong, and building to it would
 * have shipped the outage.
 *
 * So the regression this guards is not hypothetical or subtle: anyone who
 * "tidies" the write back onto `supabase` restores the bypass while the trigger
 * is live, and publishing starts failing with 42501. This test goes red on that
 * exact edit.
 *
 * It asserts BEHAVIOUR (which mocked client received the update) rather than
 * scanning the source for the string `createServiceRoleClient`, because a
 * source-text scan here would be satisfied by the long comment in
 * `actions.ts` that explains the fix — CTL-039 / gotcha #29, where the better
 * a fix is documented the weaker its scan becomes.
 */

const mockRevalidatePath = jest.fn();
jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

/** Captures every update() payload sent through the END-USER (anon+JWT) client. */
const userUpdateCapture = jest.fn();
/** Captures every update() payload sent through the SERVICE-ROLE client. */
const serviceUpdateCapture = jest.fn();

let ageStatus: string | null = 'passed';
let gateActive = false;

jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: jest.fn().mockImplementation(async () => ({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } } }),
    },
    from: jest.fn().mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: jest.fn().mockResolvedValue({ data: { id: 'test-profile-id' }, error: null }),
          maybeSingle: jest.fn().mockResolvedValue({ data: { age_status: ageStatus }, error: null }),
        }),
      }),
      update: (data: unknown) => {
        userUpdateCapture(data);
        return { eq: jest.fn().mockResolvedValue({ error: null }) };
      },
      insert: jest.fn().mockResolvedValue({ error: null }),
    })),
  })),
}));

jest.mock('@/modules/platform/supabase-service', () => ({
  createServiceRoleClient: jest.fn().mockImplementation(() => ({
    from: jest.fn().mockImplementation(() => ({
      update: (data: unknown) => {
        serviceUpdateCapture(data);
        return { eq: jest.fn().mockResolvedValue({ error: null }) };
      },
    })),
  })),
}));

jest.mock('@/modules/age/provider-gate', () => ({
  isProviderAgeCheckActive: jest.fn().mockImplementation(async () => gateActive),
  passedProviderAgeCheck: (s: string | null | undefined) => s === 'passed',
  AGE_GATE_BLOCK_MESSAGE:
    'You need to verify your age before publishing your profile. Visit /verify-age to continue.',
}));

import { publishProfile } from '@/app/dashboard/profile/actions';

beforeEach(() => {
  userUpdateCapture.mockClear();
  serviceUpdateCapture.mockClear();
  mockRevalidatePath.mockClear();
  ageStatus = 'passed';
  gateActive = false;
});

describe('SEC-112 — publishProfile writes is_published on the service-role client', () => {
  test('publishes via the SERVICE-ROLE client, never the end-user client', async () => {
    const result = await publishProfile();

    expect(result).toEqual({ success: true });
    expect(serviceUpdateCapture).toHaveBeenCalledWith({
      is_published: true,
      onboarding_complete: true,
    });

    // The negative half. This is the assertion that reddens if the write is
    // moved back onto `supabase` — at which point the live trigger refuses it
    // with 42501 and publishing breaks for everyone.
    expect(userUpdateCapture).not.toHaveBeenCalled();
  });

  test('the end-user client is still what establishes WHO is publishing', async () => {
    // The service-role client bypasses RLS, so `.eq('user_id', user.id)` is the
    // only scoping left on that statement. `user.id` must keep coming from
    // supabase.auth.getUser() — a server-side JWT validation — and never from
    // caller-supplied input.
    const { createClient } = jest.requireMock('@/modules/platform/supabase-server');
    await publishProfile();
    expect(createClient).toHaveBeenCalled();
  });

  test('with the age gate ACTIVE and age_status not passed, nothing is written at all', async () => {
    gateActive = true;
    ageStatus = 'pending';

    const result = await publishProfile();

    expect(result.success).toBe(false);
    expect(serviceUpdateCapture).not.toHaveBeenCalled();
    expect(userUpdateCapture).not.toHaveBeenCalled();
  });

  test('with the age gate ACTIVE and age_status passed, it publishes', async () => {
    gateActive = true;
    ageStatus = 'passed';

    const result = await publishProfile();

    expect(result).toEqual({ success: true });
    expect(serviceUpdateCapture).toHaveBeenCalledWith({
      is_published: true,
      onboarding_complete: true,
    });
  });

  test('a blocked publish does not revalidate — no cache churn on a refusal', async () => {
    gateActive = true;
    ageStatus = 'failed';

    await publishProfile();

    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
