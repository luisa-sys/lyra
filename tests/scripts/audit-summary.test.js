/**
 * CTL-050 / SEC-136 — the weekly security audit must not report clean when it
 * could not measure.
 *
 * WHAT WENT WRONG
 * ---------------
 * Both halves of `security-audit.yml` converted a failure-to-measure into a
 * clean result:
 *
 *   - the workflow's inline `except: print(0)` fed `if: … != '0'` on the ONLY
 *     failing step, so a parse failure SKIPPED the failure and the run passed;
 *   - `audit-to-email.py`'s `except` returned `has_vulnerabilities: False`,
 *     which suppressed the alert email.
 *
 * Green tick, no email, nothing assessed. The trigger was real and mundane:
 * `> report.json 2>&1` merged npm's warnings into the JSON, and npm warns
 * routinely.
 *
 * These tests reach the REAL scripts by subprocess (CTL-038) — a private copy
 * of the parsing would keep passing while the shipped one failed open, which
 * is the exact defect under test.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { SRC } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../support/source-paths.json'), 'utf-8'),
);
const READER = SRC.auditSummary;
const EMAILER = SRC.auditToEmail;

function run(script, args) {
  try {
    return { code: 0, out: execFileSync('python3', [script, ...args], { cwd: ROOT, encoding: 'utf-8' }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

/** A minimal but VALID npm audit report. */
const REPORT = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 2, critical: 3 } },
});

let dir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl050-'));
});
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const write = (name, body) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body);
  return p;
};

describe('CTL-050 — the audit reader', () => {
  test('its self-test passes and has not shrunk', () => {
    const { code, out } = run(READER, ['--self-test']);
    expect(`${code}: ${out.trim()}`).toContain('Self-test passed');
    expect(code).toBe(0);
    const n = Number(/Self-test passed \((\d+) cases\)/.exec(out)?.[1] ?? 0);
    expect(n).toBeGreaterThanOrEqual(12);
  });

  test('a valid report yields the counts, and high_critical is their sum', () => {
    // The happy path must work, or every failure case below could be passing
    // because the script is simply broken.
    const { code, out } = run(READER, [write('ok.json', REPORT)]);
    expect(code).toBe(0);
    expect(out).toContain('high=2');
    expect(out).toContain('critical=3');
    expect(out).toContain('high_critical=5');
    expect(out).toContain('total=6');
  });

  test.each([
    ['an npm warning merged into the JSON', 'npm warn config production\n' + REPORT],
    ['an empty file', ''],
    ['whitespace only', '   \n '],
    ['an HTML error page', '<html>502 Bad Gateway</html>'],
    ['a JSON array', '[]'],
    ['a JSON null', 'null'],
    ['an empty object', '{}'],
    ['an error envelope', '{"error":{"code":"ENOLOCK"}}'],
    ['metadata with no vulnerabilities object', '{"auditReportVersion":2,"metadata":{}}'],
  ])('%s FAILS CLOSED rather than reporting zero', (label, body) => {
    const { code, out } = run(READER, [write(`bad-${label.replace(/\W+/g, '-')}.json`, body)]);
    // Exit 2 = could not measure, deliberately distinct from 1 = found something.
    expect(`${label} -> exit ${code}`).toBe(`${label} -> exit 2`);
    expect(out).toContain('::error::');
    // Crucially: it must not have printed a count it did not read.
    expect(out).not.toMatch(/^high_critical=/m);
  });

  test('a missing file fails closed', () => {
    const { code, out } = run(READER, [path.join(dir, 'nope.json')]);
    expect(code).toBe(2);
    expect(out).toContain('::error::');
  });

  test('a genuinely clean report still reads zero — the gate must not always fire', () => {
    // A gate that fires on everything is one people learn to wave through.
    const clean = write('clean.json', '{"auditReportVersion":2,"metadata":{"vulnerabilities":{"high":0}}}');
    const { code, out } = run(READER, [clean]);
    expect(code).toBe(0);
    expect(out).toContain('high_critical=0');
  });
});

describe('CTL-050 — the alert emailer', () => {
  test('an unreadable audit produces an ALERT, not a no-vuln payload', () => {
    // This is the half that decided whether Luisa heard about it at all.
    const { out } = run(EMAILER, [path.join(dir, 'missing.json')]);
    const payload = JSON.parse(out.trim().split('\n').filter((l) => l.startsWith('{')).pop());
    expect(payload.has_vulnerabilities).toBe(true);
    expect(payload.subject).toMatch(/COULD NOT RUN/);
    expect(payload.html).toMatch(/UNKNOWN/);
  });

  test('a corrupted audit produces an ALERT', () => {
    const p = write('corrupt.json', 'npm warn something\n' + REPORT);
    const { out } = run(EMAILER, [p]);
    const payload = JSON.parse(out.trim().split('\n').filter((l) => l.startsWith('{')).pop());
    expect(payload.has_vulnerabilities).toBe(true);
  });

  test('a clean audit still sends nothing', () => {
    const p = write('clean-email.json', '{"auditReportVersion":2,"metadata":{"vulnerabilities":{"high":0,"critical":0}}}');
    const { out } = run(EMAILER, [p]);
    expect(JSON.parse(out.trim()).has_vulnerabilities).toBe(false);
  });
});

describe('CTL-050 — wired in, and the old defects cannot return', () => {
  const wf = fs.readFileSync(path.join(ROOT, SRC.securityAudit), 'utf-8');

  test('the workflow calls the reader instead of parsing inline', () => {
    expect(wf).toContain(READER);
    // The reader must run for real, not only as --self-test.
    const live = wf
      .split('\n')
      .filter((l) => l.includes(`python3 ${READER}`) && !l.includes('--self-test') && !/^\s*echo\b/.test(l.trim()));
    expect(live.length).toBeGreaterThan(0);
  });

  test('stderr is no longer merged into the JSON report', () => {
    // `> file 2>&1` is the root cause. It must not come back.
    expect(wf).not.toMatch(/npm audit --json\s*>\s*\S+\s+2>&1/);
    expect(wf).toMatch(/npm audit --json\s*>\s*\S+\s+2>\s*\S+/);
  });

  test('no bare `except:` swallows a parse failure anywhere in the audit path', () => {
    for (const rel of [READER, EMAILER]) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
      expect(`${rel} has a bare except: ${/^\s*except:\s*$/m.test(src)}`).toBe(
        `${rel} has a bare except: false`,
      );
    }
  });

  test('it is registered in the control registry', () => {
    const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'controls/registry.json'), 'utf-8'));
    const e = reg.controls.find((c) => c.id === 'CTL-050');
    expect(e).toBeDefined();
    expect(e.implementation).toBe(READER);
    expect(e.prevents).toContain('SEC-136');
  });
});
