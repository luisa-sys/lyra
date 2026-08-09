#!/usr/bin/env node
/**
 * KAN-110 / KAN-168 successor — regenerate the test-floor baseline.
 *
 * WHY THIS SCRIPT EXISTS AT ALL
 * -----------------------------
 * The floor used to be two hand-typed constants inside the guard, with a
 * comment saying "update the floors when consolidating tests intentionally".
 * It was refreshed once, on 2026-05-05, and never again. By 2026-08-09 it
 * enforced 29 files / 320 blocks against an actual 260 / 2,963 — so roughly
 * 89% OF THE TEST ESTATE COULD HAVE BEEN DELETED WITHOUT TRIPPING CI.
 *
 * A number a human has to remember to raise is a number that goes stale, and a
 * floor that far below reality is indistinguishable from no floor. It was
 * independently flagged in four places (KAN-467, the modularisation plan twice,
 * the plan revalidation) and fixed in none — the flagging was not the problem.
 *
 * So the floor is now a generated baseline and the guard fails in BOTH
 * directions: too few tests means something was deleted, and too many means
 * this file is stale and is quietly overstating the protection. The second
 * half is the point. Same shape as the F4 raw-literal ratchet.
 *
 * USAGE
 *   npm run gen:test-floor        # measure and write the baseline
 *
 * Run it in the SAME commit as any change to the test count. `git ls-files`
 * is not involved here — jest --listTests walks the filesystem — so unstaged
 * new files ARE counted, unlike the raw-literal ratchet.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests/support/test-floor-baseline.json');
/** Shared with both guard suites — see tests/support/transient-probes.json. */
const TRANSIENT_PROBE_RE = new RegExp(
  JSON.parse(readFileSync(join(ROOT, 'tests/support/transient-probes.json'), 'utf8')).pattern,
);

/** The measurement the guard uses. Kept here so the two cannot disagree. */
export function measure() {
  const listed = execSync(
    "npx jest --testPathPatterns='tests/(unit|scripts)' --listTests",
    { cwd: ROOT, encoding: 'utf8' },
  );
  // Same transient-probe exclusion as the guard. If these two ever disagree the
  // baseline is measured against a different set than the gate enforces, which
  // is a silent, permanent off-by-N.
  const files = listed
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((f) => !TRANSIENT_PROBE_RE.test(basename(f)));

  let blocks = 0;
  for (const f of files) {
    let content;
    try {
      content = readFileSync(f, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    // test()/it() at line start, allowing indentation. Approximate — does not
    // expand `test.each([...])` — and deliberately matches the heuristic in
    // weekly-report.yml so the two stay aligned.
    blocks += (content.match(/^[ \t]*(test|it)\(/gm) || []).length;
  }
  return { files: files.length, blocks };
}

const { files, blocks } = measure();

const baseline = {
  $comment:
    'GENERATED — regenerate with `npm run gen:test-floor`. The enforced test ' +
    'floor. The guard fails if the counts DROP (a test was deleted) and also ' +
    'if they RISE (this baseline is stale and is overstating how much of the ' +
    'estate is actually protected). The rise case is the one that matters: ' +
    'the previous hand-maintained floor sat at 29 files / 320 blocks against ' +
    'an actual 260 / 2963, so ~89% of the tests could have been deleted ' +
    'silently. Raise it in the SAME commit as any net-new test.',
  measured_at: new Date().toISOString().slice(0, 10),
  test_files: files,
  test_blocks: blocks,
};

writeFileSync(OUT, JSON.stringify(baseline, null, 2) + '\n');
console.log(`test-floor baseline: ${files} files, ${blocks} blocks -> ${OUT}`);
