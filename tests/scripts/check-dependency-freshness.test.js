/**
 * SEC-197 / CTL-081 — dependency freshness: vulnerable or >90 days old means upgrade.
 *
 * Founder rule, 2026-11-23: "always upgrade whenever external software has
 * vulnerabilities or is more than 3 months old". docs/DEPENDENCY_POLICY.md is
 * the policy; scripts/check-dependency-freshness.py is the control.
 *
 * WHAT IS AND IS NOT COVERED HERE, stated rather than implied:
 *
 *   COVERED  every judgement, end to end through the REAL script as a
 *            subprocess (CTL-038 — never a copy), driven by fixture files:
 *            package.json + package-lock.json + an npm-audit report + registry
 *            documents + a Node.js release index + the waiver file, with a
 *            pinned --today. No test here touches the network.
 *   COVERED  the property that matters most for not recreating SEC-88: a PR
 *            that changes no dependency is "not applicable" and makes NO
 *            measurement at all — proven by pointing it at fixtures that do
 *            not exist, which would exit 2 if they were read.
 *   COVERED  "introduces" is judged against the BASE tree, by identity
 *            (package name, installed version, advisory) — never by lockfile
 *            path, so a hoist introduces nothing. A bump that leaves
 *            a package vulnerable to the same advisory, or old but newer than
 *            before, passes; a new advisory, a new old dependency or a
 *            downgrade does not. An expired waiver fails a dependency PR.
 *   COVERED  the wiring: the PR gate runs in pr-checks.yml, the daily report
 *            runs in its OWN workflow (dependency-freshness.yml) with its own
 *            CTL-072 freshness entry, security-audit.yml is left as it was,
 *            and dependabot covers npm + github-actions against develop.
 *
 *   NOT      the live feeds (npm audit, registry.npmjs.org, nodejs.org). They
 *            are reached only through the script's fetcher seam and exercised
 *            by the scheduled run and by the PR gate on dependency PRs.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '../..');
const { SRC } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../support/source-paths.json'), 'utf-8'),
);
const SCRIPT = path.join(ROOT, SRC.checkDependencyFreshness);
// Under `security/`, which gen-test-paths does not harvest — the same case, and
// the same treatment, as security/npm-audit-waivers.json in npm-audit-gate.test.js.
const WAIVERS = 'security/dependency-freshness-waivers.json';
const TODAY = '2026-11-23';
const REG = 'https://registry.npmjs.org/';

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
let n = 0;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec197-'));
});
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const write = (name, data) => {
  const p = path.join(dir, `${n}-${name}`);
  fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data));
  return p;
};

const advisory = (sev, ghsa) => ({
  source: 1,
  severity: sev,
  url: `https://github.com/advisories/${ghsa}`,
});

/**
 * One fixture world. `deps` maps a direct dependency to
 * {version, published, latest, latestPublished}; `vulns` is an npm-audit
 * vulnerabilities map; `node` is the pinned major in the only workflow.
 */
const auditReport = (vulns) => {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const v of Object.values(vulns)) counts[v.severity] += 1;
  return { vulnerabilities: vulns, metadata: { vulnerabilities: { ...counts, total: Object.keys(vulns).length } } };
};

