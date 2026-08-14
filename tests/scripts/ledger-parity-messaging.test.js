/**
 * CTL-049 messaging — a finding must describe the failure it actually had.
 *
 * WHAT WENT WRONG
 * ---------------
 * `db-invariants.yml`'s ledger-parity job raised its finding under a bare
 * `if: failure()`, so EVERY non-zero exit printed the divergence story:
 *
 *     "The repo and a database no longer agree about what has been applied.
 *      ... Someone applied SQL that was never committed ... Commit the
 *      migration SQL."
 *
 * On 2026-08-14 the dev project returned HTTP 403 and the check exited 2 —
 * "I could not read a ledger", which says nothing at all about agreement. The
 * annotation nonetheless told the reader to go and commit SQL that was never
 * missing.
 *
 * The job's own header explains why that matters: it is a SEPARATE job from
 * `invariants` precisely because "a finding that describes itself wrongly is
 * how an operator learns to skim the annotations". The handler was doing the
 * thing the job was split up to avoid.
 *
 * WHY THESE ARE STATIC ASSERTIONS
 * -------------------------------
 * The branch lives in workflow YAML, which only ever executes on a runner.
 * There is no local way to drive it, so the test pins the STRUCTURE: that the
 * compare step publishes its exit code, and that the handler distinguishes 1
 * from 2 and has a fallback for neither.
 */
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'db-invariants.yml');

const doc = yaml.load(fs.readFileSync(WORKFLOW, 'utf-8'));
const steps = doc?.jobs?.['ledger-parity']?.steps ?? [];
const compare = steps.find((s) => s.id === 'compare');
const handler = steps.find((s) => s.name === 'Raise the finding');

describe('CTL-049 — the failure handler branches on the exit code', () => {
  test('the ledger-parity job exists with the steps this test reasons about', () => {
    // Assert the corpus before asserting about it: if the job were renamed,
    // every `?.` below would silently read undefined and pass vacuously.
    expect(`steps found: ${steps.length}`).not.toBe('steps found: 0');
    expect(compare).toBeDefined();
    expect(handler).toBeDefined();
  });

  test('the compare step publishes its exit code instead of just failing', () => {
    // Without this the handler has nothing to branch on and the bug returns.
    expect(compare.run).toContain('GITHUB_OUTPUT');
    expect(compare.run).toMatch(/rc=\$\?|rc=0/);
    // It must still FAIL — capturing the code must not swallow it.
    expect(compare.run).toContain('exit "$rc"');
  });

  test('capturing the code does not disable `set -euo pipefail`', () => {
    // The Workflow Integrity Policy requires it on every multi-line run block.
    // `set +e` would satisfy the capture and violate the policy; `|| rc=$?`
    // does both.
    expect(compare.run).toContain('set -euo pipefail');
    expect(`compare uses set +e: ${compare.run.includes('set +e')}`).toBe(
      'compare uses set +e: false',
    );
  });

  test('exit 2 gets a "could not READ" message, not the divergence story', () => {
    // The actual defect. The exit-2 branch must say the opposite of the
    // divergence text and must explicitly warn the reader off it.
    expect(handler.run).toContain('could not be READ');
    expect(handler.run).toContain('This is not a divergence finding');
    expect(handler.run).toContain('Do NOT go looking for an uncommitted migration');
  });

  test('exit 2 names both 403 sources, which is the only actionable part', () => {
    // A 403 here is either Cloudflare bot protection (transient) or Supabase
    // refusing the token's scope (not transient). Opposite responses, told
    // apart only by the response body.
    expect(handler.run).toContain('Cloudflare');
    expect(handler.run).toContain('SUPABASE_ACCESS_TOKEN');
  });

  test('exit 1 still reaches the divergence text — this is a split, not a removal', () => {
    // The load-bearing check that this change did not weaken the control:
    // a real divergence must still produce the full explanation.
    expect(handler.run).toContain(
      'The repo and a database no longer agree about what has been applied.',
    );
    expect(handler.run).toContain('Commit the migration SQL.');
    expect(handler.run).toMatch(/case\s+"\$\{RC:-unknown\}"/);
  });

  test('an unexpected exit code is neither story — it has its own branch', () => {
    // A missing interpreter or killed process exits neither 1 nor 2. Without a
    // fallback the handler would print nothing at all, which is worse than the
    // wrong message: a red run with no annotation reads as infrastructure
    // noise.
    expect(handler.run).toContain('unexpected status');
    expect(handler.run).toContain('the guidance below does not apply');
  });
});

describe('CTL-049 — the HTTP error carries what is needed to diagnose it', () => {
  const script = fs.readFileSync(
    path.join(ROOT, 'scripts', 'check-migration-ledger-parity.py'),
    'utf-8',
  );

  test('a non-2xx includes the response BODY, not just the reason phrase', () => {
    // `exc.reason` for a 403 is the literal string "Forbidden". That is
    // unactionable, and it is what the 2026-08-14 failures reported for three
    // days. The body is what distinguishes the two 403 sources.
    expect(script).toContain('body: ');
    expect(script).toMatch(/exc\.read\(\)/);
  });

  test('a body that cannot be read does not mask the HTTP error', () => {
    // The failure mode to avoid: an exception while decoding the body
    // replacing a clear "HTTP 403" with a confusing decode traceback.
    expect(script).toContain('<unreadable>');
  });
});
