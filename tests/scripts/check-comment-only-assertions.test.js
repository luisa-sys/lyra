/**
 * Guard test for CTL-039 (scripts/check-comment-only-assertions.py) — KAN-440.
 *
 * SEC-79 is the precedent for why a control needs its own test rather than
 * trusting the workflow step that invokes it: `health-check.yml` and
 * `weekly-report.yml` sat disabled for over a month while reporting green.
 *
 * The important case here is the last one. A gate that never fires is
 * indistinguishable from no gate, and this control's first cut reported ZERO
 * findings on a repo with three known instances — it split scopes at
 * `describe(` when the real files read a different subject in each `test()`.
 * That bug passed a self-test whose fixtures were single-line. So this asserts
 * the control FIRES, against a fixture shaped like the real thing.
 *
 * comment-assertion-ok: KAN-440 this file BUILDS fixture source containing a
 * deliberately comment-satisfied assertion, so CTL-039 reads its own probe as a
 * real finding. Exempting the file is correct; exempting a file that genuinely
 * scans source would not be.
 */
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { SRC } = require('../support/source-paths.json');

const ROOT = resolve(__dirname, '../..');
const REGISTRY = 'controls/registry.json';
const SCRIPT = resolve(ROOT, SRC.checkCommentOnlyAssertions);
const BASELINE = resolve(ROOT, 'tests/support/comment-assertion-baseline.json');

const run = (args = []) =>
  spawnSync('python3', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf-8' });

describe('CTL-039 — comment-satisfied assertion ratchet', () => {
  it('passes its own self-test', () => {
    const r = run(['--self-test']);
    expect(r.stdout).toContain('self-test: OK');
    expect(r.status).toBe(0);
  });

  it('is green against the committed baseline', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('none new, none stale');
  });

  it('fails CLOSED (exit 2) when the baseline is absent', () => {
    // Move the real file aside so the absence is genuine — asserting it by
    // "never creating the file" silently inverts once the file is tracked,
    // which is exactly how the F8 fail-closed case broke.
    const tmp = resolve(os.tmpdir(), `ctl039-baseline-${process.pid}.json`);
    fs.renameSync(BASELINE, tmp);
    try {
      const r = run();
      expect(r.status).toBe(2);
      expect(r.stdout).toContain('Failing closed');
    } finally {
      fs.renameSync(tmp, BASELINE);
    }
  });

  it('is registered and wired into CI', () => {
    const registry = JSON.parse(fs.readFileSync(resolve(ROOT, REGISTRY), 'utf-8'));
    const ctl = registry.controls.find((c) => c.id === 'CTL-039');
    expect(ctl).toBeDefined();
    expect(ctl.implementation).toBe(SRC.checkCommentOnlyAssertions);
    expect(ctl.prevents).toContain('SEC-100');

    const wf = fs.readFileSync(resolve(ROOT, SRC.prChecks), 'utf-8');
    expect(wf).toContain(`${SRC.checkCommentOnlyAssertions} --self-test`);
  });

  it('still records the two mutation-verified instances', () => {
    // These are the cases proven by deleting the guarded code and watching the
    // original scan stay green. They must remain baselined until actually
    // fixed; "fixing" one by deleting its baseline entry trips the stale check.
    const { findings } = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'));

    const sitemap = findings.find(
      (f) => f.subject === SRC.sitemap && f.assertion === 'is_published',
    );
    expect(sitemap).toBeDefined();
    // `is_published` is in the query AND the comment explaining it, so the
    // guard would survive deleting the filter — SEC-100's exact shape.
    expect(sitemap.severity).toBe('comment-shadowed');

    // The case where the comment was WRITTEN to satisfy the scan.
    const page = findings.find(
      (f) =>
        f.subject === SRC.profilePage &&
        f.assertion.includes('conversation_starter_prompts'),
    );
    expect(page).toBeDefined();
  });

  it('FIRES on a newly-introduced comment-satisfied assertion', () => {
    // The control must be seen to fail. The fixture is shaped like the real
    // files — a describe wrapping a test that does its own readFileSync —
    // because the first implementation passed a single-line self-test while
    // finding nothing at all in the repo.
    const rel = 'tests/unit/__ctl039_probe__.test.js';
    const abs = resolve(ROOT, rel);
    fs.writeFileSync(
      abs,
      "const fs = require('fs');\n" +
        "describe('probe', () => {\n" +
        "  test('comment-satisfied', () => {\n" +
        // DOUBLE quotes, deliberately. This probe is briefly `git add
        // --intent-to-add`ed, so it is visible to `git ls-files` while it
        // exists — and the F4 raw-literal ratchet in
        // tests/scripts/source-paths-manifest.test.js counts SINGLE-quoted repo
        // paths across every tracked test file. Jest runs suites in parallel
        // workers, so a single-quoted path here intermittently pushed that
        // ratchet from 40 to 41 and reddened CI on unrelated PRs. CTL-039's own
        // PATH_LIT accepts either quote style, so detection is unaffected.
        `    const c = fs.readFileSync("${SRC.sanitise}", 'utf8');\n` +
        // `<scr<script>ipt>` appears in sanitise.ts only inside a block comment
        // describing a nested-tag bypass.
        "    expect(c).toContain('<scr<script>ipt>');\n" +
        '  });\n' +
        '});\n',
    );
    try {
      spawnSync('git', ['add', '--intent-to-add', rel], { cwd: ROOT });
      const r = run();
      expect(r.status).toBe(1);
      // The severity is part of the message on purpose: a single hardcoded
      // "appears ONLY in a comment" was wrong for the commoner
      // `comment-shadowed` kind and would send a reader hunting for code that
      // is in fact still there.
      expect(r.stdout).toContain('NEW [comment-only]:');
      expect(r.stdout).toContain('__ctl039_probe__');
    } finally {
      spawnSync('git', ['rm', '-q', '--cached', '--force', rel], { cwd: ROOT });
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    }

    expect(run().status).toBe(0);
  });
});
