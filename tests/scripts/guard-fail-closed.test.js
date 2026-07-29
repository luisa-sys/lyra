const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../');

// SEC-109 — the "clean scan that never ran" class.
//
// grep exits 1 for "no match" and >=2 when the SEARCH ITSELF failed. Three
// guards collapsed the two with `|| true`, and because each one's clean result
// is an EMPTY match list, a failed search read as a pass:
//
//   check-service-role-client.sh   printed "All service-role clients go through
//                                  the factory ✓" and exited 0
//   check-workflow-integrity.sh    printed "No workflow integrity issues found"
//                                  and exited 0
//   check-server-action-exports.sh aborted with a bare exit 2 and NO message —
//                                  indistinguishable from a broken harness
//
// That is the SEC-79 shape (a control reporting green while not operating) and
// the KAN-167 false-green policy. These tests pin the fixed contract: a search
// that could not run exits 2 and says why. They are written as behaviour, not
// source-text assertions, so a future rewrite cannot quietly regress them.
//
// Exit codes for all three: 0 clean · 1 violation found · 2 could not verify.

function runIn(dir, script, { pathPrefix } = {}) {
  const env = { ...process.env };
  if (pathPrefix) env.PATH = `${pathPrefix}:${process.env.PATH}`;
  let status = 0;
  let output = '';
  try {
    output = execSync(`bash ${JSON.stringify(path.join(REPO_ROOT, 'scripts', script))}`, {
      cwd: dir,
      stdio: 'pipe',
      env,
    }).toString();
  } catch (err) {
    status = err.status || 1;
    output = `${err.stdout || ''}${err.stderr || ''}`;
  }
  return { status, output };
}

// A tree with the estate directories present but NO src/ — the realistic
// "run from the wrong directory, or src/ moved" failure.
function makeTreeWithoutSrc() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'failclosed-'));
  fs.mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github/workflows/a.yml'), 'on: push\njobs: {}\n');
  return dir;
}

// A PATH shim whose `grep` always exits 2 — deterministic proof of the
// "the search command itself failed" branch, independent of filesystem quirks
// (notably: running as root bypasses chmod, so unreadable-file mutations
// silently do not reproduce).
function makeFailingGrepShim(dir) {
  const bin = path.join(dir, 'shimbin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'grep'), '#!/bin/sh\nexit 2\n');
  fs.chmodSync(path.join(bin, 'grep'), 0o755);
  return bin;
}

describe('guard fail-closed contract (SEC-109)', () => {
  let dir;
  beforeEach(() => {
    dir = makeTreeWithoutSrc();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('check-service-role-client.sh', () => {
    it('exits 2 — not 0 with a green tick — when src/ cannot be searched', () => {
      const { status, output } = runIn(dir, 'check-service-role-client.sh');
      expect(status).toBe(2);
      expect(output).toMatch(/the search command failed/);
      // The exact regression: it must NOT claim the codebase is clean.
      expect(output).not.toMatch(/All service-role clients go through/);
    });

    it('exits 2 when grep itself fails', () => {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      const { status, output } = runIn(dir, 'check-service-role-client.sh', {
        pathPrefix: makeFailingGrepShim(dir),
      });
      expect(status).toBe(2);
      expect(output).toMatch(/Failing closed/);
    });
  });

  describe('check-server-action-exports.sh', () => {
    it('exits 2 with an explanatory message when src/ cannot be searched', () => {
      const { status, output } = runIn(dir, 'check-server-action-exports.sh');
      expect(status).toBe(2);
      // Previously this aborted with exit 2 and NO output at all, which reads
      // as a broken harness rather than an unverified control.
      expect(output).toMatch(/the search command failed/);
      expect(output).not.toMatch(/No 'use server' module files found/);
    });
  });

  describe('check-workflow-integrity.sh', () => {
    it('exits 2 — not 0 with a green tick — when a workflow file cannot be scanned', () => {
      const { status, output } = runIn(dir, 'check-workflow-integrity.sh', {
        pathPrefix: makeFailingGrepShim(dir),
      });
      expect(status).toBe(2);
      expect(output).toMatch(/could not scan/);
      // The exact regression: it must NOT report the workflows clean. This gate
      // exists because a false green here cost ~32 days of dead promotes (BUGS-4).
      expect(output).not.toMatch(/No workflow integrity issues found/);
    });
  });

  describe('all three still pass on the real repo', () => {
    it.each([
      'check-service-role-client.sh',
      'check-server-action-exports.sh',
      'check-workflow-integrity.sh',
    ])('%s exits 0 against the actual tree', (script) => {
      const { status } = runIn(REPO_ROOT, script);
      expect(status).toBe(0);
    });
  });
});
