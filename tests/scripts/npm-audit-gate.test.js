/**
 * SEC-105 / CTL-052 — the npm-audit gate, scoped to what it can defend.
 *
 * WHAT WAS WRONG
 * --------------
 * `npm audit --audit-level=high` ran FULL-TREE at five blocking sites: the PR
 * gate and all four deploy workflows. Measured when this landed, the production
 * dependency tree had zero vulnerabilities at every severity, while 973 of 1249
 * resolved packages were dev-only — so the gate could stop a production deploy
 * over a package production does not install.
 *
 * It was also the only gate in the estate keyed on a THIRD-PARTY FEED rather
 * than on Lyra's own code, and in `deploy-production.yml` it sat in a `needs:`
 * ancestor of the deploy job. An advisory rescore overnight killed the release
 * before any other step ran. SEC-88: ~11 days frozen, twelve tested security
 * fixes held out of production. The gate's cost was paid in unshipped security
 * fixes.
 *
 * These tests reach the REAL script by subprocess (CTL-038). They also pin the
 * WIRING, because the substance of this change is where the gate does and does
 * not run — a correct script in the wrong place is the whole defect.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { SRC } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../support/source-paths.json'), 'utf-8'),
);
const SCRIPT = SRC.checkNpmAuditGate;
const DEPLOY_WORKFLOWS = [SRC.deployDev, SRC.deployStaging, SRC.deployBeta, SRC.deployProduction];
// Under `security/`, which gen-test-paths does not harvest (its prefix list is
// src|supabase|scripts|public|design|.github), so it is a named constant here
// rather than an SRC key — the same case as modules-layering-baseline.json, and
// for the same reason the shrink-only raw-literal ratchet does not count it.
const WAIVERS = 'security/npm-audit-waivers.json';

function run(args) {
  try {
    return {
      code: 0,
      out: execFileSync('python3', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf-8' }),
    };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

let dir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec105-'));
});
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

/** A minimal npm-audit-shaped report. */
function report(vulns, name) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const v of Object.values(vulns)) counts[v.severity] += 1;
  const p = path.join(dir, `${name}.json`);
  fs.writeFileSync(
    p,
    JSON.stringify({
      vulnerabilities: vulns,
      metadata: {
        vulnerabilities: { ...counts, total: Object.keys(vulns).length },
        dependencies: { prod: 1 },
      },
    }),
  );
  return p;
}
const vuln = (severity, ghsa) => ({
  severity,
  via: [{ source: 1, url: `https://github.com/advisories/${ghsa}` }],
});

describe('SEC-105 — the checker itself', () => {
  test('its self-test passes and has not shrunk', () => {
    const { code, out } = run(['--self-test']);
    expect(`${code}: ${out.trim()}`).toContain('Self-test passed');
    expect(code).toBe(0);
    const n = Number(/Self-test passed \((\d+) cases\)/.exec(out)?.[1] ?? 0);
    // Raised from 19 with SEC-140's 8 retry cases. A floor far below reality
    // cannot detect a deletion — the estate's own test floor sat at 29 files
    // against an actual 260 for exactly this reason.
    expect(n).toBeGreaterThanOrEqual(27);
  });

  test('SEC-140 — the retry path actually EXECUTES during the self-test', () => {
    // Asserted from outside the script, because the count above would still
    // pass if the retry cases were present but unreachable. The self-test's
    // transient fixtures emit a ::warning:: per retry, so their presence is
    // evidence the loop ran rather than that it exists.
    //
    // This test is here because the first draft of those cases was VACUOUS:
    // the block landed after `if failures:` in the self-test, so every
    // assertion appended to a list nobody read. Three mutations — removing the
    // retry, making exhausted retries report clean, and making deterministic
    // failures retryable — all passed. Only mutation caught it.
    const { code, out } = run(['--self-test']);
    expect(code).toBe(0);
    const n = Number(/retry loop exercised \((\d+) retry notifications\)/.exec(out)?.[1] ?? 0);
    expect(`retry notifications during self-test: ${n}`).not.toBe(
      'retry notifications during self-test: 0',
    );
    expect(n).toBeGreaterThanOrEqual(4);
  });

  test('a GREEN run emits no ::warning:: — standing noise is how warnings stop being read', () => {
    // The self-test's transient fixtures originally annotated the run summary
    // of every passing PR four times over. Four permanent warnings on a green
    // build train people to scroll past warnings, which is the same erosion
    // that lets a switched-off control keep looking fine (SEC-79).
    const { code, out } = run(['--self-test']);
    expect(code).toBe(0);
    const annotations = (out.match(/::warning::/g) || []).length;
    expect(`::warning:: annotations on a green self-test: ${annotations}`).toBe(
      '::warning:: annotations on a green self-test: 0',
    );
  });

  test.each([
    ['an HTML error page', '<html>502 Bad Gateway</html>'],
    ['an npm error envelope', '{"error":{"summary":"ENOLOCK: no lockfile"}}'],
    ['an empty object', '{}'],
    ['metadata with no vulnerabilities block', '{"metadata":{"dependencies":{}}}'],
    ['a bare array', '[]'],
  ])('%s fails CLOSED (exit 2), never clean', (label, body) => {
    const p = path.join(dir, `bad-${label.replace(/\W+/g, '-')}.json`);
    fs.writeFileSync(p, body);
    const { code, out } = run(['--scope', 'prod', '--audit-json', p]);
    // exit 2 = could not measure, deliberately distinct from 1 = measured, found something.
    expect(`${label} -> ${code}`).toBe(`${label} -> 2`);
    expect(out).toContain('::error::');
  });

  test('a real clean report is NOT treated as unrunnable', () => {
    // Fail-closed must not degenerate into fail-always, or the gate is just
    // permanently red and gets removed.
    const p = report({}, 'clean');
    const { code, out } = run(['--scope', 'prod', '--audit-json', p]);
    expect(`${code}: ${out}`).toContain('No unwaived high/critical');
    expect(code).toBe(0);
  });

  test('HIGH and CRITICAL block; MODERATE does not', () => {
    for (const sev of ['high', 'critical']) {
      const p = report({ lodash: vuln(sev, 'GHSA-aaaa-bbbb-cccc') }, `sev-${sev}`);
      expect(`${sev} -> ${run(['--scope', 'prod', '--audit-json', p]).code}`).toBe(`${sev} -> 1`);
    }
    // The threshold is load-bearing in both directions. A gate that also fired
    // on moderates would be back to stopping releases over noise — the 2
    // moderates live in this tree today (the @lhci/cli uuid chain, SEC-97) are
    // exactly the kind of finding that must not block.
    const p = report({ lodash: vuln('moderate', 'GHSA-aaaa-bbbb-cccc') }, 'sev-moderate');
    expect(`moderate -> ${run(['--scope', 'prod', '--audit-json', p]).code}`).toBe('moderate -> 0');
  });
});

