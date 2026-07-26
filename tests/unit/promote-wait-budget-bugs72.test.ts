/**
 * BUGS-72 meta-test: the promote workflows' "wait for deploy" step must give a
 * real deploy enough headroom, and must diagnose a timeout honestly.
 *
 * History:
 *   * 2026-07-25 (SEC-23/SEC-98 promote chain): `promote-to-staging.yml` reported
 *     FAILURE even though its merge job succeeded and `deploy-staging.yml`
 *     completed successfully. The wait step's TIMEOUT was 420s while the staging
 *     deploy took longer; the step found the matching run ("is in_progress for
 *     SHA … (420/420s)") and then exited 1 with the message
 *     "deploy-staging.yml never produced a run for SHA … after 420s".
 *   * That message names the wrong cause: "never produced a run" is the
 *     GITHUB_TOKEN downstream-trigger-suppression case (BUGS-4 / Gotcha #16,
 *     remediated by LYRA_RELEASE_PAT). Conflating it with "the run exists but is
 *     still going" sent the operator to the wrong remediation, and the promote
 *     only needed `gh run rerun <id> --failed`.
 *
 * This is a FALSE NEGATIVE — a red that isn't real — which the Workflow &
 * Backup Integrity Policy treats as just as corrosive as a false green: it
 * teaches operators to distrust and re-run red promotes.
 *
 * These assertions guard both halves of the fix. They deliberately read the
 * workflow source rather than parsing YAML, because the budget and the messages
 * live inside a shell `run:` block.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

type PromoteWorkflow = {
  /** Workflow filename under .github/workflows */
  file: string;
  /** The deploy workflow it waits on */
  deploy: string;
  /** Minimum acceptable wait budget in seconds */
  minBudget: number;
};

const WORKFLOWS: PromoteWorkflow[] = [
  // BUGS-72 raised these two from 420s. The staging one demonstrably false-failed;
  // beta shared the identical budget and only passed on a ~5.5min near-miss.
  { file: 'promote-to-staging.yml', deploy: 'deploy-staging', minBudget: 900 },
  { file: 'promote-staging-to-beta.yml', deploy: 'deploy-beta', minBudget: 900 },
  // Production was already 600s against a ~330s deploy, so its budget is
  // unchanged; it gets the same honest timeout diagnosis.
  { file: 'promote-to-production.yml', deploy: 'deploy-production', minBudget: 600 },
];

describe('BUGS-72 — promote wait-for-deploy budget and timeout diagnosis', () => {
  const sources = new Map<string, string>();

  beforeAll(() => {
    for (const { file } of WORKFLOWS) {
      const path = resolve(__dirname, '../../.github/workflows', file);
      if (!existsSync(path)) {
        throw new Error(`Workflow file not found at ${path}`);
      }
      sources.set(file, readFileSync(path, 'utf-8'));
    }
  });

  describe.each(WORKFLOWS)('$file', ({ file, deploy, minBudget }) => {
    const budgetOf = (source: string): number => {
      const match = source.match(/^\s*TIMEOUT=(\d+)\s*$/m);
      if (!match) {
        throw new Error(`No TIMEOUT= assignment found in ${file}`);
      }
      return Number(match[1]);
    };

    test(`wait budget is at least ${minBudget}s`, () => {
      expect(budgetOf(sources.get(file)!)).toBeGreaterThanOrEqual(minBudget);
    });

    test('wait budget is never the 420s value that false-failed', () => {
      expect(budgetOf(sources.get(file)!)).not.toBe(420);
    });

    test('records the run id it saw, so a timeout can name the real cause', () => {
      const source = sources.get(file)!;
      // Initialised before the loop (the block runs under `set -u`) and
      // assigned once a run matching our SHA is found.
      expect(source).toMatch(/^\s*SEEN_RUN_ID=""\s*$/m);
      expect(source).toMatch(/^\s*SEEN_RUN_ID="\$RUN_ID"\s*$/m);
      expect(source).toMatch(/^\s*LAST_STATUS=""\s*$/m);
      expect(source).toMatch(/^\s*LAST_STATUS="\$STATUS"\s*$/m);
    });

    test('timeout message distinguishes never-triggered from exceeded-budget', () => {
      const source = sources.get(file)!;
      // The branch that fires when a run WAS seen must not blame the PAT, and
      // must point at the re-run remedy.
      expect(source).toContain('exceeded its wait budget, it is NOT a trigger failure');
      expect(source).toContain('--failed');
      // The branch that fires when no run ever appeared keeps the PAT guidance,
      // which is the correct remediation for that case only.
      expect(source).toContain(`${deploy}.yml never produced a run`);
      expect(source).toContain('LYRA_RELEASE_PAT');
      // Both messages must be reachable — i.e. guarded by the SEEN_RUN_ID test.
      expect(source).toMatch(/if \[ -n "\$SEEN_RUN_ID" \]; then/);
    });

    test('still fails the job on timeout (no silent-skip)', () => {
      // Workflow & Backup Integrity Policy: a wait that gives up must exit
      // non-zero. Better diagnostics must never soften the failure.
      const source = sources.get(file)!;
      const afterLoop = source.slice(source.indexOf('SEEN_RUN_ID="$RUN_ID"'));
      expect(afterLoop).toContain('exit 1');
      expect(afterLoop).not.toContain('continue-on-error: true');
    });
  });
});
