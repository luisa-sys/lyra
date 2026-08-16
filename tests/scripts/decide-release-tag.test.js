const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { SRC } = require('../support/source-paths.json');

const REPO_ROOT = path.resolve(__dirname, '../../');
// Reached via SRC rather than a raw path literal, so a later move updates one
// place instead of silently repointing this suite (gotcha #31, and the F4
// raw-literal ratchet). The alternative — raising that ratchet's baseline —
// would defeat a shrink-only control to accommodate one new line.
const SCRIPT = path.join(REPO_ROOT, SRC.decideReleaseTag);
const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'release-tag-on-deploy.yml');
const PROMOTE = path.join(REPO_ROOT, '.github', 'workflows', 'promote-to-production.yml');

/**
 * BUGS-104 — the release tag must be decided by the DEPLOY's completion, not
 * by the promote's.
 *
 * THE DEFECT. promote-to-production.yml's `release-tag` job needs `smoke-tests`,
 * which needs `wait-for-deploy` to have reported `deployed`. A production deploy
 * parked on the SEC-106 reviewer gate makes `wait-for-deploy` exit 0 with
 * `awaiting-approval` — correct and deliberate — so BOTH downstream jobs are
 * skipped. The founder approves, the deploy succeeds, and nothing comes back:
 * the promote run finished long ago.
 *
 * Observed 2026-08-16. Promote run 31965557264:
 *
 *     Wait for production deploy (SHA-matched)   success
 *     Production smoke tests + SHA verification  SKIPPED
 *     Create release tag                         SKIPPED
 *
 * Deploy run 31965575474 then completed success with smoke green — and `main`
 * stayed untagged. Since the reviewer gate landed 2026-07-30 that is the normal
 * path, so effectively every release is affected.
 *
 * WHY THESE TESTS EXIST IN THIS SHAPE. The decision was deliberately extracted
 * out of the workflow YAML so it can be driven as a subprocess. An inline `run:`
 * block is reachable by no test — which is precisely how BUGS-103's soak probe
 * stayed red for four days without a unit ever objecting.
 *
 * The two cases that carry the weight are the REFUSALS: a deploy for a
 * superseded SHA must not tag today's HEAD, and an already-tagged HEAD must be
 * a no-op rather than a second tag. A naive "the deploy went green, tag main"
 * gets both wrong and would never report it.
 */

const SHA_A = 'cc1c8f3c00000000000000000000000000000000';
const SHA_B = '029896a300000000000000000000000000000000';

/** Drive the real script; returns { code, action, tag, out }. */
function decide({ conclusion = 'success', deploySha = SHA_A, mainSha = SHA_A, headTag = '', lastTag = 'v0.1.100' } = {}) {
  const args = [
    SCRIPT,
    '--conclusion', conclusion,
    '--deploy-sha', deploySha,
    '--main-sha', mainSha,
    '--head-tag', headTag,
    '--last-tag', lastTag,
  ];
  let out = '';
  let code = 0;
  try {
    out = execFileSync('python3', args, { cwd: REPO_ROOT, stdio: 'pipe' }).toString();
  } catch (err) {
    code = err.status;
    out = `${err.stdout || ''}${err.stderr || ''}`;
  }
  const pick = (k) => (out.match(new RegExp(`^${k}=(.*)$`, 'm')) || [, ''])[1];
  return { code, action: pick('action'), tag: pick('tag'), out };
}

