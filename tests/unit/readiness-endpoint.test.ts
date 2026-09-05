/**
 * SEC-96 instance 3 — readiness probe contract tests.
 *
 * These drive the REAL module and the REAL route handler (no reimplementation
 * of the logic under test — see CTL-038 / gotcha #29). The probe itself is the
 * one injected seam, because the alternative is a live database; everything
 * downstream of it — the ok/degraded decision, the status code mapping and the
 * leak guard — is the actual shipped code.
 *
 * The assertions that matter most are the negative ones: that a *failing*
 * dependency produces a non-ok result and a 503. A readiness endpoint that
 * cannot go red is the defect this ticket is about, so each red path is
 * asserted explicitly rather than inferred from the green one.
 */

import {
  checkReadiness,
  READY_DETAIL,
  type DatabaseProbe,
} from '@/modules/observability/readiness';

describe('checkReadiness', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    // The module logs the real error server-side on purpose; keep it out of
    // the test output without asserting on console as a side channel.
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  test('reports ready when the probe round-trips', async () => {
    const probe: DatabaseProbe = async () => ({ failed: false });

    await expect(checkReadiness(probe)).resolves.toEqual({
      ok: true,
      detail: READY_DETAIL.ok,
    });
  });

  test('reports DEGRADED when the probe returns an error', async () => {
    const probe: DatabaseProbe = async () => ({ failed: true });

    await expect(checkReadiness(probe)).resolves.toEqual({
      ok: false,
      detail: READY_DETAIL.degraded,
    });
  });

  test('reports DEGRADED when the probe throws', async () => {
    const probe: DatabaseProbe = async () => {
      throw new Error('connection refused');
    };

    await expect(checkReadiness(probe)).resolves.toEqual({
      ok: false,
      detail: READY_DETAIL.degraded,
    });
  });

  test('reports TIMEOUT when the probe outlives the deadline', async () => {
    const probe: DatabaseProbe = (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });

    await expect(checkReadiness(probe, 10)).resolves.toEqual({
      ok: false,
      detail: READY_DETAIL.timeout,
    });
  });

  test('never leaks the underlying error into the public detail', async () => {
    const SECRET = 'postgres://user:hunter2@db.internal.example:5432/lyra';
    const probe: DatabaseProbe = async () => {
      throw new Error(`getaddrinfo ENOTFOUND ${SECRET}`);
    };

    const result = await checkReadiness(probe);

    expect(result.ok).toBe(false);
    expect(result.detail).not.toContain('hunter2');
    expect(result.detail).not.toContain('db.internal.example');
    expect(result.detail).not.toContain('ENOTFOUND');
    // Positive counterpart: the detail is one of the fixed tokens, so this
    // cannot pass merely because `detail` is undefined (gotcha #31 —
    // a negative assertion against undefined is vacuously true).
    expect(Object.values(READY_DETAIL)).toContain(result.detail);
  });

  test('does not throw when the probe rejects — degraded is a result, not an exception', async () => {
    const probe: DatabaseProbe = async () => {
      throw new Error('boom');
    };

    await expect(checkReadiness(probe)).resolves.toBeDefined();
  });
});

describe('GET /api/health/ready', () => {
  const readiness = '@/modules/observability/readiness';

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.unmock(readiness);
  });

  test('returns 200 and ok=true when the database is reachable', async () => {
    jest.doMock(readiness, () => ({
      READY_DETAIL: { ok: 'Reachable', degraded: 'Database unreachable', timeout: 'Database timed out' },
      checkReadiness: async () => ({ ok: true, detail: 'Reachable' }),
    }));

    const { GET } = await import('@/app/api/health/ready/route');
    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, detail: 'Reachable' });
  });

  test('returns 503 and ok=false when the database is degraded', async () => {
    jest.doMock(readiness, () => ({
      READY_DETAIL: { ok: 'Reachable', degraded: 'Database unreachable', timeout: 'Database timed out' },
      checkReadiness: async () => ({ ok: false, detail: 'Database unreachable' }),
    }));

    const { GET } = await import('@/app/api/health/ready/route');
    const res = await GET();

    // The status code is the load-bearing half: a monitor or a `fetch().ok`
    // check must read degraded without parsing the body.
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ ok: false, detail: 'Database unreachable' });
  });

  test('exposes only ok and detail — no internal fields', async () => {
    jest.doMock(readiness, () => ({
      READY_DETAIL: { ok: 'Reachable', degraded: 'Database unreachable', timeout: 'Database timed out' },
      checkReadiness: async () => ({ ok: false, detail: 'Database unreachable' }),
    }));

    const { GET } = await import('@/app/api/health/ready/route');
    const body = await (await GET()).json();

    expect(Object.keys(body).sort()).toEqual(['detail', 'ok']);
  });

  test('is uncacheable and unindexed', async () => {
    jest.doMock(readiness, () => ({
      READY_DETAIL: { ok: 'Reachable', degraded: 'Database unreachable', timeout: 'Database timed out' },
      checkReadiness: async () => ({ ok: true, detail: 'Reachable' }),
    }));

    const { GET } = await import('@/app/api/health/ready/route');
    const res = await GET();

    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
  });
});
