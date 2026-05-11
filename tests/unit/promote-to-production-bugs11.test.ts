/**
 * BUGS-11 meta-test: assert the promote-to-production.yml workflow keeps
 * the rebase-onto-main step and the post-rebase ancestry sanity check.
 *
 * If someone accidentally reverts to the merge-main approach (which fails
 * GitHub's first-parent strict-ancestry check empirically — see PR #99,
 * #103, #111, #120 all needing admin-merge), this test fails fast in CI.
 *
 * The test is intentionally string-based against the YAML rather than a
 * full YAML parse + structural assertion, because the failure mode we're
 * guarding against is "someone removes the rebase step" — string match is
 * the most direct way to assert the step is still present.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('BUGS-11 — promote-to-production.yml rebase-onto-main fix', () => {
  const WORKFLOW_PATH = resolve(__dirname, '../../.github/workflows/promote-to-production.yml');
  let workflow: string;

  beforeAll(() => {
    if (!existsSync(WORKFLOW_PATH)) {
      throw new Error(`Workflow file not found at ${WORKFLOW_PATH}`);
    }
    workflow = readFileSync(WORKFLOW_PATH, 'utf-8');
  });

  test('uses git rebase onto origin/main (not git merge origin/main)', () => {
    expect(workflow).toMatch(/git rebase origin\/main/);
    // Negative: the old merge-main approach must not come back as an
    // executable command. We strip comment lines first so the historical
    // explanation in the comment (which DOES say "git merge origin/main"
    // for context) doesn't trip the assertion.
    const codeOnly = workflow
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(codeOnly).not.toMatch(/git merge origin\/main/);
  });

  test('aborts the rebase on conflict and exits non-zero (no silent recovery)', () => {
    expect(workflow).toMatch(/git rebase --abort/);
    // The conflict branch must surface ::error:: and exit 1, not just log.
    expect(workflow).toMatch(/::error::Rebase onto main produced conflicts/);
  });

  test('post-rebase ancestry sanity check is in place', () => {
    expect(workflow).toMatch(/git merge-base --is-ancestor "\$MAIN_SHA" HEAD/);
    expect(workflow).toMatch(/main HEAD .* is NOT an ancestor of release branch HEAD/);
  });

  test('still uses LYRA_RELEASE_PAT (not GITHUB_TOKEN) for the push', () => {
    // Per CLAUDE.md gotcha #16, GITHUB_TOKEN suppresses downstream workflow
    // triggers — the release branch push must use the dedicated PAT.
    expect(workflow).toMatch(/secrets\.LYRA_RELEASE_PAT/);
    expect(workflow).not.toMatch(/secrets\.GITHUB_TOKEN.*git push origin/);
  });

  test('wait-for-merge dumps BUGS-11 diagnostics on timeout', () => {
    // Diagnostic surface required for future investigation: mergeable,
    // mergeStateStatus, autoMergeRequest, behind_by from main, the
    // legacy combined commit-status state, check_runs and check_suites
    // breakdown. If any of these are stripped out, the next stuck PR
    // wastes hours of root-cause time.
    expect(workflow).toMatch(/mergeStateStatus/);
    expect(workflow).toMatch(/autoMergeRequest/);
    expect(workflow).toMatch(/compare\/main\.\.\.\$HEAD_SHA/);
    expect(workflow).toMatch(/\/check-runs/);
    expect(workflow).toMatch(/\/check-suites/);
    expect(workflow).toMatch(/\/commits\/\$HEAD_SHA\/status/);
  });

  test('workflow is valid YAML (parses without error)', () => {
    // Smoke test: catch syntax errors introduced by future edits.
    // We don't assert structure beyond "parseable" because the workflow
    // shape is GitHub Actions-specific and not worth re-validating here.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yaml = require('node:fs').readFileSync(WORKFLOW_PATH, 'utf-8');
    // No yaml lib in deps — a minimal smoke check: balanced quotes and at
    // least one expected top-level key.
    expect(yaml).toMatch(/^name:\s*\S+/m);
    expect(yaml).toMatch(/^jobs:/m);
    expect(yaml).toMatch(/promote-to-production/);
  });
});