function world({ deps = {}, vulns = {}, baseVulns = {}, waivers = [], node = null, index = null } = {}) {
  n += 1;
  const pj = { name: 'fixture', dependencies: {} };
  const lock = { lockfileVersion: 3, packages: { '': { name: 'fixture' } } };
  const regDir = path.join(dir, `${n}-registry`);
  fs.mkdirSync(regDir);
  for (const [name, d] of Object.entries(deps)) {
    pj.dependencies[name] = `^${d.version}`;
    lock.packages[`node_modules/${name}`] = {
      version: d.version,
      resolved: `${REG}${name}/-/${name}-${d.version}.tgz`,
    };
    fs.writeFileSync(
      path.join(regDir, `${name.replace('/', '__')}.json`),
      JSON.stringify({
        'dist-tags': { latest: d.latest },
        time: { ...(d.times || {}), [d.version]: d.published, [d.latest]: d.latestPublished || TODAY },
      }),
    );
  }
  for (const v of Object.values(vulns)) {
    for (const node of v.nodes) lock.packages[node] = lock.packages[node] || { version: '1.0.0' };
  }
  const wfDir = path.join(dir, `${n}-workflows`);
  fs.mkdirSync(wfDir);
  if (node) fs.writeFileSync(path.join(wfDir, 'ci.yml'), `      - uses: x\n        with:\n          node-version: '${node}'\n`);
  return {
    pj,
    lock,
    args: [
      '--today', TODAY,
      '--package-json', write('package.json', pj),
      '--lockfile', write('package-lock.json', lock),
      '--audit-json', write('audit.json', auditReport(vulns)),
      // The PR gate audits the base tree too; the daily report ignores this.
      '--base-audit-json', write('base-audit.json', auditReport(baseVulns)),
      '--registry-dir', regDir,
      '--node-index-json', write('index.json', index || [
        { version: 'v24.5.0', date: '2026-11-10', lts: 'Krypton' },
        { version: 'v22.9.0', date: '2026-11-11', lts: 'Jod' },
        { version: 'v20.20.2', date: '2026-03-24', lts: 'Iron' },
      ]),
      '--workflows-dir', wfDir,
      '--waivers', write('waivers.json', { waivers }),
    ],
  };
}

const OLD = { version: '1.0.0', published: '2026-06-01', latest: '1.4.0' }; // 175 days, newer exists
const FRESH = { version: '1.0.0', published: '2026-11-01', latest: '1.4.0' }; // 22 days
const OLD_BUT_LATEST = { version: '1.0.0', published: '2025-01-01', latest: '1.0.0' };
const LOW_VULN = {
  severity: 'low',
  via: [advisory('low', 'GHSA-aaaa-bbbb-cccc')],
  nodes: ['node_modules/vulnpkg'],
  fixAvailable: true,
};
const WAIVER = {
  package: 'vulnpkg',
  kind: 'vulnerability',
  advisory: 'GHSA-aaaa-bbbb-cccc',
  reason: 'No patched release exists upstream; reachable only from build tooling, not runtime.',
  jira: 'SEC-194',
  expires: '2027-01-15',
  approved_by: 'founder 2026-11-23 standing policy',
};

describe('CTL-081 — the checker itself', () => {
  test('the script exists and is executable', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(fs.statSync(SCRIPT).mode & 0o111).toBeTruthy();
  });

  test('its self-test passes and has not shrunk — a FLOOR, so the corpus cannot be gutted', () => {
    const { code, out } = run(['--self-test']);
    expect(`${code}: ${out.trim()}`).toContain('Self-test passed');
    expect(code).toBe(0);
    const cases = Number(/Self-test passed \((\d+) cases\)/.exec(out)?.[1] ?? 0);
    expect(cases).toBeGreaterThanOrEqual(75);
  });
});