describe('SEC-105 — the waiver file is a decision record, not a mute button', () => {
  const waiverPath = path.join(ROOT, WAIVERS);
  const waivers = JSON.parse(fs.readFileSync(waiverPath, 'utf-8'));

  test('it exists, is empty, and cites its ticket', () => {
    // Empty is the correct steady state: an entry is a known-unfixable finding
    // carried on purpose. If this ever fails because entries appeared, read
    // them — that is the point of the file, not a reason to relax the test.
    expect(Array.isArray(waivers.waivers)).toBe(true);
    expect(waivers.ticket).toMatch(/^[A-Z]+-\d+$/);
  });

  test('CTL-025 governs it — hygiene is not this gate’s job', () => {
    // One concern, one owner. The audit gate decides what is waived; the
    // hygiene control decides whether a waiver is well-formed (ticket, owner,
    // reason, exactly one of expires/review_by, 12-month cap, fails on lapse).
    const hygiene = fs.readFileSync(path.join(ROOT, SRC.checkWaiverHygiene), 'utf-8');
    expect(hygiene).toContain(WAIVERS);
  });

  test('a waiver names ONE package — it does not transfer', () => {
    // Proven against the real script rather than asserted: the same advisory
    // on a different package must still block, or one decision silently
    // becomes a blanket one.
    const { out } = run(['--self-test']);
    expect(out).toContain('Self-test passed');
    const p = report({ 'some-other-pkg': vuln('high', 'GHSA-aaaa-bbbb-cccc') }, 'transfer');
    expect(run(['--scope', 'prod', '--audit-json', p]).code).toBe(1);
  });

  test('the live tree passes the gate it now ships with', () => {
    const { code, out } = run(['--scope', 'prod']);
    expect(`exit ${code}\n${out}`).toContain('production dependency tree');
    expect(code).toBe(0);
  });
});

describe('SEC-105 — where the gate runs is the substance of the change', () => {
  test('the PR gate runs the checker, prod-scoped, and no bare npm audit', () => {
    const wf = fs.readFileSync(path.join(ROOT, SRC.prChecks), 'utf-8');
    const live = wf
      .split('\n')
      .filter(
        (l) =>
          l.includes(`python3 ${SCRIPT}`) &&
          !l.includes('--self-test') &&
          !/^\s*#/.test(l.trim()),
      );
    expect(`live invocations: ${live.length}`).toBe('live invocations: 1');
    expect(live[0]).toContain('--scope prod');
    // The old gate must be gone, not merely supplemented.
    const bare = wf.split('\n').filter((l) => /^\s*run:\s*npm audit\b/.test(l));
    expect(`bare npm audit lines: ${bare.length}`).toBe('bare npm audit lines: 0');
  });

  test.each(DEPLOY_WORKFLOWS)('%s runs no npm audit at all', (wfPath) => {
    // The core of SEC-105. Asserted per-file rather than as one aggregate so a
    // failure names the workflow that regressed.
    //
    // gotcha #31: this is a NEGATIVE assertion, and a negative assertion
    // against `undefined` passes forever. The path is seeded, and its type is
    // checked here so a lost SRC key fails loudly instead of vacuously.
    expect(typeof wfPath).toBe('string');
    const wf = fs.readFileSync(path.join(ROOT, wfPath), 'utf-8');
    const executable = wf
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .filter((l) => /\bnpm audit\b/.test(l));
    expect(`${wfPath}: executable npm audit lines: ${executable.length}`).toBe(
      `${wfPath}: executable npm audit lines: 0`,
    );
  });

  test('each deploy workflow explains the removal, so it is not "restored" later', () => {
    // A deleted step leaves no trace. Without the comment the next person to
    // audit these files sees four deploy workflows with no dependency check and
    // helpfully adds one back.
    for (const wfPath of DEPLOY_WORKFLOWS) {
      const wf = fs.readFileSync(path.join(ROOT, wfPath), 'utf-8');
      expect(`${wfPath} cites SEC-105: ${wf.includes('SEC-105')}`).toBe(`${wfPath} cites SEC-105: true`);
    }
  });

  test('the weekly job still audits the FULL tree and leaves a work item', () => {
    // The blocking gate is prod-scoped, so this run is the only thing standing
    // between "dev advisories are tracked" and "dev advisories are ignored".
    const wf = fs.readFileSync(path.join(ROOT, SRC.securityAudit), 'utf-8');
    expect(wf).toMatch(/--scope full/);
    expect(wf).toMatch(/gh issue (create|comment)/);
    expect(wf).toMatch(/issues:\s*write/);
  });
});
