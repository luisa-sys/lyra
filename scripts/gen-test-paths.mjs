#!/usr/bin/env node
/**
 * KAN-414 F4 (KAN-417 §3) — generate the test path manifest.
 *
 * WHY THIS EXISTS
 * ---------------
 * 121 test files read source files by literal path — `readFileSync(resolve(ROOT,
 * 'src/app/dashboard/profile/actions.ts'))` and friends — across 194 distinct
 * repo-path literals. Every one of those is a file move away from an
 * information-free `ENOENT`, and the pressure that creates is to weaken the
 * test rather than fix the path, which the Test Integrity Policy forbids.
 *
 * KAN-419 measured the same coupling growing 18–31% in two days with no
 * modularisation work in flight. It is the single largest line item in Phase 0
 * and the one most likely to be skipped.
 *
 * The manifest is the indirection: tests import `SRC.profileActions` instead of
 * hard-coding the path, so a module move updates ONE generated file instead of
 * N tests.
 *
 * WHY GENERATED AND NOT HAND-WRITTEN
 * ----------------------------------
 * A hand-maintained list drifts from what the tests actually reference — which
 * is exactly why `check-partial-write-safety.py` had to be changed from a
 * hand-maintained reader list to a tree scan (BUGS-74's second fix). This reads
 * the literals out of `tests/**` itself, so it cannot disagree with reality.
 *
 * NAMING
 * ------
 * Symbolic names are derived deterministically from the path, so regenerating
 * never renames an entry under a reader's feet. Route-group parens and
 * bracketed dynamic segments are stripped (`(auth)`, `[slug]`), the extension
 * is dropped, and the remainder is camelCased. Collisions are resolved by
 * prepending more of the path — never by a counter suffix, which would make the
 * name meaningless and order-dependent.
 *
 * OUTPUTS
 *   tests/support/source-paths.ts    — for TS/JS tests (`import { SRC }`)
 *   tests/support/source-paths.json  — for .cjs and shell consumers
 *
 * USAGE
 *   npm run gen:test-paths          # write
 *   npm run gen:test-paths -- --check   # verify committed output is current
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_TS = join(ROOT, 'tests/support/source-paths.ts');
const OUT_JSON = join(ROOT, 'tests/support/source-paths.json');

// Repo roots a test may legitimately reference by path, encoded in the regex
// below. `tests/` itself is deliberately absent: a test referencing another
// test is test-estate coupling, which KAN-429 owns, not this manifest.
const LITERAL_RE = /'((?:src|supabase|scripts|public|\.github)\/[A-Za-z0-9_./[\]()@-]+)'/g;

function trackedTestFiles() {
  const out = execFileSync('git', ['-C', ROOT, 'ls-files', 'tests'], {
    encoding: 'utf-8',
  });
  return out
    .split('\n')
    .filter((f) => f && /\.(ts|tsx|js|jsx|cjs|mjs)$/.test(f));
}

/** Every repo-path literal referenced from tests/, deduped and sorted. */
function collectLiterals() {
  const found = new Set();
  for (const rel of trackedTestFiles()) {
    let text;
    try {
      text = readFileSync(join(ROOT, rel), 'utf-8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(LITERAL_RE)) {
      const p = m[1];
      // Only real files. A literal that matches nothing is either a glob
      // fragment or already-dead, and neither belongs in a manifest whose
      // whole promise is "this path exists".
      if (existsSync(join(ROOT, p))) found.add(p);
    }
  }
  return [...found].sort();
}

function camel(parts) {
  return parts
    .map((s, i) =>
      i === 0
        ? s.charAt(0).toLowerCase() + s.slice(1)
        : s.charAt(0).toUpperCase() + s.slice(1),
    )
    .join('');
}

/** Path -> identifier segments, most-specific last. */
function segments(p) {
  return p
    .replace(/^(src|supabase|scripts|public|\.github)\//, '')
    .replace(/\.[a-z]+$/i, '')
    .split('/')
    .map((s) => s.replace(/^\((.*)\)$/, '$1')) // (auth) -> auth
    .map((s) => s.replace(/^\[\.{0,3}(.*)\]$/, '$1')) // [slug] -> slug
    // SCREAMING_SNAKE segments are lowercased first, else camelCasing yields
    // `pULLREQUESTTEMPLATE` — technically unique, unreadable in a diff, and the
    // kind of generated ugliness that makes people hand-edit generated files.
    .map((s) => (/[a-z]/.test(s) ? s : s.toLowerCase()))
    .map((s) => s.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')))
    .filter(Boolean);
}

/**
 * Deterministic, collision-free names.
 *
 * Start from the last segment and widen leftwards until unique. Never a numeric
 * suffix: `profileActions2` tells a reader nothing and its assignment depends on
 * iteration order, so an unrelated addition could silently swap two names.
 */
function nameFor(all) {
  const names = new Map();
  const taken = new Map();

  for (const p of all) {
    const segs = segments(p);
    // A name must be a usable identifier, or `SRC.<name>` does not parse.
    // Migration filenames begin with their version timestamp, so the last
    // segment alone yields `20260330120000AddAvatarUrl...` — widening left
    // picks up the parent directory and fixes it with the logic already here.
    const unusable = (c) =>
      /^[0-9]/.test(c) || (taken.has(c) && taken.get(c) !== p);

    let width = 1;
    let candidate = camel(segs.slice(-width));
    while (unusable(candidate) && width < segs.length) {
      width += 1;
      candidate = camel(segs.slice(-width));
    }
    if (unusable(candidate)) {
      // Genuinely identical after full widening — fall back to the whole path,
      // which is always unique.
      candidate = camel(p.replace(/\.[a-z]+$/i, '').split(/[^A-Za-z0-9]+/));
    }
    taken.set(candidate, p);
    names.set(p, candidate);
  }
  return names;
}

function render(paths, names) {
  const rows = paths
    .map((p) => `  ${names.get(p)}: '${p}',`)
    .join('\n');

  const ts = `// GENERATED FILE — DO NOT EDIT BY HAND.
// Regenerate with: npm run gen:test-paths
//
// KAN-414 F4 / KAN-417 §3 — the test path manifest.
//
// Structural tests import a symbolic name from here instead of hard-coding a
// repo path, so a module move updates THIS FILE (one place) rather than every
// test that happened to name the file. Without it, the first extraction turns
// dozens of tests into information-free ENOENT failures, and the pressure that
// creates is to weaken the test rather than fix the path.
//
// Entries are derived from the literals tests actually reference, so this
// cannot drift from reality — a hand-maintained list is what let BUGS-74's
// first fix miss the legacy editor.
//
// ${paths.length} entries.

export const SRC = {
${rows}
} as const;

export type SourcePathKey = keyof typeof SRC;
`;

  const json = `${JSON.stringify(
    {
      $comment:
        'GENERATED — regenerate with `npm run gen:test-paths`. Mirror of ' +
        'tests/support/source-paths.ts for .cjs and shell consumers (KAN-414 F4).',
      generated_from: 'literals referenced by tracked files under tests/',
      count: paths.length,
      SRC: Object.fromEntries(paths.map((p) => [names.get(p), p])),
    },
    null,
    2,
  )}\n`;

  return { ts, json };
}

function main() {
  const check = process.argv.includes('--check');
  const paths = collectLiterals();
  if (paths.length === 0) {
    console.error(
      '::error::gen-test-paths found no repo-path literals under tests/. ' +
        'Refusing to write an empty manifest — that would silently disarm every ' +
        'test that depends on it.',
    );
    process.exit(2);
  }

  const names = nameFor(paths);
  const { ts, json } = render(paths, names);

  if (check) {
    const cur = existsSync(OUT_TS) ? readFileSync(OUT_TS, 'utf-8') : '';
    const curJson = existsSync(OUT_JSON) ? readFileSync(OUT_JSON, 'utf-8') : '';
    if (cur !== ts || curJson !== json) {
      console.error(
        '::error::tests/support/source-paths.{ts,json} are out of date. ' +
          'Run `npm run gen:test-paths` and commit the result.',
      );
      process.exit(1);
    }
    console.log(`source-paths manifest is current (${paths.length} entries).`);
    return;
  }

  mkdirSync(dirname(OUT_TS), { recursive: true });
  writeFileSync(OUT_TS, ts);
  writeFileSync(OUT_JSON, json);
  console.log(`Wrote ${paths.length} entries to tests/support/source-paths.{ts,json}`);
}

main();
