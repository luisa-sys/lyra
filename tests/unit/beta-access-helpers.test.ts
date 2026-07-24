/**
 * KAN-276 — beta-access helper logic.
 *
 *   - ensureBetaRequested: 'none' → 'requested' transition (and never
 *     downgrades 'requested'/'approved'); reports `transitioned`.
 *   - notifyBetaQueueJoined / notifyBetaApproved: call the (mocked)
 *     transactional sender with the right address + subject, and never throw
 *     when it fails.
 *   - betaRoutingTarget: returns the beta URL only on prod + flag-on, null
 *     otherwise.
 */

const sendMock = jest.fn();
jest.mock('@/lib/email/transactional', () => ({
  sendTransactionalEmail: (...args: unknown[]) => sendMock(...args),
}));

import {
  ensureBetaRequested,
  notifyBetaQueueJoined,
  notifyBetaApproved,
  betaRoutingTarget,
  type BetaAccessDbClient,
} from '@/lib/beta-access';

// A small fake matching BetaAccessDbClient. `status` is the row's current
// beta_access_status; updateCapture records the update payload.
function makeDb(status: string | null, opts?: { selectError?: boolean; updateError?: boolean }) {
  const updateCapture: { values?: Record<string, unknown> } = {};
  const db: BetaAccessDbClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            opts?.selectError
              ? { data: null, error: { message: 'boom' } }
              : { data: status === null ? null : { beta_access_status: status }, error: null },
        }),
      }),
      update: (values: Record<string, unknown>) => {
        updateCapture.values = values;
        return {
          eq: async () => (opts?.updateError ? { error: { message: 'boom' } } : { error: null }),
        };
      },
    }),
  };
  return { db, updateCapture };
}

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ ok: true, messageId: 'm1' });
});

describe('KAN-276 ensureBetaRequested', () => {
  test("transitions 'none' → 'requested' and stamps beta_requested_at", async () => {
    const { db, updateCapture } = makeDb('none');
    const res = await ensureBetaRequested(db, 'user-1');
    expect(res.transitioned).toBe(true);
    expect(res.previousStatus).toBe('none');
    expect(updateCapture.values?.beta_access_status).toBe('requested');
    expect(typeof updateCapture.values?.beta_requested_at).toBe('string');
  });

  test("treats a null/default status as 'none' and transitions", async () => {
    const { db } = makeDb(null);
    // null row → no profile found → no transition (defensive: nothing to update)
    const res = await ensureBetaRequested(db, 'user-1');
    expect(res.transitioned).toBe(false);
  });

  test("does NOT downgrade an already 'requested' profile", async () => {
    const { db, updateCapture } = makeDb('requested');
    const res = await ensureBetaRequested(db, 'user-1');
    expect(res.transitioned).toBe(false);
    expect(res.previousStatus).toBe('requested');
    expect(updateCapture.values).toBeUndefined();
  });

  test("never touches an 'approved' profile", async () => {
    const { db, updateCapture } = makeDb('approved');
    const res = await ensureBetaRequested(db, 'user-1');
    expect(res.transitioned).toBe(false);
    expect(res.previousStatus).toBe('approved');
    expect(updateCapture.values).toBeUndefined();
  });

  test('reports no transition when the update errors', async () => {
    const { db } = makeDb('none', { updateError: true });
    const res = await ensureBetaRequested(db, 'user-1');
    expect(res.transitioned).toBe(false);
  });

  test('reports no transition when the select errors', async () => {
    const { db } = makeDb('none', { selectError: true });
    const res = await ensureBetaRequested(db, 'user-1');
    expect(res.transitioned).toBe(false);
  });
});

describe('KAN-276 notify emails', () => {
  test('notifyBetaQueueJoined emails the configured notify address with the right subject', async () => {
    await notifyBetaQueueJoined({ who: 'Ada Lovelace' });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0];
    expect(arg.to).toBe(process.env.BETA_QUEUE_NOTIFY_EMAIL ?? 'luisa@santos-stephens.com');
    expect(arg.subject).toContain('Ada Lovelace');
    expect(arg.subject).toContain('beta queue');
    expect(arg.html).toContain('/admin/beta-queue');
  });

  test('notifyBetaQueueJoined escapes the name in HTML', async () => {
    await notifyBetaQueueJoined({ who: '<script>x</script>' });
    const arg = sendMock.mock.calls[0][0];
    expect(arg.html).not.toContain('<script>');
    expect(arg.html).toContain('&lt;script&gt;');
  });

  test('notifyBetaApproved emails the user with the beta app link', async () => {
    await notifyBetaApproved({ to: 'ada@example.com', displayName: 'Ada' });
    const arg = sendMock.mock.calls[0][0];
    expect(arg.to).toBe('ada@example.com');
    expect(arg.subject.toLowerCase()).toContain("you're in");
    expect(arg.html).toContain('beta.checklyra.com');
  });

  test('notify helpers never throw when the sender reports failure', async () => {
    sendMock.mockResolvedValue({ ok: false, code: 'no_api_key' });
    await expect(notifyBetaQueueJoined({ who: 'x' })).resolves.toBeUndefined();
    await expect(
      notifyBetaApproved({ to: 'a@b.com', displayName: null })
    ).resolves.toBeUndefined();
  });
});

describe('KAN-276 betaRoutingTarget', () => {
  const ORIGINAL_BETA_DEPLOY = process.env.IS_BETA_DEPLOY;
  const ORIGINAL_ROUTING = process.env.BETA_ROUTING_ENABLED;

  afterEach(() => {
    if (ORIGINAL_BETA_DEPLOY === undefined) delete process.env.IS_BETA_DEPLOY;
    else process.env.IS_BETA_DEPLOY = ORIGINAL_BETA_DEPLOY;
    if (ORIGINAL_ROUTING === undefined) delete process.env.BETA_ROUTING_ENABLED;
    else process.env.BETA_ROUTING_ENABLED = ORIGINAL_ROUTING;
  });

  test('returns null when routing flag is off (inert default)', () => {
    delete process.env.IS_BETA_DEPLOY;
    delete process.env.BETA_ROUTING_ENABLED;
    expect(betaRoutingTarget('/dashboard')).toBeNull();
  });

  test('returns null on the beta deploy itself even with the flag on', () => {
    process.env.IS_BETA_DEPLOY = 'true';
    process.env.BETA_ROUTING_ENABLED = 'true';
    expect(betaRoutingTarget('/dashboard')).toBeNull();
  });

  test('returns the beta URL (path preserved) on prod with the flag on', () => {
    delete process.env.IS_BETA_DEPLOY;
    process.env.BETA_ROUTING_ENABLED = 'true';
    expect(betaRoutingTarget('/dashboard')).toBe('https://beta.checklyra.com/dashboard');
  });

  test('normalises a path missing its leading slash', () => {
    delete process.env.IS_BETA_DEPLOY;
    process.env.BETA_ROUTING_ENABLED = 'true';
    expect(betaRoutingTarget('dashboard')).toBe('https://beta.checklyra.com/dashboard');
  });
});
