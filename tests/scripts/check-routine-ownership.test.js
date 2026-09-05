const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SRC } = require('../support/source-paths.json');

// The guard under test resolves the repo root from its own location
// ($SCRIPT_DIR/..), so to exercise the failure paths deterministically we
// copy it into a throwaway fixture tree and populate just the files it reads.
// Running the copy checks the fixture, not the real repo — no repo mutation.
const REAL_SCRIPT = path.resolve(
  __dirname,
  '../../scripts/check-routine-ownership.sh',
);

// The four target files and a minimal body that carries EVERY required marker.
// Keep these in sync with check-marker() calls in the script.
const GOOD_FILES = {
  [SRC.weeklyReport]: [
    'name: Weekly Status Report',
    '# Section 1 reads the liveness owner:',
    'gh run list --workflow=health-check.yml -L 1',
    'echo "_Source of record: **Daily Security routine** (docs/DAILY_SECURITY_CHECK.md)._"',
    // SEC-153 Section 15b: reports a RELEASE concern, so it must keep naming
    // the release owner rather than becoming a second authority on it.
    '# Source of record: **Weekly Health + Regression routine**.',
  ].join('\n'),
  [SRC.securityAudit]: [
    'name: Weekly Security Audit',
    '# KAN-361 — Belt-and-braces only. Authoritative sweep = the',
    '# Daily Security routine (docs/DAILY_SECURITY_CHECK.md).',
  ].join('\n'),
  'docs/ENDPOINT_HEALTH_AUDIT.md': [
    '# Endpoint Health Audit',
    '> POINT-IN-TIME SNAPSHOT — 31 Mar 2026. Do not treat as current.',
  ].join('\n'),
  'docs/OPS_ROUTINES_CONTROL_ROOM.md': [
    '# Ops Routines Control Room',
    '**One concern → one owner.** Every routine cites the owner.',
    '### Concern → single owner (KAN-361)',
    '- **Staging-soak of record** = the Staging Soak routine (KAN-413).',
  ].join('\n'),
  // KAN-413 — Staging Soak routine + un-skippable signup-gate markers.
  'docs/STAGING_SOAK_ROUTINE.md': [
    '# Staging Soak',
    '## The release contract — what good looks like on staging',
  ].join('\n'),
  [SRC.signupSurface]: [
    '# Lyra sign-up / account-creation surface',
    'src/app/(auth)/signup/**',
  ].join('\n'),
};

// Build a fixture tree in a fresh temp dir, write the given file map, copy the
// real guard into <tree>/scripts/, and return the copied script's path.
function buildTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kan361-guard-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  const dest = path.join(dir, 'scripts', 'check-routine-ownership.sh');
  fs.copyFileSync(REAL_SCRIPT, dest);
  fs.chmodSync(dest, 0o755);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body + '\n');
  }
  return { dir, dest };
}

// Run a copied guard. Returns { code, out } (stdout+stderr merged).
function run(scriptPath) {
  try {
    const out = execSync(`bash "${scriptPath}" 2>&1`, { stdio: 'pipe' }).toString();
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || Buffer.from('')).toString() };
  }
}

