/**
 * CTL-078 — the weekly mutation-testing job must be CAPABLE OF FAILING.
 * KAN-356 step 6/7/8 (finding web-tests-05).
 *
 * WHY THIS EXISTS
 * ---------------
 * KAN-356 criterion 5 asks for a non-null `thresholds.break` in
 * stryker.config.mjs, measured from a real baseline. A break threshold's whole
 * purpose is to fail the build when the mutation score regresses.
 *
 * `.github/workflows/mutation-testing.yml` carried `continue-on-error: true`
 * on the Stryker step. With that line present, `thresholds.break` cannot fail
 * anything: Stryker exits non-zero, the step is marked success, the artifact
 * uploads, the job goes green. Criterion 5 would have been satisfiable ON PAPER
 * while the control remained incapable of failing — the shape this repo names
 * "a control that has never been seen to fail is indistinguishable from no
 * control".
 *
 * The Workflow & Backup Integrity Policy permits `continue-on-error: true` on
 * an ADVISORY step and names mutation testing as its own example. That
 * permission is exactly what expires when a break threshold is set, so the two
 * facts must be checked together rather than separately — which is what makes
 * this a test and not two greps.
 *
 * THE SECOND FAILURE DIRECTION: A GREEN TICK OVER NO REPORT
 * --------------------------------------------------------
 * The Summary step ended on exit 0 whether or not Stryker produced anything:
 * a missing report printed "No report generated" and passed, and an
 * unparseable one printed the literal score `N/A%` via `|| echo "N/A"` over a
 * bare `except:`. Both are the banned lossy-fallback pattern (KAN-167 #3) —
 * the reader cannot tell a real measurement from a failed one. So the job
 * reported green while dark, which is CTL-042's failure with a different
 * mechanism.
 *
 * WHAT IS DELIBERATELY *NOT* ASSERTED HERE, AND WHY
 * ------------------------------------------------
 * This does NOT assert `thresholds.break` is non-null. It is still null on
 * purpose: setting it needs a measured baseline over the intended security
 * surface, and that measurement is currently BLOCKED — see below. Asserting a
 * value nobody has measured is how you get a red build on day one, which is a
 * control someone turns off. What is asserted instead is the PRECONDITION: if
 * and when a break threshold is set, the workflow it runs in can act on it.
 *
 * THE BLOCKER, RECORDED RATHER THAN HIDDEN (KAN-356 step 6)
 * --------------------------------------------------------
 * Expanding `mutate` to src/modules/{guards,access,age,auth} makes Stryker
 * abort in its INITIAL TEST RUN, so no score can be measured at all.
 * Reproduced 2026-08-21 on develop b20e3d6:
 *
 *   - 2-file scope  (develop today): 187 mutants, "Initial test run
 *     succeeded. Ran 529 tests".
 *   - 40-file scope (the ticket's):  1661 mutants, "One or more tests failed
 *     in the initial test run" -> ConfigError, exit non-zero, no report.
 *
 * The cause is NOT the extra files. Stryker's jest runner selects tests by the
 * IMPORT graph, and a source-scanning test — one that reads its subject with
 * readFileSync — has no import edge to that subject. At 2 files it is simply
 * never selected. At 40 files it IS selected (it imports something else in the
 * widened set), and it then reads Stryker's INSTRUMENTED copy of the source,
 * where the literal it greps for no longer appears. Both failures observed
 * were in tests/unit/age-self-declaration.test.ts asserting against
 * src/app/(auth)/actions.ts — a file that was ALREADY in the mutate list, which
 * is what proves selection rather than scope is the variable.
 *
 * That couples this finding to web-tests-06 (CTL-077, the source-scan
 * inventory): the mutation surface cannot widen until the source-scanning
 * tests over the modules being widened into are converted or exempted.
 */
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'mutation-testing.yml');
const CONFIG = path.join(ROOT, 'stryker.config.mjs');

const workflowText = fs.readFileSync(WORKFLOW, 'utf8');
const workflow = yaml.load(workflowText);
const configText = fs.readFileSync(CONFIG, 'utf8');

/**
 * Comments are stripped before every source-text match. This file's own header
 * discusses `continue-on-error: true` and `|| echo "N/A"` by name, and the
 * workflow now carries comments explaining why each was removed — so a scan
 * that did not strip comments would be satisfied by the prose describing the
 * defect's removal. That is catalogue failure mode 2, and the better the fix
 * is documented the weaker the un-stripped scan becomes.
 */
function stripYamlComments(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*#.*$/, ''))
    .join('\n');
}

const steps = workflow.jobs['mutation-test'].steps;

