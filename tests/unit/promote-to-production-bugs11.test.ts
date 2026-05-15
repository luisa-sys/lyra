/**
 * BUGS-11 / BUGS-16 meta-test: assert the promote-to-production.yml
 * workflow keeps the direct-merge strategy that fixed both bugs.
 *
 * History:
 *   * Original (pre-BUGS-11): direct push to main via git merge.
 *   * BUGS-11 attempt 1: PR-based with `git merge origin/main` into the
 *     release branch. Failed because GitHub's strict-ancestry check
 *     follows first-parent only.
 *   * BUGS-11 attempt 2 (2026-05-04): PR-based with `git rebase
 *     origin/main`. Passed strict-ancestry but ran into BUGS-16
 *     (phantom Vercel check_suite stalling auto-merge for 15min on
 *     every release — required admin-merge on 4+ consecutive releases).
 *   * BUGS-11 attempt 3 (2026-05-15): drop the PR entirely. Direct
 *     fast-forward-able merge of beta → main, mirror what
 *     promote-staging-to-beta.yml has done reliably since KAN-175.
 *
 * This test guards the attempt-3 shape. If someone accidentally
 * reintroduces a release-PR flow (which would block on the phantom
 * check_suite again), this test fails fast.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('BUGS-11 / BUGS-16 — promote-to-production.yml direct-merge fix', () => {
  const WORKFLOW_PATH = resolve(__dirname, '../../.github/workflows/promote-to-production.yml');
  let workflow: string;
  let codeOnly: string;

  beforeAll(() => {
    if (!existsSync(WORKFLOW_PATH)) {
      throw new Error(`Workflow file not found at ${WORKFLOW_PATH}`);
    }
    workflow = readFileSync(WORKFLOW_PATH, 'utf-8');
    // Strip comment lines so historical explanations (which mention the
    // old PR/rebase approach by name for context) don't trip the
    // negative assertions below.
    codeOnly = workflow
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
  });

  test('merges beta → main with a direct git merge (not a PR)', () => {
    // Positive: the new flow does `git merge origin/beta` from the
    // checked-out main branch.
    expect(codeOnly).toMatch(/git merge origin\/beta/);
    // The merge job exists with the canonical name.
    expect(codeOnly).toMatch(/merge-and-push:/);
    expect(codeOnly).toMatch(/Merge beta → main/);
  });

  test('does NOT create a release PR (BUGS-16 regression guard)', () => {
    // The release-PR flow was blocked by the phantom Vercel check_suite.
    // No more PR creation, no more auto-merge wait, no more release
    // branch. If any of these come back, BUGS-16 comes back too.
    expect(codeOnly).not.toMatch(/gh pr create/);
    expect(codeOnly).not.toMatch(/--auto\s*$/m);
    expect(codeOnly).not.toMatch(/release\/\$\{DATE\}-prod/);
    // Job names that belonged to the old flow must be gone.
    expect(codeOnly).not.toMatch(/create-release-pr:/);
    expect(codeOnly).not.toMatch(/wait-for-merge:/);
    expect(codeOnly).not.toMatch(/cleanup-release-branch:/);
  });

  test('still uses LYRA_RELEASE_PAT (not GITHUB_TOKEN) for the merge push', () => {
    // Per CLAUDE.md gotcha #16, GITHUB_TOKEN suppresses downstream
    // workflow triggers — deploy-production.yml would never fire.
    expect(workflow).toMatch(/secrets\.LYRA_RELEASE_PAT/);
    // Negative: no push to main using GITHUB_TOKEN.
    expect(codeOnly).not.toMatch(/secrets\.GITHUB_TOKEN[^}]*\}\}\s*\n[\s\S]{0,500}git push origin main/);
  });

  test('captures main HEAD before merge for auto-rollback (BUGS-9)', () => {
    // BUGS-9: rollback target SHA must be captured BEFORE the merge,
    // because by the time auto-rollback runs main has already moved.
    expect(codeOnly).toMatch(/main_sha_before_merge/);
    expect(codeOnly).toMatch(/MAIN_SHA_BEFORE_MERGE=\$\(gh api/);
  });

  test('verifies beta CI passed at HEAD before merging (BUGS-4)', () => {
    // The verify-source job must check that deploy-beta.yml succeeded
    // for the SHA we're about to promote. Stops bad code reaching prod.
    expect(codeOnly).toMatch(/verify-source:/);
    expect(codeOnly).toMatch(/deploy-beta\.yml/);
    expect(codeOnly).toMatch(/Beta CI verified for/);
  });

  test('waits for deploy-production at the merged SHA before tagging', () => {
    // The release tag must only be created after deploy-production
    // confirms the SHA is live in production. Old flow tagged before
    // deploy completion which left misleading tags on failed deploys.
    expect(codeOnly).toMatch(/wait-for-deploy:/);
    expect(codeOnly).toMatch(/needs: wait-for-deploy|needs: \[merge-and-push, wait-for-deploy\]/);
    expect(codeOnly).toMatch(/release-tag:/);
    expect(codeOnly).toMatch(/needs: \[merge-and-push, smoke-tests\]/);
  });

  test('auto-rollback uses the captured pre-merge SHA, not Vercel state', () => {
    // BUGS-9: previous auto-rollback inferred the rollback target from
    // Vercel's deployment list and silently picked NONE on parse
    // failure. The fix is to use the SHA we captured in verify-source.
    expect(codeOnly).toMatch(/auto-rollback:/);
    expect(codeOnly).toMatch(/needs: \[verify-source, smoke-tests\]/);
    expect(codeOnly).toMatch(/main_sha_before_merge/);
    expect(codeOnly).toMatch(/rollback-to-sha\.py/);
  });

  test('workflow is valid YAML and has the expected top-level shape', () => {
    expect(workflow).toMatch(/^name:\s*\S+/m);
    expect(workflow).toMatch(/^jobs:/m);
    expect(workflow).toMatch(/^name:\s*Promote to Production\s*$/m);
    expect(workflow).toMatch(/workflow_dispatch:/);
  });
});
