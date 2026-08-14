/**
 * SEC-141 — a promote must not run concurrently with itself.
 *
 * WHAT HAPPENED
 * -------------
 * A single `workflow_dispatch` of promote-staging-to-beta produced TWO runs 63
 * seconds apart on 2026-08-14. The second was cancelled by hand before it acted.
 * Each promote fetches, merges and pushes, so two in flight can interleave in
 * the classic lost-update window — and the outcome that day was fine only
 * because someone was watching, which is not a control.
 *
 * The duplicate dispatch is the symptom and its cause is unconfirmed (a client
 * retry on a slow 204 is the leading hypothesis; GitHub's dispatch API is
 * at-least-once, not exactly-once). Chasing the cause is the wrong instinct:
 * the guard makes the cause irrelevant.
 *
 * WHY `cancel-in-progress: false` IS THE ASSERTION THAT MATTERS
 * ------------------------------------------------------------
 * `true` is the reflexive choice and is actively dangerous here — it would kill
 * an in-flight promote MID-MERGE OR MID-PUSH, which is a nastier failure than
 * the race it prevents. A future edit flipping it would read as a tightening.
 * That is exactly the kind of change a test has to hold, because review would
 * likely wave it through.
 *
 * These assertions are static — GitHub evaluates `concurrency` server-side and
 * nothing local can exercise it. So the test pins the declaration, and the
 * reasoning above is why the declaration is what it is.
 */
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');

/**
 * DISCOVERED, not hand-listed. A hand-maintained list is the failure this repo
 * keeps re-learning: a fourth promote workflow could land tomorrow and a fixed
 * list would never mention it.
 */
const promoteWorkflows = fs
  .readdirSync(WORKFLOWS)
  .filter((f) => /^promote-.*\.ya?ml$/.test(f))
  .sort();

describe('SEC-141 — promote workflows are serialised', () => {
  test('the corpus is real — three promote workflows exist', () => {
    // Catalogue failure mode 4: every assertion below iterates this list, so an
    // empty or shrunken corpus would report clean while checking nothing.
    expect(`promote workflows found: ${JSON.stringify(promoteWorkflows)}`).toBe(
      'promote workflows found: ["promote-staging-to-beta.yml","promote-to-production.yml","promote-to-staging.yml"]',
    );
  });

  test.each(promoteWorkflows)('%s declares a concurrency group', (file) => {
    const doc = yaml.load(fs.readFileSync(path.join(WORKFLOWS, file), 'utf-8'));
    expect(`${file} concurrency.group: ${doc?.concurrency?.group}`).toBe(
      `${file} concurrency.group: promote-\${{ github.workflow }}`,
    );
  });

  test.each(promoteWorkflows)('%s sets cancel-in-progress to FALSE', (file) => {
    // The load-bearing case. `true` would cancel a promote mid-push.
    const doc = yaml.load(fs.readFileSync(path.join(WORKFLOWS, file), 'utf-8'));
    const v = doc?.concurrency?.['cancel-in-progress'];
    expect(`${file} cancel-in-progress: ${v}`).toBe(`${file} cancel-in-progress: false`);
  });

  test('each promote gets its OWN group — they are not serialised against each other', () => {
    // `promote-${{ github.workflow }}` expands per workflow name. A shared
    // literal group would make staging→beta wait on beta→main for no reason.
    const groups = promoteWorkflows.map((f) => {
      const doc = yaml.load(fs.readFileSync(path.join(WORKFLOWS, f), 'utf-8'));
      return doc?.concurrency?.group;
    });
    // All three use the same EXPRESSION, which resolves to three distinct
    // values. Asserting the expression is what keeps that true as names change.
    expect(new Set(groups).size).toBe(1);
    expect(groups[0]).toContain('github.workflow');
  });

  test('the reasoning for `false` is recorded in each file, not just here', () => {
    // A bare `cancel-in-progress: false` invites exactly the "tightening" this
    // guards against. The comment is the first line of defence; this test is
    // the second. If someone deletes the explanation, they lose the argument
    // for the value — so the explanation is part of the contract.
    for (const file of promoteWorkflows) {
      const src = fs.readFileSync(path.join(WORKFLOWS, file), 'utf-8');
      expect(`${file} cites SEC-141: ${src.includes('SEC-141')}`).toBe(`${file} cites SEC-141: true`);
      expect(`${file} explains mid-push: ${/MID-MERGE OR MID-PUSH/i.test(src)}`).toBe(
        `${file} explains mid-push: true`,
      );
    }
  });
});
