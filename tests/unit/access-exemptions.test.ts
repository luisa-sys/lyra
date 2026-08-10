/**
 * The exemption table is EQUIVALENT to the three predicates it replaces.
 * KAN-415 D4.
 *
 * The collapse of three inline `||` chains into one table is the only
 * substitution in the whole D4 refactor that is not a verbatim move — every
 * other commit relocates code unchanged. So it is the one that needs an
 * independent oracle rather than inspection.
 *
 * THE ORACLE IS A LITERAL TRANSCRIPTION of the original predicates, copied from
 * src/middleware.ts before the substitution and kept here verbatim. It does not
 * import the new module, share a helper with it, or reference the table. That
 * matters: a test that derived its expectations from EXEMPTIONS would be
 * checking the table against itself, which is CTL-038's reimplementation shape
 * wearing a different coat — it would agree with any table, including a wrong
 * one.
 */
import {
  EXEMPTIONS,
  exemptMatchersFor,
  isExemptFrom,
  type ExemptGate,
} from '@/modules/access/exemptions';
import { isOauthServerPath } from '@/modules/access/oauth-server-paths';

// ---------------------------------------------------------------------------
// THE ORACLE — transcribed from src/middleware.ts, do not refactor to share
// code with the implementation under test.
// ---------------------------------------------------------------------------

/** src/middleware.ts — `suspensionExempt`, 5 disjuncts. */
function originalSuspensionExempt(pathname: string): boolean {
  return (
    pathname === '/suspended' ||
    pathname === '/login' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico'
  );
}

/** src/middleware.ts — `exemptFromBetaGate`, 10 disjuncts. */
function originalBetaGateExempt(pathname: string): boolean {
  return (
    pathname === '/waitlist' ||
    pathname === '/suspended' ||
    pathname === '/status' ||
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/join' ||
    pathname === '/confirm-age' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico'
  );
}

/** src/middleware.ts — the admin-host `passthrough`, 4 disjuncts. */
function originalAdminPassthrough(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/')
  );
}

const ORACLE: Record<ExemptGate, (p: string) => boolean> = {
  suspension: originalSuspensionExempt,
  'beta-tier': originalBetaGateExempt,
  'admin-passthrough': originalAdminPassthrough,
};

/**
 * Every path either predicate mentions, plus the NEAR-MISSES that nothing in
 * the repo tests today. The near-misses are the point: a prefix row written as
 * '/auth' instead of '/auth/' would also match '/authenticate', and no existing
 * test would notice.
 */
const PROBE_PATHS: readonly string[] = [
  // the mentioned paths
  '/suspended', '/login', '/favicon.ico', '/waitlist', '/status', '/signup',
  '/join', '/confirm-age', '/auth/callback', '/auth/confirm', '/_next/static/x.js',
  '/api/health', '/api/convene/x',
  // near-misses — prefix rows must carry their trailing slash
  '/auth', '/authenticate', '/_next', '/_nextdoor', '/api', '/apitest',
  '/suspendedX', '/loginx', '/favicon.icoo', '/statuses', '/waitlists', '/joins',
  '/signupx', '/confirm-age-later',
  // ordinary traffic
  '/', '/dashboard', '/dashboard/profile', '/admin', '/admin/users', '/some-slug',
  '/oauth/token', '/.well-known/jwks.json',
];

const GATES: readonly ExemptGate[] = ['suspension', 'beta-tier', 'admin-passthrough'];

describe('the exemption table agrees with the predicates it replaced', () => {
  test.each(GATES)('%s — identical on every probe path', (gate) => {
    const disagreements = PROBE_PATHS.filter(
      (p) => isExemptFrom(gate, p) !== ORACLE[gate](p),
    ).map((p) => `${p}: table=${isExemptFrom(gate, p)} original=${ORACLE[gate](p)}`);
    // Named, not counted — a bare number sends the reader hunting.
    expect(disagreements).toEqual([]);
  });

  test('the probe corpus actually exercises both answers for every gate', () => {
    // Without this, a table that returned `false` for everything would pass the
    // three tests above if the corpus happened to contain no exempt path. The
    // oracle would agree with it, and both would be wrong together.
    for (const gate of GATES) {
      const yes = PROBE_PATHS.filter((p) => ORACLE[gate](p)).length;
      const no = PROBE_PATHS.filter((p) => !ORACLE[gate](p)).length;
      expect(yes).toBeGreaterThan(0);
      expect(no).toBeGreaterThan(0);
    }
  });

  test('column totals match the three original lists exactly: 5, 10, 4', () => {
    // The plan's table claims these. Asserted rather than trusted, because a
    // miscounted column is a path that silently lost or gained an exemption.
    expect(exemptMatchersFor('suspension')).toHaveLength(5);
    expect(exemptMatchersFor('beta-tier')).toHaveLength(10);
    expect(exemptMatchersFor('admin-passthrough')).toHaveLength(4);
  });
});

