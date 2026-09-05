const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'classify-sitemap-freshness.sh');
const SOAK = path.join(REPO_ROOT, 'scripts', 'staging-soak.sh');

/**
 * BUGS-103 — the staging soak's C1-sitemap-fresh classifier.
 *
 * THE DEFECT THIS REPLACES, and why it is worth writing down.
 *
 * The probe used to assert `Cache-Control: no-store|no-cache` and FAIL on
 * anything else. `src/app/sitemap.ts` is a Next *metadata route*, and Next's
 * metadata-route loader hardcodes that header to a constant. So the assertion
 * was unsatisfiable: the probe reported FAIL every day from the day it shipped
 * and had never once been observed green.
 *
 * Worse than a false red — it could not have detected SEC-100 either. Measured
 * on two real production builds of this repo:
 *
 *   force-dynamic present  -> route table `ƒ /sitemap.xml` (Dynamic)
 *   force-dynamic removed  -> route table `○ /sitemap.xml` (Static, the defect)
 *
 * and in BOTH the compiled `.next/server/app/sitemap.xml/route.js` emits
 * `"Cache-Control":"public, max-age=0, must-revalidate"` — byte-identical. The
 * defect was genuinely reintroduced and the instrument did not move.
 *
 * That is catalogue failure mode 5 (an input that cannot reach the condition
 * under test) decaying into failure mode 7 (a red you learn to expect). These
 * tests exist so the replacement can be seen to fail in BOTH directions, which
 * the thing it replaces never could.
 *
 * Driven as a subprocess against the real script (the tests/scripts convention,
 * CTL-038 / gotcha #29) — a copy of the decision table here would report green
 * against a deleted script.
 */

/** Run the classifier over a raw header block; returns { verdict, reason }. */
function classify(headerLines) {
  const out = execFileSync('bash', [SCRIPT], {
    input: `${headerLines.join('\r\n')}\r\n\r\n`,
    stdio: 'pipe',
  })
    .toString()
    .trim();
  const [verdict, ...rest] = out.split(' ');
  return { verdict, reason: rest.join(' '), raw: out };
}

const OK = ['HTTP/2 200', 'content-type: application/xml'];

describe('the classifier exists and is wired into the soak', () => {
  test('the script is executable and the soak invokes it', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    const soak = fs.readFileSync(SOAK, 'utf8');
    expect(soak).toContain('classify-sitemap-freshness.sh');
  });

  test('the soak no longer classifies C1-sitemap-fresh on Cache-Control', () => {
    // The load-bearing regression guard. Cache-Control is a Next constant on
    // this route; reintroducing an assertion on it recreates a probe that
    // cannot fail correctly in either direction.
    //
    // Comments are stripped before matching — this file and the soak both
    // DISCUSS `cache-control` at length while explaining the hazard, and a
    // guard that punishes writing the explanation down is pointed the wrong
    // way (catalogue failure mode 2).
    const soak = fs
      .readFileSync(SOAK, 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    expect(soak).not.toMatch(/cache-control/i);
  });
});

describe('it FAILS on a real cache hit — the direction the old probe never had', () => {
  test.each([['hit'], ['stale'], ['prerender'], ['revalidated']])(
    'x-vercel-cache: %s is a FAIL',
    (token) => {
      const { verdict, reason } = classify([...OK, `x-vercel-cache: ${token}`]);
      expect(verdict).toBe('FAIL');
      expect(reason).toContain('SEC-130');
    },
  );

  test('a non-zero age with no x-vercel-cache is a FAIL', () => {
    const { verdict } = classify([...OK, 'age: 412']);
    expect(verdict).toBe('FAIL');
  });
});

describe('it PASSES on a per-request render', () => {
  test.each([['miss'], ['bypass'], ['MISS'], ['Bypass']])(
    'x-vercel-cache: %s is a PASS (case-insensitive)',
    (token) => {
      expect(classify([...OK, `x-vercel-cache: ${token}`]).verdict).toBe('PASS');
    },
  );

  test('a cache MISS passes even alongside age: 0', () => {
    expect(classify([...OK, 'x-vercel-cache: miss', 'age: 0']).verdict).toBe('PASS');
  });
});

describe('it is UNVERIFIED when it genuinely cannot tell — never a guess', () => {
  test('no cache telemetry at all is UNVERIFIED, not PASS', () => {
    const { verdict, reason } = classify(OK);
    expect(verdict).toBe('UNVERIFIED');
    expect(reason).toContain('BUGS-103');
  });

  test('an unrecognised x-vercel-cache token is UNVERIFIED', () => {
    // A probe that FAILs on a token Vercel added last week is a probe that goes
    // red on someone else's release note.
    expect(classify([...OK, 'x-vercel-cache: teapot']).verdict).toBe('UNVERIFIED');
  });

  test('age: 0 alone is UNVERIFIED — a just-populated cache entry also reads 0', () => {
    expect(classify([...OK, 'age: 0']).verdict).toBe('UNVERIFIED');
  });

  test('a non-numeric age is UNVERIFIED, not a crash and not a FAIL', () => {
    expect(classify([...OK, 'age: soon']).verdict).toBe('UNVERIFIED');
  });
});

describe('the header Next actually sends decides nothing on its own', () => {
  // These two cases ARE the proof. The same Cache-Control value accompanies a
  // dynamic render and a prerendered one, so it must not move the verdict.
  const NEXT_CONSTANT = 'cache-control: public, max-age=0, must-revalidate';

  test('the Next constant alongside a MISS is still a PASS', () => {
    expect(classify([...OK, NEXT_CONSTANT, 'x-vercel-cache: miss']).verdict).toBe('PASS');
  });

  test('the Next constant alongside a HIT is still a FAIL', () => {
    expect(classify([...OK, NEXT_CONSTANT, 'x-vercel-cache: hit']).verdict).toBe('FAIL');
  });

  test('the OLD accepted value cannot rescue a cache hit', () => {
    // `no-store` was the string the previous probe treated as proof of
    // freshness. It must not override observed cache telemetry.
    const { verdict } = classify([...OK, 'cache-control: no-store', 'x-vercel-cache: hit']);
    expect(verdict).toBe('FAIL');
  });
});
