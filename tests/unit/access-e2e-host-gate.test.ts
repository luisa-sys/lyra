/**
 * SEC-201 — the e2e-host gate. The grey-cloud e2e-* aliases bypass Cloudflare
 * Access, so they must answer only to a request carrying the harness secret.
 */
import { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { buildDeployContext, createEdgeContext } from '@/modules/access/context';
import {
  constantTimeEqual,
  e2eHost,
  E2E_GATE_HEADER,
  isE2eHost,
} from '@/modules/access/gates/e2e-host';

const SECRET = 's3cr3t-value-for-tests-only';

const UNSET = Symbol('unset');

function run(host: string, headers: Record<string, string> = {}, secretArg: string | typeof UNSET = SECRET) {
  const secret = secretArg === UNSET ? undefined : secretArg;
  const request = new NextRequest(new URL(`https://${host}/dashboard`), {
    headers: { host, ...headers },
  });
  const ctx = createEdgeContext(
    request,
    buildDeployContext({ E2E_HOST_GATE_SECRET: secret }),
    () => 'csp',
  );
  // The gate is synchronous; the Gate type allows a promise, so narrow it here.
  return e2eHost.run(ctx) as NextResponse | null;
}

describe('isE2eHost', () => {
  test.each([
    ['e2e-dev.checklyra.com', true],
    ['e2e-stage.checklyra.com', true],
    ['E2E-DEV.checklyra.com', true],
    ['e2e-dev.checklyra.com:443', true],
    ['dev.checklyra.com', false],
    ['stage.checklyra.com', false],
    ['checklyra.com', false],
    ['beta.checklyra.com', false],
    ['e2e-dev.checklyra.com.evil.example', false],
    ['xe2e-dev.checklyra.com', false],
    ['', false],
  ])('%s → %s', (host, want) => {
    expect(isE2eHost(host)).toBe(want);
  });

  test('a missing host is not an e2e host', () => {
    expect(isE2eHost(null)).toBe(false);
    expect(isE2eHost(undefined)).toBe(false);
  });
});

describe('the gate on an e2e host', () => {
  test('no header → 404, no-store', () => {
    const res = run('e2e-dev.checklyra.com');
    expect(res?.status).toBe(404);
    expect(res?.headers.get('cache-control')).toBe('no-store');
  });

  test('wrong header → 404', () => {
    expect(run('e2e-stage.checklyra.com', { [E2E_GATE_HEADER]: 'nope' })?.status).toBe(404);
  });

  test('a prefix of the secret → 404', () => {
    expect(run('e2e-dev.checklyra.com', { [E2E_GATE_HEADER]: SECRET.slice(0, -1) })?.status).toBe(404);
  });

  test('correct header → continues', () => {
    expect(run('e2e-dev.checklyra.com', { [E2E_GATE_HEADER]: SECRET })).toBeNull();
    expect(run('e2e-stage.checklyra.com', { [E2E_GATE_HEADER]: SECRET })).toBeNull();
  });

  test('FAIL CLOSED: secret unset on the deployment → 404 even with a header', () => {
    expect(run('e2e-dev.checklyra.com', { [E2E_GATE_HEADER]: SECRET }, UNSET)?.status).toBe(404);
    expect(run('e2e-dev.checklyra.com', { [E2E_GATE_HEADER]: '' }, '')?.status).toBe(404);
  });
});

describe('every other host is untouched', () => {
  test.each(['dev.checklyra.com', 'stage.checklyra.com', 'checklyra.com', 'beta.checklyra.com'])(
    '%s continues with no header, even with the secret unset',
    (host) => {
      expect(run(host)).toBeNull();
      expect(run(host, {}, UNSET)).toBeNull();
    },
  );
});

describe('constantTimeEqual', () => {
  test('equal, unequal, different lengths', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});