/**
 * Corpus floor BEFORE anything iterates or indexes it. A renamed job key would
 * otherwise yield an empty step list, and every assertion below would pass over
 * nothing (catalogue failure mode 4).
 */
describe('CTL-078 corpus', () => {
  test('the mutation-test job exposes a non-trivial step list', () => {
    expect(Array.isArray(steps)).toBe(true);
    expect(steps.length).toBeGreaterThanOrEqual(6);
  });
});

describe('CTL-078 — the mutation job can actually fail', () => {
  const strykerStep = steps.find(
    (s) => typeof s.run === 'string' && /\bstryker\s+run\b/.test(s.run)
  );

  test('a step actually invokes stryker run', () => {
    // Without this, "the stryker step is not continue-on-error" would be
    // vacuously true for a workflow that no longer runs Stryker at all.
    expect(strykerStep).toBeDefined();
  });

  test('the stryker step is NOT continue-on-error', () => {
    // The load-bearing assertion. `continue-on-error: true` here makes any
    // thresholds.break inert, and hides a failed initial test run.
    expect(strykerStep['continue-on-error']).toBeUndefined();
  });

  test('no step in the job is continue-on-error', () => {
    // Scoped to this job rather than to the one step, because moving the
    // stryker invocation into a new step that carries the flag would
    // reintroduce the defect while leaving the assertion above green.
    const excused = steps.filter((s) => s['continue-on-error'] === true);
    expect(excused).toEqual([]);
  });

  test('the job still runs on the Sunday 04:00 schedule', () => {
    // CTL-042 checks that a scheduled workflow is ACTIVE at GitHub. It cannot
    // see a cron silently deleted from the file, which reaches the same end
    // state — never runs — from the other direction.
    const schedule = (workflow.on || workflow.true).schedule;
    expect(schedule).toEqual([{ cron: '0 4 * * 0' }]);
  });
});

describe('CTL-078 — a missing or unreadable report is a failure, not a zero', () => {
  const summaryStep = steps.find((s) => s.name === 'Summary');

  test('the Summary step exists and is a multi-line run block', () => {
    expect(summaryStep).toBeDefined();
    expect(typeof summaryStep.run).toBe('string');
  });

  test('the Summary step exits non-zero when there is no report', () => {
    const body = stripYamlComments(summaryStep.run);
    expect(body).toMatch(/exit 1/);
    // Two distinct exits — one per failure direction (absent vs unparseable).
    // A single exit would let one direction be dropped silently.
    expect(body.match(/exit 1/g).length).toBeGreaterThanOrEqual(2);
  });

  test('the Summary step raises a GitHub error annotation on each failure path', () => {
    const body = stripYamlComments(summaryStep.run);
    expect(body.match(/::error::/g).length).toBeGreaterThanOrEqual(2);
  });

  test('the Summary step carries no lossy || echo fallback', () => {
    // KAN-167 banned pattern #3. `|| echo "N/A"` turned a parse failure into
    // the printed score "N/A%", which reads like data.
    const body = stripYamlComments(summaryStep.run);
    expect(body).not.toMatch(/\|\|\s*echo/);
  });

  test('the Summary step does not swallow exceptions with a bare except', () => {
    const body = stripYamlComments(summaryStep.run);
    expect(body).not.toMatch(/except\s*:/);
  });

  test('the Summary step sets -euo pipefail', () => {
    expect(stripYamlComments(summaryStep.run)).toMatch(/set -euo pipefail/);
  });
});

describe('CTL-078 — the mutation surface is real', () => {
  const mutateBlock = configText.match(/mutate:\s*\[([\s\S]*?)\]/);

  test('stryker.config.mjs declares a mutate list', () => {
    expect(mutateBlock).not.toBeNull();
  });

  const patterns = mutateBlock
    ? [...mutateBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    : [];

  test('the mutate list is non-empty', () => {
    // Asserted before it is iterated. An empty mutate list produces a Stryker
    // run with zero mutants and a 100%-of-nothing score, reported green.
    expect(patterns.length).toBeGreaterThan(0);
  });

  test.each(patterns)('mutate pattern %s matches at least one tracked file', (pattern) => {
    // The KAN-415 "narrow, not dead" lesson applied here: a path-anchored
    // pattern does not break when the tree moves, it quietly covers less.
    // A pattern matching nothing shrinks the mutation surface to nothing
    // while the config still reads as though it covers that module.
    const { execFileSync } = require('node:child_process');
    const tracked = execFileSync('git', ['ls-files', '--', pattern], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
    expect(tracked.length).toBeGreaterThan(0);
  });
});
