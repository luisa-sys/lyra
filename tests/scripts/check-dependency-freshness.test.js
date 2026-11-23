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
 *   COVERED  the wiring: the PR gate runs in pr-checks.yml, the daily report
 *            runs in security-audit.yml without disturbing the Wednesday audit,
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
function world({ deps = {}, vulns = {}, waivers = [], node = null, index = null } = {}) {
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
        time: { [d.version]: d.published, [d.latest]: d.latestPublished || TODAY },
      }),
    );
  }
  for (const v of Object.values(vulns)) {
    for (const node of v.nodes) lock.packages[node] = lock.packages[node] || { version: '1.0.0' };
  }
  const wfDir = path.join(dir, `${n}-workflows`);
  fs.mkdirSync(wfDir);
  if (node) fs.writeFileSync(path.join(wfDir, 'ci.yml'), `      - uses: x\n        with:\n          node-version: '${node}'\n`);
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const v of Object.values(vulns)) counts[v.severity] += 1;
  return {
    pj,
    lock,
    args: [
      '--today', TODAY,
      '--package-json', write('package.json', pj),
      '--lockfile', write('package-lock.json', lock),
      '--audit-json', write('audit.json', {
        vulnerabilities: vulns,
        metadata: { vulnerabilities: { ...counts, total: Object.keys(vulns).length } },
      }),
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
    expect(cases).toBeGreaterThanOrEqual(58);
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

  test('a PR that edits the waiver file into a malformed state is blocked', () => {
    const w = world({ waivers: [{ ...WAIVER, jira: 'none' }] });
    const { code, out } = run(['--pr', ...w.args, '--changed-files', changed([WAIVERS])]);
    expect(out).toContain('malformed waiver');
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

  // source-scan-ok: SEC-197 — WHERE a gate runs is configuration, not behaviour; a
  // correct script wired nowhere is the SEC-79 defect, and YAML is the only witness.
  describe('wiring', () => {
    const prChecks = yaml.load(fs.readFileSync(path.join(ROOT, SRC.prChecks), 'utf-8'));
    const audit = yaml.load(fs.readFileSync(path.join(ROOT, SRC.securityAudit), 'utf-8'));
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

    test('security-audit runs the daily report, keeps the Wednesday audit weekly, and files an issue', () => {
      const crons = audit.on.schedule.map((s) => s.cron);
      expect(crons[0]).toBe('0 7 * * 3');
      const daily = crons.filter((c) => / \* \* \*$/.test(c));
      expect(daily).toHaveLength(1);
      // The weekly npm audit must not start running (and emailing) daily: its
      // job is gated to the Wednesday cron or a manual run.
      expect(audit.jobs.audit.if).toContain(`github.event.schedule == '${crons[0]}'`);
      expect(audit.jobs.audit.if).toContain("github.event_name != 'schedule'");
      const fresh = audit.jobs.freshness;
      expect(fresh).toBeDefined();
      expect(fresh.if).toBeUndefined();
      const script = runs(fresh);
      expect(script).toContain(`python3 ${SRC.checkDependencyFreshness} --report --report-only`);
      expect(script).toContain('gh issue');
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
