/**
 * Missing profile sections tests
 * KAN-137: Restore missing profile section types from original Python/Flask app
 */

const fs = require('fs');
const path = require('path');
const { SRC } = require('../support/source-paths.json');
const { stripComments } = require('../support/strip-comments');

const root = path.join(__dirname, '../..');

const NEW_CATEGORIES = [
  'favourite_books', 'favourite_media', 'causes', 'quotes',
  'proud_of', 'life_hacks', 'questions', 'billboard',
];

// KAN-469: the public profile no longer renders 'billboard' — the prompt it
// existed for is now an ordinary conversation starter, so its answer appears
// in the Q&A section with everything else.
//
// This is a SEPARATE list rather than a deletion from NEW_CATEGORIES, and the
// distinction was the whole point: NEW_CATEGORIES also drove the items-step
// label check, which offered a Billboard label until KAN-487 part 3 deleted
// the legacy wizard (and that check with it). Removing the entry from the
// shared list would have quietly weakened that assertion too, which is the
// failure mode this repo keeps re-learning: a list edited to make one caller
// green stops guarding its other callers without saying so.
//
// KAN-488: 'questions' joins it. The legacy "questions" items are a pre-v0.8
// category the v0.8 editor cannot show (KAN-490 migrates them), so the public
// page no longer fetches them; the exact category set the page reads is
// asserted as literals in kan488-public-profile-loader.test.ts.
// Was: NEW_CATEGORIES.filter((c) => c !== 'billboard')
const PUBLIC_PAGE_CATEGORIES = NEW_CATEGORIES.filter((c) => c !== 'billboard' && c !== 'questions');

// KAN-487 part 3 (founder sign-off 2026-11-23, chat): two describes stood
// here and are deleted with the code they read. "KAN-137: Wizard supports new
// section categories" (7 tests) read `wizard.tsx`: the step count, and the
// Files & media, Things to ask me, Books & Media, Causes & Quotes and More
// about you steps. "KAN-137: ItemsStep has labels for all categories" (one
// case per NEW_CATEGORIES entry, 8) read `steps/items-step.tsx`. Both files
// are deleted; the v0.8 editor's section/category table is pinned in the
// kan487 suites. The public-page guards below are unchanged.

describe('KAN-137 / KAN-265: Public profile renders all categories (redesign)', () => {
  // The June-2026 redesign (KAN-265) replaced the categoryLabels / categoryIcons /
  // categoryOrder maps with explicit, warmly-titled sections (white cards, a sage
  // left-rule on each heading, a favourites grid, a Q&A block). Every category is
  // still rendered — these guards prove each is referenced so a future refactor
  // can't silently drop one (which would make those items vanish from profiles).
  // KAN-444 moved the favourites category table out of [slug]/page.tsx and
  // into the shared `favourites` module that the public page and the editor
  // now BOTH render from. The guarantee these guards exist for is unchanged
  // — every category is still rendered on the public profile — but the
  // render path is now two files, so they read both. Reading the module
  // would prove nothing on its own, so the import is pinned separately
  // below: if page.tsx stopped importing it, that assertion goes red and
  // the concatenation stops being a fair reading of the render path.
  const profilePath = path.join(root, SRC.slugPage);
  // Built from the manifest's profile-directory entry rather than a raw repo
  // path, so this adds no new path coupling to the KAN-414 F4 ratchet.
  //
  // KAN-488: the render path changed again. The page now renders the v0.8
  // view model, so the files a public category passes through are the
  // editor's category table, the view model and the section renderer — not
  // the favourites module, which the page no longer imports.
  // Was: const favouritesPath = path.join(root, SRC.favourites);
  const renderPathFiles = [SRC.editorState, SRC.publicViewModel, SRC.publicProfileSections].map((p) =>
    path.join(root, p),
  );
  let pageContent;
  let content;

  // KAN-459: strip comments before matching. `expect(pageContent).toContain(
  // 'A few of my favourite things')` was satisfied by the JSX comment sitting
  // above the real heading, so the entire favourites grid could be disabled
  // and the heading renamed with this suite still fully green. The prose
  // documenting a fix is what conceals its removal — same shape as SEC-100.
  beforeAll(() => {
    pageContent = stripComments(fs.readFileSync(profilePath, 'utf8'));
    // Was: pageContent + stripComments(fs.readFileSync(favouritesPath, 'utf8'))
    content = pageContent + renderPathFiles.map((f) => stripComments(fs.readFileSync(f, 'utf8'))).join('\n');
  });

  test('public page renders favourites through the shared groups module (KAN-444)', () => {
    // KAN-488: the shared module is now the v0.8 view model, which the editor's
    // Preview draws too — the same parity KAN-444 wanted, one level up.
    // Old expected values:
    //   expect(pageContent).toContain("from '@/modules/profile/favourites'");
    //   expect(pageContent).toContain('groupFavourites(typedItems)');
    expect(pageContent).toContain("from '@/modules/profile/editor/public-view-model'");
    expect(pageContent).toContain('buildPublicProfileView(initialEditorState(loaded)');
  });

  test.each(PUBLIC_PAGE_CATEGORIES)('page renders category: %s', (cat) => {
    expect(content).toContain(`'${cat}'`);
  });

  test('favourites render in a dedicated favourites grid', () => {
    // KAN-488: the heading is the view model's §06 label (in `content`); the
    // rendered heading is asserted in kan488-public-profile-page.test.tsx.
    // Was: expect(pageContent).toContain('A few of my favourite things');
    expect(content).toContain('A few of my favourite things');
    expect(content).toContain("['favourite_books'");
    expect(content).toContain("['favourite_media'");
    expect(content).toContain("['quotes'");
  });

  test('questions + conversation starters render as a Q&A section', () => {
    // KAN-488: legacy "questions" items are no longer read (see
    // PUBLIC_PAGE_CATEGORIES above); answered questions render under the v0.8
    // §09 heading. Old expected values:
    //   expect(content).toContain("groupedItems['questions']");
    //   expect(content).toContain('A bit more about me');
    // (founder standing approval 2026-11-23: v0.8 contradicts)
    expect(content).not.toContain("groupedItems['questions']");
    expect(content).toContain('Random Questions & Answers');
  });

  // KAN-469: two tests stood here — one asserting the standalone billboard
  // block existed, one asserting its sage background. Both are gone with the
  // block, and the guard that replaced them is the stronger direction:
  // tests/unit/kan469-extras-section-removed.test.ts asserts the public page
  // reaches `groupedItems['billboard']` NOWHERE, so it goes red if the block
  // ever returns rather than red because it left. Sage-on-this-page coverage
  // is unaffected — see the left-rule test immediately below, which is
  // untouched. Founder-signed-off 2026-08-06.

  // Calm public-profile layout (founder design, Lyra website canvas,
  // 2026-11-23): section headings swap the 3px sage left-rule for a
  // pale-sage hairline beneath the heading. Old expected values:
  //   expect(content).toContain('border-l-[3px]');
  //   expect(content).toContain('border-[var(--color-sage)]');
  test('section headings use the pale-sage hairline beneath (border-b)', () => {
    expect(content).toContain('border-b border-[var(--color-lyra-sage-light)]');
    expect(content).not.toContain('border-l-[3px]');
  });
});