describe('the script is wired in and self-consistent', () => {
  test('its own --self-test passes', () => {
    const out = execFileSync('python3', [SCRIPT, '--self-test'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    }).toString();
    expect(out).toMatch(/self-test: (\d+)\/\1 passed/);
    expect(out).not.toMatch(/FAIL/);
  });

  test('the workflow invokes it, and is triggered by the DEPLOY not the promote', () => {
    const wf = fs.readFileSync(WORKFLOW, 'utf8');
    // SRC, not a repeated literal — and note this assertion is only meaningful
    // because SRC.decideReleaseTag is asserted to resolve to a tracked file by
    // source-path-manifest-integrity. A `toContain(undefined)` would throw
    // rather than pass vacuously, but a *stale* value would match nothing and
    // this test would fail loudly, which is the direction we want.
    expect(wf).toContain(SRC.decideReleaseTag);
    // The whole point: fired by the deploy's completion, so the reviewer gate
    // cannot strand it.
    expect(wf).toMatch(/workflow_run:/);
    expect(wf).toContain('Deploy to Production');
  });

  test('it does NOT silent-skip on a missing PAT', () => {
    // `if: env.X != ''` on a credential is the KAN-167 pattern that makes a
    // tagger look healthy while doing nothing — the same class as the defect
    // this workflow fixes.
    const wf = fs.readFileSync(WORKFLOW, 'utf8');
    expect(wf).not.toMatch(/if:\s*env\.\w*PAT\w*\s*!=\s*''/);
    expect(wf).toContain('LYRA_RELEASE_PAT is not set');
  });

  test('promote-to-production still has its own release-tag job', () => {
    // Deliberate overlap, not duplication: a deploy that needs no approval
    // still tags immediately there, and this workflow is idempotent. Removing
    // it would leave exactly one witness.
    expect(fs.readFileSync(PROMOTE, 'utf8')).toContain('Create release tag');
  });
});

describe('it tags the case that is currently being missed', () => {
  test('approved deploy on an untagged HEAD tags the next patch', () => {
    const r = decide({ headTag: '', lastTag: 'v0.1.100' });
    expect(r.code).toBe(0);
    expect(r.action).toBe('TAG');
    expect(r.tag).toBe('v0.1.101');
  });

  test('the version bump matches the promote job, including the v0.0.0 seed', () => {
    expect(decide({ lastTag: '' }).tag).toBe('v0.0.1');
    expect(decide({ lastTag: 'v1.9.9' }).tag).toBe('v1.9.10');
  });
});

describe('the refusals — the half a naive implementation gets wrong', () => {
  test('a deploy for a SUPERSEDED sha is refused, not tagged', () => {
    // If main moved on after the deploy, tagging HEAD attaches a version to
    // code that deploy never verified.
    const r = decide({ deploySha: SHA_B, mainSha: SHA_A });
    expect(r.code).toBe(1);
    expect(r.action).toBe('REFUSE');
    expect(r.tag).toBe('');
    expect(r.out).toMatch(/never verified/);
  });

  test('an already-tagged HEAD is a no-op, not a second tag and not an error', () => {
    const r = decide({ headTag: 'v0.1.101' });
    expect(r.code).toBe(0);
    expect(r.action).toBe('SKIP');
  });

  test.each([['failure'], ['cancelled'], ['timed_out'], ['skipped']])(
    'a deploy that concluded %s does not tag',
    (conclusion) => {
      const r = decide({ conclusion });
      expect(r.code).toBe(0);
      expect(r.action).toBe('SKIP');
      expect(r.tag).toBe('');
    },
  );
});

describe('it fails CLOSED on anything it cannot decide', () => {
  test.each([
    ['an empty conclusion', { conclusion: '' }],
    ['an empty deploy sha', { deploySha: '' }],
    ['an empty main sha', { mainSha: '' }],
  ])('%s is UNVERIFIED (exit 2), never a silent skip', (_name, override) => {
    const r = decide(override);
    expect(r.code).toBe(2);
    expect(r.action).toBe('UNVERIFIED');
    expect(r.tag).toBe('');
  });

  test.each([['v0.1.100-rc1'], ['v2.3'], ['release-7'], ['0.1.100']])(
    'a non-release last tag (%s) is UNVERIFIED rather than a guessed version',
    (lastTag) => {
      // git describe --tags is the authoritative version in this repo. Inventing
      // one from an unparseable tag is worse than refusing.
      const r = decide({ lastTag });
      expect(r.code).toBe(2);
      expect(r.action).toBe('UNVERIFIED');
    },
  );
});
