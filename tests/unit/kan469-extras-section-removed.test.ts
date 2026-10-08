/**
 * KAN-469 — "A couple of extras" is gone from the profile editor, and the
 * standalone billboard block is gone from the public profile.
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * A removal is the hardest kind of change to guard. Adding a feature leaves
 * something to assert on; removing one leaves an absence, and an absence is
 * exactly what a careless `toContain` cannot distinguish from a rename, a
 * reorder, or a merge conflict resolved the wrong way. Both halves of this
 * change are one line of a literal away from silently coming back:
 *
 *   - the editor's `SECTIONS` array is a list of object literals, so a revert
 *     or a bad merge reinstates the section with no type error and no other
 *     test noticing;
 *   - the public page's block was a plain `{cond && <section/>}`, likewise.
 *
 * So this suite ENUMERATES the editor's section ids rather than sampling them
 * (gotcha #29 — only classifying every entry finds the one that came back),
 * and asserts the public page reaches `groupedItems['billboard']` nowhere at
 * all.
 *
 * WHY A SOURCE PARSE AND NOT A RENDER
 * -----------------------------------
 * `SECTIONS` is module-private to a `'use client'` component that pulls in the
 * router, ten server actions and the whole item/link/starter data shape.
 * Rendering it to read back a list of headings would test the mocks. Parsing
 * the array literal reads the same declaration the component maps over, and
 * every assertion below runs against COMMENT-STRIPPED source — CTL-039 /
 * SEC-100 is the failure where a removed string survives in the prose
 * documenting its removal, and the scan asserting it is gone keeps matching
 * the comment.
 *
 * MUTATION PROOF (2026-08-06). Each mutation was applied to the real source,
 * this suite re-run, and the source restored from a /tmp copy and confirmed
 * byte-identical by shasum. Baseline: 8 passed, 0 failed.
 *
 *   mutation                                              failures it causes
 *   --------------------------------------------------------------------------
 *   re-add the `extras` entry to SECTIONS                          3
 *   re-add the public billboard block to [slug]/page.tsx           1
 *   replace stripComments with the identity function               0
 *
 * READ THAT LAST ROW HONESTLY. The strip is currently defence-in-depth, NOT
 * load-bearing, and the first draft of this header claimed the opposite —
 * asserting the suite would go green-for-the-wrong-reason without it. The
 * experiment says otherwise, and the reason is worth keeping: the two comments
 * this change added to `edit-profile-form.tsx` and `[slug]/page.tsx` were
 * written to avoid naming the strings they removed, so an un-stripped scan has
 * nothing to match on. That is a property of today's prose, not of the guard.
 * Add one comment mentioning `'billboard'` or "A couple of extras" near either
 * site and the strip becomes the only thing standing between this suite and a
 * vacuous pass — which is precisely why it stays, and why the row above says 0
 * rather than pretending otherwise.
 */

import fs from 'fs';
import path from 'path';

const { SRC } = require('../support/source-paths.json');

const root = path.join(__dirname, '../..');

/**
 * Strip block and line comments. Mirrors the helper in
 * profile-sections.test.js — the `(^|[^:])` guard keeps `https://` intact.
 */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const read = (rel: string): string =>
  stripComments(fs.readFileSync(path.join(root, rel), 'utf8'));

describe('KAN-469: the editor no longer offers "A couple of extras"', () => {
  let sectionsLiteral: string;
  let ids: string[];

  beforeAll(() => {
    const src = read(SRC.editProfileForm);

    // Slice out the SECTIONS array literal itself, so a stray `id:` elsewhere
    // in a 500-line component cannot join the enumeration.
    const start = src.indexOf('const SECTIONS: SectionDef[] = [');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\n];', start);
    expect(end).toBeGreaterThan(start);
    sectionsLiteral = src.slice(start, end);

    ids = Array.from(sectionsLiteral.matchAll(/\bid:\s*'([^']+)'/g)).map((m) => m[1]);
  });

  test('the section list is non-trivial — the parse actually found sections', () => {
    // Guards the enumeration itself: if the slice above ever stops matching,
    // `ids` becomes [] and every "does not contain" assertion below passes
    // vacuously. This is the one assertion that fails loudly in that case.
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
  });

  test('no section has the id "extras"', () => {
    expect(ids).not.toContain('extras');
  });

  test('no section is labelled "A couple of extras"', () => {
    const labels = Array.from(sectionsLiteral.matchAll(/\blabel:\s*(['"])(.*?)\1/g)).map(
      (m) => m[2],
    );
    expect(labels.length).toBeGreaterThanOrEqual(10);
    expect(labels.some((l) => /couple of extras/i.test(l))).toBe(false);
  });

  test('the editor declares no section carrying the billboard category', () => {
    // The categories array is what wired the removed section to item rows.
    // A section re-added under a different id or label would still need this.
    expect(sectionsLiteral).not.toContain("'billboard'");
  });

  test('the sections the prompt moved to and from are both still there', () => {
    // 'starters' is "A bit more about me" — where the billboard prompt now
    // lives, added as a conversation starter rather than in code. 'links'
    // stayed last when the removed section was spliced out from above it.
    expect(ids).toContain('starters');
    expect(ids[ids.length - 1]).toBe('links');
  });
});

describe('KAN-469: the public profile no longer renders a standalone billboard', () => {
  let page: string;

  beforeAll(() => {
    page = read(SRC.slugPage);
  });

  test('the public page source is non-trivial — the read actually found it', () => {
    expect(page.length).toBeGreaterThan(1000);
    expect(page).toContain('groupedItems');
  });

  test('nothing on the public page reads the billboard category', () => {
    expect(page).not.toContain("groupedItems['billboard']");
    expect(page).not.toContain('billboard');
  });

  test('the Q&A section that absorbs the prompt is untouched', () => {
    // The billboard block sat between the Q&A section and Links. Removing it
    // must not have taken either neighbour with it.
    expect(page).toContain("groupedItems['questions']");
    expect(page).toContain('A bit more about me');
    expect(page).toContain('typedLinks');
  });
});