describe('CTL-081 — the daily report (--report)', () => {
  test('a clean world exits 0 and says so', () => {
    const w = world({ deps: { fresh: FRESH, steady: OLD_BUT_LATEST }, node: '22' });
    const { code, out } = run(['--report', ...w.args]);
    expect(`${code}: ${out}`).toContain('0 out of policy');
    expect(code).toBe(0);
  });

  test('a direct dependency >90 days old with a newer release is out of policy', () => {
    const w = world({ deps: { oldpkg: OLD, fresh: FRESH } });
    const { code, out } = run(['--report', ...w.args]);
    expect(out).toMatch(/OUTDATED\s+oldpkg\s+1\.0\.0 published 2026-06-01 \(175 days\)\s+latest 1\.4\.0/);
    expect(out).not.toMatch(/OUTDATED\s+fresh/);
    expect(code).toBe(1);
  });

  test('old but still the latest release is in policy — the rule is "old AND superseded"', () => {
    const w = world({ deps: { steady: OLD_BUT_LATEST } });
    expect(run(['--report', ...w.args]).code).toBe(0);
  });

  test('a LOW advisory is out of policy — any severity counts, unlike the HIGH-only audit gate', () => {
    const w = world({ vulns: { vulnpkg: LOW_VULN } });
    const { code, out } = run(['--report', ...w.args]);
    expect(out).toMatch(/VULNERABLE\s+vulnpkg\s+low\s+GHSA-aaaa-bbbb-cccc.*within 14 days/);
    expect(code).toBe(1);
  });

  test('a HIGH advisory carries the 2-day SLA', () => {
    const w = world({
      vulns: { hi: { ...LOW_VULN, severity: 'high', via: [advisory('high', 'GHSA-dddd-eeee-ffff')], nodes: ['node_modules/hi'] } },
    });
    expect(run(['--report', ...w.args]).out).toMatch(/VULNERABLE\s+hi\s+high.*within 2 days/);
  });

  test('an unmaintained Node.js line pinned in a workflow is out of policy; a maintained one is not', () => {
    const stale = world({ node: '20' });
    expect(run(['--report', ...stale.args]).out).toMatch(/OUTDATED\s+node\s+20\.x/);
    const ok = world({ node: '22' });
    expect(run(['--report', ...ok.args]).code).toBe(0);
  });

  test('--report-only reports findings without failing, and writes the issue body + counts', () => {
    const w = world({ deps: { oldpkg: OLD }, vulns: { vulnpkg: LOW_VULN } });
    const md = path.join(dir, `${n}-issue.md`);
    const gho = path.join(dir, `${n}-gho.txt`);
    const { code, out } = run(['--report', '--report-only', '--markdown', md, '--github-output', gho, ...w.args]);
    expect(`${code}: ${out}`).toContain('2 out of policy');
    expect(code).toBe(0);
    const body = fs.readFileSync(md, 'utf-8');
    expect(body).toContain('`oldpkg`');
    expect(body).toContain('`vulnpkg`');
    expect(fs.readFileSync(gho, 'utf-8')).toContain('out_of_policy=2\n');
  });

  test('an unexpired waiver clears exactly its package + advisory', () => {
    const w = world({ vulns: { vulnpkg: LOW_VULN }, waivers: [WAIVER] });
    const { code, out } = run(['--report', ...w.args]);
    expect(`${code}: ${out}`).toContain('0 out of policy, 1 waived');
    expect(code).toBe(0);
  });

  test('an EXPIRED waiver fails even with --report-only — a lapse is a decision falling due', () => {
    const w = world({ vulns: { vulnpkg: LOW_VULN }, waivers: [{ ...WAIVER, expires: '2026-11-22' }] });
    const { code, out } = run(['--report', '--report-only', ...w.args]);
    expect(out).toContain('EXPIRED waiver');
    expect(code).toBe(1);
  });

  test('a waiver more than 90 days out is malformed and fails', () => {
    const w = world({ waivers: [{ ...WAIVER, expires: '2027-02-22' }] });
    const { code, out } = run(['--report', '--report-only', ...w.args]);
    expect(out).toContain('more than 90 days away');
    expect(code).toBe(1);
  });

  test('an unexpired waiver for a package not out of policy at the installed version is STALE, never a crash', () => {
    // The real file carries waivers written against the versions on a sibling
    // branch (e.g. typescript 6.0.3, eslint 9.39.5). Where the installed
    // version differs — or the package is not a direct dependency at all — the
    // check must report the waiver stale and carry on, not throw.
    const ageWaiver = (pkg) => ({ ...WAIVER, package: pkg, kind: 'age', advisory: null });
    const w = world({
      deps: { inpolicy: FRESH, latestpkg: OLD_BUT_LATEST },
      waivers: [ageWaiver('inpolicy'), ageWaiver('latestpkg'), ageWaiver('not-installed'), { ...WAIVER, package: 'not-installed' }],
    });
    const { code, out } = run(['--report', '--report-only', ...w.args]);
    expect(out).not.toContain('Traceback');
    expect(out).toContain('0 out of policy, 0 waived, 0 expired waiver(s), 0 malformed, 4 stale');
    expect(out).toMatch(/stale waiver — matches nothing: inpolicy age/);
    expect(out).toMatch(/stale waiver — matches nothing: not-installed vulnerability GHSA-aaaa-bbbb-cccc/);
    expect(code).toBe(0);
    // The PR gate on a waiver-file-only change validates the shape and passes.
    const pr = run(['--pr', ...w.args, '--changed-files', write('changed.txt', WAIVERS)]);
    expect(pr.out).not.toContain('Traceback');
    expect(pr.code).toBe(0);
  });

  test('a waiver matching nothing is reported STALE (and fails without --report-only)', () => {
    const w = world({ waivers: [WAIVER] });
    const strict = run(['--report', ...w.args]);
    expect(strict.out).toContain('stale waiver');
    expect(strict.code).toBe(1);
    expect(run(['--report', '--report-only', ...w.args]).code).toBe(0);
  });

  test('an unreadable audit report fails CLOSED (exit 2), never clean', () => {
    const w = world();
    const i = w.args.indexOf('--audit-json');
    const args = [...w.args];
    args[i + 1] = write('bad-audit.json', '<html>502 Bad Gateway</html>');
    const { code, out } = run(['--report', '--report-only', ...args]);
    expect(`exit ${code}`).toBe('exit 2');
    expect(out).toContain('::error::');
  });

  test('missing registry metadata fails CLOSED (exit 2)', () => {
    const w = world({ deps: { oldpkg: OLD } });
    fs.rmSync(path.join(w.args[w.args.indexOf('--registry-dir') + 1], 'oldpkg.json'));
    expect(run(['--report', '--report-only', ...w.args]).code).toBe(2);
  });
});

