/**
 * KAN-351 (finding web-arch-3) — public-profile data-access integrity.
 *
 * The public profile Server Component (`src/app/[slug]/page.tsx`) used to run
 * its per-profile section reads as a sequential await-waterfall and dropped
 * every Supabase `error` on the floor, so a partial DB outage rendered an
 * incomplete profile as a clean 200 (a "misleading success").
 *
 * This guard locks in the two behavioural fixes that shipped in place (the
 * larger structural extraction into `src/lib` + JSX component split is deferred
 * — the repo's source-grep regression guards pin the queries/JSX into
 * page.tsx, so relocating them needs test-integrity sign-off):
 *
 *   1. the five section reads run in ONE `Promise.all(...)` batch, and
 *   2. any read error is surfaced (Sentry + a thrown error), never swallowed.
 *
 * Same cheap static-coverage pattern as the sibling KAN-181 / SEC-44 guards.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SRC } from '../support/source-paths';

const ROOT = resolve(__dirname, '../..');
const PAGE = SRC.slugPage;

describe('KAN-351: public profile reads are batched and errors surfaced', () => {
  const src = readFileSync(resolve(ROOT, PAGE), 'utf8');

  test('imports the Sentry SDK for error surfacing', () => {
    expect(src).toMatch(/import \* as Sentry from '@sentry\/nextjs'/);
  });

  test('runs the five section reads in a single Promise.all batch', () => {
    // Locate the batch and assert all five tables are read inside it (proves
    // the sequential waterfall is gone).
    const batchStart = src.indexOf('await Promise.all([');
    expect(batchStart).toBeGreaterThan(-1);
    const batchBlock = src.slice(batchStart, src.indexOf('];', batchStart));

    for (const table of [
      'profile_items',
      'school_affiliations',
      'external_links',
      'profile_manual_of_me',
      'profile_conversation_starters',
    ]) {
      expect(batchBlock).toContain(`.from('${table}')`);
    }
  });

  test('captures every read error to Sentry and fails loudly (no silent 200)', () => {
    expect(src).toMatch(/Sentry\.captureException\(/);
    // A non-empty error set must throw rather than render an empty profile.
    expect(src).toMatch(/sectionReadErrors/);
    expect(src).toMatch(/throw new Error\(/);
  });

  test('does not reintroduce a sequential per-read await for the batched tables', () => {
    // The old pattern was `const { data: schools } = await getSupabase()`.
    // After batching, the section reads are destructured from the Promise.all
    // result, so no standalone awaited getSupabase() read should remain for
    // these tables.
    expect(src).not.toMatch(/const \{ data: schools \} = await getSupabase\(\)/);
    expect(src).not.toMatch(/const \{ data: links \} = await getSupabase\(\)/);
    expect(src).not.toMatch(/const \{ data: manualOfMeRow \} = await getSupabase\(\)/);
  });
});