describe(SRC.checkRoutineOwnership, () => {
  let source = '';
  beforeAll(() => {
    source = fs.readFileSync(REAL_SCRIPT, 'utf8');
  });

  it('exists, is bash, and is syntactically valid', () => {
    expect(fs.existsSync(REAL_SCRIPT)).toBe(true);
    expect(source.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(() =>
      execSync(`bash -n "${REAL_SCRIPT}"`, { stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('is hardened (set -euo pipefail) and never silent-skips', () => {
    expect(source).toMatch(/set -euo pipefail/);
    // No error-swallowing on the checks (KAN-167 / Workflow Integrity Policy).
    // Strip comment lines so prose describing the policy doesn't trip this.
    const code = source
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(code).not.toMatch(/\|\|\s*true/);
    expect(code).not.toMatch(/2>\/dev\/null/);
  });

  it('PASSES (exit 0) on the REAL repo tree', () => {
    const { code, out } = run(REAL_SCRIPT);
    expect(code).toBe(0);
    expect(out).toMatch(/PASS — all KAN-361/);
  });

  it('PASSES on a fixture tree carrying every marker', () => {
    const { dir, dest } = buildTree(GOOD_FILES);
    try {
      const { code, out } = run(dest);
      expect(code).toBe(0);
      expect(out).toMatch(/PASS/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Removing any single ownership marker must fail the guard (exit 1).
  const MARKER_REMOVALS = [
    {
      name: 'weekly-report drops the health-check.yml liveness read',
      file: SRC.weeklyReport,
      strip: /gh run list --workflow=health-check\.yml -L 1/,
    },
    {
      name: 'security-audit loses its belt-and-braces demotion header',
      file: SRC.securityAudit,
      strip: /Belt-and-braces only\. Authoritative sweep = the/,
    },
    {
      name: 'security-audit stops citing the Daily Security routine',
      file: SRC.securityAudit,
      strip: /Daily Security routine \(docs\/DAILY_SECURITY_CHECK\.md\)\./,
    },
    {
      name: 'weekly-report Section 5 drops the Daily-Security source-of-record cite',
      file: SRC.weeklyReport,
      strip: /Source of record: \*\*Daily Security routine\*\*/,
    },
    {
      name: 'weekly-report Section 15b drops the release source-of-record cite',
      file: SRC.weeklyReport,
      strip: /Source of record: \*\*Weekly Health/,
    },
    {
      name: 'ENDPOINT_HEALTH_AUDIT loses its point-in-time snapshot banner',
      file: 'docs/ENDPOINT_HEALTH_AUDIT.md',
      strip: /POINT-IN-TIME SNAPSHOT/,
    },
    {
      name: 'OPS_ROUTINES_CONTROL_ROOM drops the one-concern-one-owner rule',
      file: 'docs/OPS_ROUTINES_CONTROL_ROOM.md',
      strip: /One concern → one owner\./,
    },
    {
      name: 'OPS_ROUTINES_CONTROL_ROOM drops the concern→owner map heading',
      file: 'docs/OPS_ROUTINES_CONTROL_ROOM.md',
      strip: /Concern → single owner/,
    },
    {
      name: 'OPS_ROUTINES_CONTROL_ROOM drops the staging-soak owner marker (KAN-413)',
      file: 'docs/OPS_ROUTINES_CONTROL_ROOM.md',
      strip: /Staging-soak of record/,
    },
    {
      name: 'STAGING_SOAK_ROUTINE loses its release-contract marker (KAN-413)',
      file: 'docs/STAGING_SOAK_ROUTINE.md',
      strip: /release contract/,
    },
    {
      name: 'signup-surface manifest drops the sign-up form path (KAN-413)',
      file: SRC.signupSurface,
      strip: /src\/app\/\(auth\)\/signup\/\*\*/,
    },
  ];

  MARKER_REMOVALS.forEach(({ name, file, strip }) => {
    it(`FAILS (exit 1) when ${name}`, () => {
      const mutated = { ...GOOD_FILES };
      mutated[file] = GOOD_FILES[file]
        .split('\n')
        .filter((l) => !strip.test(l))
        .join('\n');
      const { dir, dest } = buildTree(mutated);
      try {
        const { code, out } = run(dest);
        expect(code).toBe(1);
        expect(out).toMatch(/::error::KAN-361 ownership guard/);
        expect(out).toMatch(/FAIL —/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it('FAILS (exit 1) — a missing target file is never a silent pass', () => {
    const mutated = { ...GOOD_FILES };
    delete mutated['docs/ENDPOINT_HEALTH_AUDIT.md'];
    const { dir, dest } = buildTree(mutated);
    try {
      const { code, out } = run(dest);
      expect(code).toBe(1);
      expect(out).toMatch(/MISSING FILE: docs\/ENDPOINT_HEALTH_AUDIT\.md/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