describe('CTL-081 — the PR gate (--pr) blocks only what a PR introduces', () => {
  const changed = (files) => write('changed.txt', files.join('\n'));

  test('a PR touching no dependency file is NOT APPLICABLE and measures nothing', () => {
    // The anti-SEC-88 property. Every fixture path below is missing on purpose:
    // if the gate tried to run npm audit, read the registry or even the
    // waiver file, it would exit 2. Exit 0 proves it did none of that.
    const missing = path.join(dir, 'does-not-exist.json');
    const { code, out } = run([
      '--pr', '--today', TODAY,
      '--changed-files', changed(['README.md', 'docs/RUNBOOK.md']),
      '--audit-json', missing, '--registry-dir', missing, '--waivers', missing,
      '--package-json', missing, '--lockfile', missing,
    ]);
    expect(`${code}: ${out}`).toContain('not applicable');
    expect(code).toBe(0);
  });

  test('a PR that re-versions a package into a vulnerable version is blocked', () => {
    const w = world({ vulns: { vulnpkg: LOW_VULN } });
    const base = JSON.parse(JSON.stringify(w.lock));
    base.packages['node_modules/vulnpkg'] = { version: '0.9.0' };
    const { code, out } = run([
      '--pr', ...w.args,
      '--changed-files', changed(['package-lock.json']),
      '--base-lockfile', write('base-lock.json', base),
    ]);
    expect(out).toMatch(/VULNERABLE\s+vulnpkg/);
    expect(out).toContain('introduces 1 out-of-policy');
    expect(code).toBe(1);
  });

  test('a vulnerable package the PR did NOT touch does not block it', () => {
    const w = world({ deps: { fresh: FRESH }, vulns: { vulnpkg: LOW_VULN } });
    const base = JSON.parse(JSON.stringify(w.lock));
    base.packages['node_modules/fresh'] = { version: '0.9.0' };
    const { code, out } = run([
      '--pr', ...w.args,
      '--changed-files', changed(['package.json', 'package-lock.json']),
      '--base-lockfile', write('base-lock.json', base),
    ]);
    expect(`${code}: ${out}`).toContain('Nothing out of policy introduced');
    expect(code).toBe(0);
  });

  test('a PR that adds a direct dependency already >90 days old with a newer release is blocked', () => {
    const w = world({ deps: { oldpkg: OLD } });
    const base = JSON.parse(JSON.stringify(w.lock));
    delete base.packages['node_modules/oldpkg'];
    const { code, out } = run([
      '--pr', ...w.args,
      '--changed-files', changed(['package.json', 'package-lock.json']),
      '--base-lockfile', write('base-lock.json', base),
    ]);
    expect(out).toMatch(/OUTDATED\s+oldpkg/);
    expect(code).toBe(1);
  });

  test('a waiver lets an otherwise-blocked dependency PR through', () => {
    const w = world({ vulns: { vulnpkg: LOW_VULN }, waivers: [WAIVER] });
    const base = JSON.parse(JSON.stringify(w.lock));
    base.packages['node_modules/vulnpkg'] = { version: '0.9.0' };
    const { code, out } = run([
      '--pr', ...w.args,
      '--changed-files', changed(['package-lock.json']),
      '--base-lockfile', write('base-lock.json', base),
    ]);
    expect(out).toContain('WAIVED  vulnpkg');
    expect(code).toBe(0);
  });

  test('re-versioning a package that STAYS vulnerable to the same advisory is an improvement, not a block', () => {
    // glob 10.4.5 -> 10.4.6 while the fix needs a parent's major: same GHSA on
    // base and head. Blocking it would force a waiver for a step forward.
    const w = world({ vulns: { vulnpkg: LOW_VULN }, baseVulns: { vulnpkg: LOW_VULN } });
    const base = JSON.parse(JSON.stringify(w.lock));
    base.packages['node_modules/vulnpkg'] = { version: '0.9.0' };
    const { code, out } = run([
      '--pr', ...w.args,
      '--changed-files', changed(['package-lock.json']),
      '--base-lockfile', write('base-lock.json', base),
    ]);
    expect(`${code}: ${out}`).toContain('already vulnerable to the same advisory on the base');
    expect(out).toContain('Nothing out of policy introduced');
    expect(code).toBe(0);
  });

  test('...but a NEW advisory on that re-versioned package is blocked, naming only the new one', () => {
    const head = { ...LOW_VULN, via: [...LOW_VULN.via, advisory('moderate', 'GHSA-mmmm-nnnn-pppp')], severity: 'moderate' };
    const w = world({ vulns: { vulnpkg: head }, baseVulns: { vulnpkg: LOW_VULN } });
    const base = JSON.parse(JSON.stringify(w.lock));
    base.packages['node_modules/vulnpkg'] = { version: '0.9.0' };
    const { code, out } = run([
      '--pr', ...w.args,
      '--changed-files', changed(['package-lock.json']),
      '--base-lockfile', write('base-lock.json', base),
    ]);
    expect(out).toMatch(/VULNERABLE\s+vulnpkg\s+moderate\s+GHSA-mmmm-nnnn-pppp\s/);
    expect(out).not.toMatch(/VULNERABLE.*GHSA-aaaa-bbbb-cccc/);
    expect(code).toBe(1);
  });

  // Identity is (package name, installed version, advisory) — never the
  // lockfile PATH. Each case below builds its head and base lockfiles by hand
  // and runs the gate on them, so the version each path holds is explicit.
  const OLD_COPY = 'node_modules/a/node_modules/vulnpkg';
  const NEW_COPY = 'node_modules/newdep/node_modules/vulnpkg';
  const HOISTED = 'node_modules/vulnpkg';
  const lockOf = (nodes) => ({
    lockfileVersion: 3,
    packages: { '': { name: 'fixture' }, ...Object.fromEntries(Object.entries(nodes).map(([p, v]) => [p, { version: v }])) },
  });
  function gate(w, headNodes, baseNodes) {
    const args = [...w.args];
    args[args.indexOf('--lockfile') + 1] = write('head-lock.json', lockOf(headNodes));
    return run([
      '--pr', ...args,
      '--changed-files', changed(['package-lock.json']),
      '--base-lockfile', write('base-lock.json', lockOf(baseNodes)),
    ]);
  }

  test('a NEW vulnerable VERSION of a package already vulnerable elsewhere in the tree is blocked', () => {
    // Base: vulnpkg@1.0.0 at OLD_COPY carries GHSA-aaaa. The PR adds newdep
    // with its own nested vulnpkg@0.8.0 carrying the SAME GHSA: a version the
    // base never carried that advisory on, and nothing it replaced.
    const w = world({
      vulns: { vulnpkg: { ...LOW_VULN, nodes: [OLD_COPY, NEW_COPY] } },
      baseVulns: { vulnpkg: { ...LOW_VULN, nodes: [OLD_COPY] } },
    });
    const { code, out } = gate(
      w,
      { 'node_modules/a': '1.0.0', [OLD_COPY]: '1.0.0', 'node_modules/newdep': '1.0.0', [NEW_COPY]: '0.8.0' },
      { 'node_modules/a': '1.0.0', [OLD_COPY]: '1.0.0' },
    );
    expect(out).toMatch(/VULNERABLE\s+vulnpkg\s+low\s+GHSA-aaaa-bbbb-cccc\s/);
    expect(out).toContain('introduces 1 out-of-policy');
    expect(code).toBe(1);
  });

  test('a pure HOIST (same name, version and advisory at a new path) is not introduced', () => {
    // A lockfile regeneration moves the already-vulnerable vulnpkg@1.0.0 from
    // a nested path to the top level. Judged by path this looked like a new
    // vulnerable install and blocked the PR; nothing new was installed.
    const w = world({
      vulns: { vulnpkg: { ...LOW_VULN, nodes: [HOISTED] } },
      baseVulns: { vulnpkg: { ...LOW_VULN, nodes: [OLD_COPY] } },
    });
    const { code, out } = gate(
      w,
      { 'node_modules/a': '1.0.0', [HOISTED]: '1.0.0' },
      { 'node_modules/a': '1.0.0', [OLD_COPY]: '1.0.0' },
    );
    expect(`${code}: ${out}`).toContain('already vulnerable to the same advisory on the base');
    expect(out).toContain('Nothing out of policy introduced');
    expect(out).not.toMatch(/VULNERABLE/);
    expect(code).toBe(0);
  });

  test('a NEW advisory on a package whose version did not change (only moved) is blocked', () => {
    // Same vulnpkg@1.0.0, hoisted — but the head audit reports a second
    // advisory the base did not. The (name, advisory) pair is new: introduced,
    // naming only the new advisory.
    const head = { ...LOW_VULN, nodes: [HOISTED], severity: 'moderate', via: [...LOW_VULN.via, advisory('moderate', 'GHSA-mmmm-nnnn-pppp')] };
    const w = world({
      vulns: { vulnpkg: head },
      baseVulns: { vulnpkg: { ...LOW_VULN, nodes: [OLD_COPY] } },
    });
    const { code, out } = gate(
      w,
      { 'node_modules/a': '1.0.0', [HOISTED]: '1.0.0' },
      { 'node_modules/a': '1.0.0', [OLD_COPY]: '1.0.0' },
    );
    expect(out).toMatch(/VULNERABLE\s+vulnpkg\s+moderate\s+GHSA-mmmm-nnnn-pppp\s/);
    expect(out).not.toMatch(/VULNERABLE.*GHSA-aaaa-bbbb-cccc/);
    expect(out).toContain('introduces 1 out-of-policy');
    expect(code).toBe(1);
  });

  test('a fix that clears one copy while another stays vulnerable is still present, not introduced', () => {
    // Base: vulnpkg@1.0.0 under both a/ and b/. The PR fixes a/'s copy to
    // 2.0.0 (clean) and the regeneration hoists b/'s still-vulnerable 1.0.0
    // to the top level. The vulnerability is still there (the daily report
    // keeps listing it) but this PR did not introduce it.
    const B_COPY = 'node_modules/b/node_modules/vulnpkg';
    const w = world({
      vulns: { vulnpkg: { ...LOW_VULN, nodes: [HOISTED] } },
      baseVulns: { vulnpkg: { ...LOW_VULN, nodes: [OLD_COPY, B_COPY] } },
    });
    const { code, out } = gate(
      w,
      { 'node_modules/a': '1.0.0', [OLD_COPY]: '2.0.0', 'node_modules/b': '1.0.0', [HOISTED]: '1.0.0' },
      { 'node_modules/a': '1.0.0', [OLD_COPY]: '1.0.0', 'node_modules/b': '1.0.0', [B_COPY]: '1.0.0' },
    );
    expect(`${code}: ${out}`).toContain('1 moved or re-versioned vulnerable package(s) were already vulnerable to the same advisory on the base');
    expect(out).toContain('Nothing out of policy introduced');
    expect(out).not.toMatch(/VULNERABLE/);
    expect(code).toBe(0);
  });

  test('bumping a direct dependency that stays >90 days old but is NEWER than base passes', () => {
    // eslint 9.39.3 -> 9.39.4 while 10.x is latest: both out of the age rule,
    // and the PR moves toward compliance.
    const dep = { ...OLD, version: '1.0.1', times: { '1.0.0': '2026-05-01', '1.0.2': '2026-07-01' } };
    const w = world({ deps: { oldpkg: dep } });
    const base = JSON.parse(JSON.stringify(w.lock));
    base.packages['node_modules/oldpkg'] = { version: '1.0.0' };
    const ok = run([
      '--pr', ...w.args,
      '--changed-files', changed(['package.json', 'package-lock.json']),
      '--base-lockfile', write('base-lock.json', base),
    ]);
    expect(`${ok.code}: ${ok.out}`).toContain('Nothing out of policy introduced');
    expect(ok.code).toBe(0);
    // The same change in REVERSE (a downgrade that stays old) is blocked.
    base.packages['node_modules/oldpkg'] = { version: '1.0.2' };
    const back = run([
      '--pr', ...w.args,
      '--changed-files', changed(['package.json', 'package-lock.json']),
      '--base-lockfile', write('base-lock-down.json', base),
    ]);
    expect(back.out).toMatch(/OUTDATED\s+oldpkg/);
    expect(back.code).toBe(1);
  });

  test('an EXPIRED waiver fails a dependency PR even when nothing out of policy is introduced', () => {
    const w = world({ deps: { fresh: FRESH }, waivers: [{ ...WAIVER, expires: '2026-11-22' }] });
    const base = JSON.parse(JSON.stringify(w.lock));
    base.packages['node_modules/fresh'] = { version: '0.9.0' };
    const { code, out } = run([
      '--pr', ...w.args,
      '--changed-files', changed(['package.json', 'package-lock.json']),
      '--base-lockfile', write('base-lock.json', base),
    ]);
    expect(out).toContain('EXPIRED waiver: vulnpkg');
    // It measured the PR (and found nothing introduced) — the expiry alone fails it.
    expect(out).toMatch(/1 lockfile entry changed/);
    expect(out).not.toMatch(/OUTDATED|VULNERABLE/);
    expect(code).toBe(1);
  });

  test('an EXPIRED waiver fails a PR that changes only the waiver file', () => {
    const w = world({ waivers: [{ ...WAIVER, expires: '2026-11-22' }] });
    const { code, out } = run(['--pr', ...w.args, '--changed-files', changed([WAIVERS])]);
    expect(out).toContain('EXPIRED waiver: vulnpkg');
    expect(out).toContain('No lockfile entry was added or re-versioned');
    expect(code).toBe(1);
  });

  test('a PR that edits the waiver file into a malformed state is blocked', () => {
    const w = world({ waivers: [{ ...WAIVER, jira: 'none' }] });
    const { code, out } = run(['--pr', ...w.args, '--changed-files', changed([WAIVERS])]);
    expect(out).toContain('malformed waiver');
    expect(code).toBe(1);
  });

  test('an unhashable advisory is reported as malformed, not a crash', () => {
    const w = world({ waivers: [{ ...WAIVER, advisory: ['GHSA-aaaa-bbbb-cccc'] }] });
    const { code, out } = run(['--pr', ...w.args, '--changed-files', changed([WAIVERS])]);
    expect(out).toContain('malformed waiver');
    expect(out).not.toContain('Traceback');
    expect(code).toBe(1);
  });
});

