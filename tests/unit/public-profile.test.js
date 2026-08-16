/**
 * Public Profile unit tests
 * KAN-8: Public Profiles & Landing Page
 */

const fs = require('fs');
const path = require('path');
const { SRC } = require('../support/source-paths.json');

const root = path.join(__dirname, '../..');

describe('Public Profile', () => {
  test('public profile page exists at [slug]', () => {
    expect(fs.existsSync(path.join(root, SRC.slugPage))).toBe(true);
  });

  test('custom 404 page exists for missing profiles', () => {
    expect(fs.existsSync(path.join(root, SRC.notFound))).toBe(true);
  });

  test('public profile page has dynamic metadata generation', () => {
    const content = fs.readFileSync(path.join(root, SRC.slugPage), 'utf8');
    expect(content).toContain('generateMetadata');
    expect(content).toContain('openGraph');
  });

  test('public profile page only shows published profiles', () => {
    const content = fs.readFileSync(path.join(root, SRC.slugPage), 'utf8');
    expect(content).toContain("is_published");
    expect(content).toContain("notFound");
  });

  test('public profile page displays all profile sections', () => {
    const content = fs.readFileSync(path.join(root, SRC.slugPage), 'utf8');
    expect(content).toContain('bio_short');
    expect(content).toContain('school_affiliations');
    expect(content).toContain('profile_items');
    expect(content).toContain('external_links');
    expect(content).toContain('gift_ideas');
    expect(content).toContain('boundaries');
  });

  // KAN-404: the public profile no longer renders a Files & media section.
  // The private-bucket signed-URL machinery (formerly BUGS-33 / SEC-03b) was
  // intentionally removed so edit == published. Guard that no Files/media
  // rendering — nor any bucket URL access — reappears on the public page.
  test('public profile does not render a Files & media section (KAN-404)', () => {
    const content = fs.readFileSync(path.join(root, SRC.slugPage), 'utf8');
    expect(content).not.toContain('Files & media');
    expect(content).not.toContain('createSignedUrl');
    expect(content).not.toContain('object/public/profile-files');
  });

  // KAN-404: Play (🎭) favourites are addable in the editor but were not being
  // rendered on the public profile (FAV_DEFS had no 'plays' entry, so Play items
  // saved but never showed). Guard that the public favourites grid includes it.
  //
  // KAN-444 folded plays into the merged "Movies, plays & TV" group and moved
  // the table into the shared favourites module, so the standalone heading
  // 'Favourite plays' no longer exists anywhere — a deliberate copy change,
  // not a dropped category. What KAN-404 was actually protecting (a saved
  // Play still reaches the public profile) is asserted BEHAVIOURALLY over the
  // real grouping function in kan444-favourites-groups.test.ts, which is
  // strictly stronger than either string match: it fails if 'plays' is
  // dropped from the group, whereas a source scan cannot tell a rendered
  // category from a mentioned one.
  test("public profile renders the 'plays' favourites category (KAN-404/KAN-444)", () => {
    const content = fs.readFileSync(path.join(root, SRC.favourites), 'utf8');
    expect(content).toContain("'plays'");
    // Assert the group DEFINITION, not its heading: the heading text also
    // appears in that module's explanatory comment, so matching it would
    // survive deleting the group (CTL-039 flags exactly that shape).
    expect(content).toContain("categories: ['favourite_media', 'plays', 'favourite_tv']");
  });
});
