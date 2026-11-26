const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { SRC } = require('../support/source-paths.json');

const REPO_ROOT = path.resolve(__dirname, '../../');
// Reached via SRC and seeded in source-path-seeds.ts, so a move updates one
// line rather than turning this into `execFileSync(undefined)` — which reads as
// a broken harness rather than a lost control (gotcha #31).
const SCRIPT = path.join(REPO_ROOT, SRC.checkSoakClassifierCoverage);
const BASELINE = path.join(REPO_ROOT, 'tests/support/soak-classifier-baseline.json');
const SOAK = path.join(REPO_ROOT, SRC.stagingSoak);

/**
 * BUGS-103 / CTL-069 — a soak verdict decided by inline bash is reachable by
 * no test, and therefore cannot be observed to be wrong.
 *
 * THE DEFECT. `C1-sitemap-fresh` asserted `Cache-Control: no-store|no-cache`.
 * `src/app/sitemap.ts` is a Next *metadata route*, and that loader hardcodes
 * the header to the constant `public, max-age=0, must-revalidate` — byte
 * identical whether the route is force-dynamic or prerendered. So the probe
 * could never return PASS, and could not have detected SEC-100, the defect it
 * existed for. It shipped red and stayed red for four days, while the soak's
 * own FAIL-alert email was dead (BUGS-99) so nobody was told.
 *
 * WHAT THIS CONTROL DOES AND DOES NOT CLAIM. It gates only the second of the
 * two properties that made that possible:
 *
 *   1. the instrument did not vary with the property — catchable only by
 *      measuring a real server, never by a static check;
 *   2. the decision was INLINE, so nothing executed either branch and nothing
 *      could observe that PASS was unreachable.
 *
 * A green run here means these verdicts CAN be tested. It does NOT mean they
 * are right. That distinction is the honest limit of this control and is
 * stated in its header, its registry entry and here.
 */

function run(args = []) {
  try {
    return {
      code: 0,
      out: execFileSync('python3', [SCRIPT, ...args], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      }).toString(),
    };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

describe('CTL-069 — the checker', () => {
  test('its --self-test passes', () => {
    const r = run(['--self-test']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/self-test: (\d+)\/\1 passed/);
    // Anchored to the failure MARKER (`  FAIL <name>` at line start), not to
    // the substring. A bare /FAIL / also matches this checker's own case names
    // — "an inline record FAIL is detected" — so the loose version failed on a
    // fully passing run. Caught by running it, which is the only way this class
    // ever is.
    expect(r.out).not.toMatch(/^\s*FAIL\s/m);
  });

  test('the real soak script matches the real baseline', () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/matches the baseline/);
  });
});

describe('the baseline is a work list, not a rubber stamp', () => {
  test('it is non-empty and every entry is a real verdict site', () => {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const sites = base.inline_fail_sites;

    // Assert the corpus BEFORE iterating (catalogue failure mode 4). An empty
    // baseline would make every assertion below vacuously true, and would also
    // be indistinguishable from "all extracted" — the state this ratchet exists
    // to move towards.
    expect(Array.isArray(sites)).toBe(true);
    expect(sites.length).toBeGreaterThan(0);

    // ⚠️ COMMENTS STRIPPED FIRST. `expect(soak).toContain('record FAIL')`
    // against the raw text is satisfied by the soak's own prose — the file
    // discusses `record FAIL` by name — so deleting the code would leave the
    // assertion green. CTL-039 caught exactly that in the first cut of this
    // test, which is the catalogue's failure mode 2: the better a thing is
    // documented, the weaker a source-text scan of it becomes.
    const soakCode = fs
      .readFileSync(SOAK, 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .map((l) => (l.indexOf(' #') !== -1 ? l.slice(0, l.indexOf(' #')) : l))
      .join('\n');

    for (const site of sites) {
      // A baseline naming a clause that does not exist is a suppression entry
      // for nothing — and it must be found in CODE, not in a comment.
      expect(soakCode).toContain(site);
    }
  });

  test('the count field agrees with the list it summarises', () => {
    // A hand-editable number beside a generated list is catalogue failure mode
    // 8 waiting to happen.
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    expect(base.count).toBe(base.inline_fail_sites.length);
  });

  test('the extracted classifier is recorded as delegated, not as inline', () => {
    // C1-sitemap-fresh is the one clause BUGS-103 already fixed. If it ever
    // reappears as an inline site, the fix has been reverted.
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    expect(base.delegated_sites).toContain('C1-sitemap-fresh');
    expect(base.inline_fail_sites).not.toContain('C1-sitemap-fresh');
  });
});

describe('extraction is only credited when it is tested', () => {
  test('every scripts/classify-*.sh has a test asserting BOTH verdicts', () => {
    // Extraction without tests is the same untestable decision in a new file.
    // Without this, "extract it" would be a way to leave the baseline for free.
    const scriptsDir = path.join(REPO_ROOT, 'scripts');
    const classifiers = fs
      .readdirSync(scriptsDir)
      .filter((f) => f.startsWith('classify-') && f.endsWith('.sh'));

    expect(classifiers.length).toBeGreaterThan(0);

    for (const c of classifiers) {
      const testFile = path.join(
        REPO_ROOT, 'tests/scripts', c.replace(/\.sh$/, '.test.js'));
      expect(fs.existsSync(testFile)).toBe(true);
      const text = fs.readFileSync(testFile, 'utf8');
      // comment-assertion-ok: BUGS-103 the subject here is a TEST file, not
      // production code. CTL-039 exists because a comment can satisfy a scan of
      // the CODE it documents, letting the code be deleted; that hazard does
      // not apply when the thing being asserted about is itself a test, where a
      // mention of PASS/FAIL in any form is exactly what is being counted. The
      // real enforcement is the python arm (`untested_classifiers`), which this
      // duplicates across layers on purpose.
      expect(text).toContain('PASS');
      expect(text).toContain('FAIL');
    }
  });
});

describe('it is wired in', () => {
  test('pr-checks.yml runs both the self-test and the check', () => {
    // The FULL commands, not the script name and the flag separately — two
    // assertions can otherwise be satisfied by lines other than the ones meant.
    const wf = fs.readFileSync(
      path.join(REPO_ROOT, SRC.prChecks), 'utf8');
    expect(wf).toContain(`python3 ${SRC.checkSoakClassifierCoverage} --self-test`);
    expect(wf).toContain(`python3 ${SRC.checkSoakClassifierCoverage}\n`);
  });

  test('is registered in the control registry', () => {
    const reg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'controls/registry.json'), 'utf8'));
    const controls = reg.controls || reg;
    const entry = controls.find((c) => c.id === 'CTL-069');
    expect(entry).toBeDefined();
    expect(entry.implementation).toBe(SRC.checkSoakClassifierCoverage);
    expect(entry.prevents).toContain('BUGS-103');
    // The stated gap must survive in the registry, not just in the source
    // header — the registry is what an audit reads.
    expect(entry.summary).toMatch(/not that they are RIGHT/);
  });
});