describe('CTL-081 — the real repo', () => {
  test('the waiver file exists, cites SEC-197, and validates', () => {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, WAIVERS), 'utf-8'));
    expect(Array.isArray(data.waivers)).toBe(true);
    expect(data.ticket).toBe('SEC-197');
    const { code, out } = run(['--check-waivers', '--today', TODAY]);
    expect(`${code}: ${out}`).toContain('Waiver file OK');
    expect(code).toBe(0);
  });

  // WHERE a gate runs is configuration, not behaviour; a correct script wired
  // nowhere is the SEC-79 defect, and YAML is the only witness. Counted in the
  // CTL-077 baseline rather than annotated, so a later convertible block in
  // this file still trips the ratchet.
  describe('wiring', () => {
    const prChecks = yaml.load(fs.readFileSync(path.join(ROOT, SRC.prChecks), 'utf-8'));
    const audit = yaml.load(fs.readFileSync(path.join(ROOT, SRC.securityAudit), 'utf-8'));
    const freshWf = yaml.load(fs.readFileSync(path.join(ROOT, SRC.dependencyFreshness), 'utf-8'));
    const watched = JSON.parse(fs.readFileSync(path.join(ROOT, SRC.workflowFreshness), 'utf-8')).watched;
    const dependabot = yaml.load(fs.readFileSync(path.join(ROOT, SRC.dependabot), 'utf-8'));
    const runs = (job) => (job.steps || []).map((s) => s.run || '').join('\n');

    test('pr-checks runs the self-test and the --pr gate against the PR base', () => {
      const script = runs(prChecks.jobs.checks);
      expect(script).toContain(`python3 ${SRC.checkDependencyFreshness} --self-test`);
      expect(script).toContain(`python3 ${SRC.checkDependencyFreshness} --pr --base "$BASE_REF"`);
      const step = prChecks.jobs.checks.steps.find((st) => (st.run || '').includes('--pr --base'));
      // The base must be the PR's base branch, or "what this PR introduces" is
      // measured against the wrong tree.
      expect(step.env.BASE_REF).toBe('origin/${{ github.base_ref }}');
    });

    test('the daily report runs in its OWN workflow, with its own CTL-072 freshness entry', () => {
      // Not a job in security-audit.yml: CTL-072 counts ANY successful run, so a
      // daily job there would mask a weekly audit that stopped succeeding.
      expect(freshWf.on.schedule.map((s) => s.cron)).toEqual(['40 5 * * *']);
      expect(freshWf.on).toHaveProperty('workflow_dispatch');
      const script = runs(freshWf.jobs.freshness);
      expect(script).toContain(`python3 ${SRC.checkDependencyFreshness} --report --report-only`);
      expect(script).toContain('gh issue');
      expect(watched[path.basename(SRC.dependencyFreshness)].max_age_hours).toBeLessThanOrEqual(36);
      expect(watched[path.basename(SRC.securityAudit)].max_age_hours).toBe(192);
    });

    test('the issue step still runs when the measure step fails on an expired waiver', () => {
      const steps = freshWf.jobs.freshness.steps;
      const measure = steps.find((st) => st.id === 'fresh');
      const issue = steps.find((st) => (st.run || '').includes('gh issue create'));
      expect(measure).toBeDefined();
      expect(issue.if).toContain('always()');
      // ...and an expired or malformed waiver keeps the issue open.
      expect(issue.env.EXPIRED).toBe('${{ steps.fresh.outputs.expired }}');
      expect(issue.env.MALFORMED).toBe('${{ steps.fresh.outputs.malformed }}');
    });

    test('security-audit.yml is left as the weekly belt-and-braces audit (KAN-361)', () => {
      expect(audit.on.schedule.map((s) => s.cron)).toEqual(['0 7 * * 3']);
      expect(Object.keys(audit.jobs)).toEqual(['audit']);
      expect(runs(audit.jobs.audit)).not.toContain(SRC.checkDependencyFreshness);
    });

    test('dependabot covers npm and github-actions, targets develop, at most weekly', () => {
      const byEco = Object.fromEntries(dependabot.updates.map((u) => [u['package-ecosystem'], u]));
      for (const eco of ['npm', 'github-actions']) {
        expect(byEco[eco]).toBeDefined();
        expect(byEco[eco]['target-branch']).toBe('develop');
        expect(['daily', 'weekly']).toContain(byEco[eco].schedule.interval);
      }
    });
  });
});