describe('the table cannot silently over-match', () => {
  test('removing any row changes at least one answer — no row is dead or shadowed', () => {
    // Catches a future `{ kind: 'prefix', path: '/' }` quietly exempting the
    // world, and catches a duplicate row that does nothing.
    for (const row of EXEMPTIONS) {
      const withoutRow = EXEMPTIONS.filter((r) => r !== row);
      for (const gate of row.gates) {
        const remaining = withoutRow.filter((r) => r.gates.includes(gate)).map((r) => r.match);
        const stillExempt = (p: string) =>
          remaining.some((m) =>
            m.kind === 'exact' ? p === m.path : p.startsWith(m.path),
          );
        const changed = PROBE_PATHS.some((p) => isExemptFrom(gate, p) !== stillExempt(p));
        expect(`${gate}:${row.match.path} is load-bearing: ${changed}`)
          .toBe(`${gate}:${row.match.path} is load-bearing: true`);
      }
    }
  });

  test('every prefix row carries a trailing slash', () => {
    // '/auth' would match '/authenticate'. The originals were written with the
    // slash; this stops a future edit dropping it.
    for (const row of EXEMPTIONS) {
      if (row.match.kind === 'prefix') {
        expect(row.match.path.endsWith('/')).toBe(true);
      }
    }
  });

  test('every row explains itself', () => {
    // A row with no reason is a row nobody can safely delete later.
    for (const row of EXEMPTIONS) {
      expect(row.why.trim().length).toBeGreaterThan(20);
      expect(row.gates.length).toBeGreaterThan(0);
    }
  });
});

describe('the suspension ⊂ beta-tier relation, observed not encoded', () => {
  test('every suspension-exempt path is also beta-tier exempt, today', () => {
    // Recorded as an observation rather than modelled as inheritance:
    // inheritance would make a future suspension-only path inexpressible, and
    // would hide which gate a row actually serves. If this ever stops holding,
    // someone reads this note instead of discovering it during an outage.
    const violations = PROBE_PATHS.filter(
      (p) => isExemptFrom('suspension', p) && !isExemptFrom('beta-tier', p),
    );
    expect(violations).toEqual([]);
  });

  test('the converse does NOT hold — they are genuinely different lists', () => {
    // /waitlist is the case: beta-tier exempt, but a suspended user there is
    // still sent to /suspended. If this ever passes empty, the two columns have
    // silently merged.
    const betaOnly = PROBE_PATHS.filter(
      (p) => isExemptFrom('beta-tier', p) && !isExemptFrom('suspension', p),
    );
    expect(betaOnly.length).toBeGreaterThan(0);
    expect(betaOnly).toContain('/waitlist');
  });
});

describe('the OAuth surface is an INCLUSION set, kept apart on purpose', () => {
  test('it matches exactly what middleware.ts matched', () => {
    const original = (p: string) =>
      p.startsWith('/oauth/') ||
      p === '/.well-known/oauth-authorization-server' ||
      p === '/.well-known/jwks.json' ||
      p.startsWith('/api/well-known/');
    const disagreements = PROBE_PATHS.concat([
      '/oauth/register', '/oauth/token', '/api/well-known/jwks.json',
      '/.well-known/other', '/oauth', '/api/well-knownx',
    ]).filter((p) => isOauthServerPath(p) !== original(p));
    expect(disagreements).toEqual([]);
  });

  test('no OAuth path leaked into the exemption table', () => {
    // The polarity trap, asserted directly. A path that is meant to be TURNED
    // OFF appearing in a table headed "exempt from" is the one edit that would
    // quietly re-open an unauthenticated write into production oauth_clients.
    for (const gate of GATES) {
      for (const m of exemptMatchersFor(gate)) {
        expect(isOauthServerPath(m.path)).toBe(false);
      }
    }
  });
});
