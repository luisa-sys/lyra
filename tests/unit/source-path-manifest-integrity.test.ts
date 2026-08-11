import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../');
const { SRC } = require('../support/source-paths.json') as { SRC: Record<string, string> };

/**
 * KAN-415 — the source-path manifest must never resolve to `undefined`.
 *
 * WHAT THIS CATCHES, AND WHY IT IS NOT THEORETICAL
 * ------------------------------------------------
 * `scripts/gen-test-paths.mjs` builds `SRC` by harvesting path literals from
 * `tests/**`, and keeps only the ones that still resolve on disk. Because
 * `tests/support/source-paths.ts` is itself a tracked test file containing its
 * own values, the manifest normally re-discovers everything it already holds —
 * it is SELF-SUSTAINING, and that is precisely what makes the failure mode
 * surprising.
 *
 * A FILE MOVE breaks the loop. The old literal stops resolving and is dropped;
 * no test carries the new literal yet, so nothing replaces it; the key
 * disappears. `SRC.thatKey` is then `undefined`, and undefined is quietly
 * useful in all the wrong ways:
 *
 *   readFileSync(resolve(ROOT, SRC.gone))   -> "paths[1] must be of type string"
 *   expect(src).not.toContain(SRC.gone)     -> PASSES. Always. Forever.
 *
 * The first reads like a broken harness. The SECOND is the dangerous one: a
 * negative assertion against `undefined` is vacuously true, so a test can stop
 * checking anything at all with no diff to the test and no red build. That is
 * the `SRC.libEnv` defect from earlier in this programme — a key that never
 * existed, feeding a `not.toContain` that could never fail.
 *
 * This file makes both impossible to introduce silently. It asserts against the
 * WHOLE test estate rather than any one file, so it protects tests written by
 * people who have never heard of it — which is the only kind of guard worth
 * having for a manifest that a routine `git mv` can quietly hollow out.
 */

/** Every tracked test file the generator itself would consider. */
function trackedTestFiles(): string[] {
  return execFileSync('git', ['ls-files', 'tests'], { cwd: REPO_ROOT, stdio: 'pipe' })
    .toString()
    .split('\n')
    .filter((f) => f && /\.(ts|tsx|js|jsx|cjs|mjs)$/.test(f));
}

/**
 * `SRC.<key>` references that are real CODE, not prose.
 *
 * Comments legitimately name keys while explaining this very hazard — the seed
 * file documents `SRC.foo`, and two files discuss the historical `SRC.libEnv`
 * defect by name. Matching raw source would flag those and the fix would be to
 * stop writing the explanation down, which is the wrong direction: the
 * comment-shadowing lesson (CTL-039) cuts both ways.
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('every SRC key a test actually uses resolves to a real file', () => {
  const references = new Map<string, string[]>();
  for (const rel of trackedTestFiles()) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    } catch {
      continue;
    }
    for (const m of codeOnly(text).matchAll(/\bSRC\.([A-Za-z0-9_]+)/g)) {
      const list = references.get(m[1]) ?? [];
      list.push(rel);
      references.set(m[1], list);
    }
  }

  test('the scan found references at all (it is not vacuously green)', () => {
    // `test.each([])` registers nothing and an empty suite is green, so the
    // sweep below could report success having examined zero files. This is the
    // same vacuity that made the old hand-typed test floor meaningless.
    expect(references.size).toBeGreaterThan(20);
  });

  test.each([...references.keys()].sort())('SRC.%s is defined and points at a tracked file', (key) => {
    const readers = references.get(key)!;
    // Named readers in the message: when this fails after a move, the useful
    // question is "which tests just stopped asserting anything", and answering
    // it from a bare key name means grepping.
    expect({ key, value: SRC[key], readers }).toMatchObject({ value: expect.any(String) });

    const tracked = execFileSync('git', ['ls-files', '--', SRC[key]], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    })
      .toString()
      .trim();
    expect(tracked).not.toBe('');
  });
});

describe('the manifest as a whole stays honest', () => {
  test('no entry points at a path git no longer tracks', () => {
    // A dangling entry is not merely untidy: the generator drops it on the next
    // run, so it is a key that is ABOUT to vanish. Catching it here converts a
    // future confusing TypeError into a clear failure now, in the commit that
    // moved the file.
    const dangling = Object.entries(SRC).filter(([, value]) => {
      const tracked = execFileSync('git', ['ls-files', '--', value], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      })
        .toString()
        .trim();
      return tracked === '';
    });
    expect(dangling).toEqual([]);
  });

  test('every seeded path is in the manifest', () => {
    // The seeds exist precisely to keep keys alive across a move. A seed that
    // has itself gone stale (its file moved again) would silently stop doing
    // that, which is the failure it was introduced to prevent.
    const seeds = fs.readFileSync(
      path.join(REPO_ROOT, 'tests', 'support', 'source-path-seeds.ts'),
      'utf8',
    );
    const values = new Set(Object.values(SRC));
    const declared = [...codeOnly(seeds).matchAll(/'([^']+\/[^']+)'/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    for (const seedPath of declared) {
      expect(values.has(seedPath)).toBe(true);
    }
  });
});
