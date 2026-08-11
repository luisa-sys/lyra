/**
 * KAN-444 — favourites as five fixed groups plus add-your-own.
 * KAN-458 — causes as its own section (regression guard).
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * The favourites grouping is rendered on two surfaces — the editor
 * (`edit-profile-form.tsx` → `ItemsStep`) and the public profile
 * (`src/app/[slug]/page.tsx`). Before KAN-444 each carried its own literal
 * list, and they had already drifted once: KAN-404 records Play items that
 * saved in the editor and never appeared publicly, because the public
 * `FAV_DEFS` had no `'plays'` entry. A member arranged their page one way
 * and visitors saw another.
 *
 * So the assertions below are deliberately weighted towards the two things
 * that actually go wrong: PARITY between the surfaces, and `causes` staying
 * out of favourites (it is its own section — KAN-458 — and a member whose
 * causes appeared in both places would be listed twice).
 *
 * WHY BEHAVIOURAL, NOT A SOURCE SCAN
 * ----------------------------------
 * The guard KAN-404 left behind was `expect(page).toContain("'plays'")`. A
 * string match cannot tell a rendered category from a mentioned one, which
 * is BUGS-85 / SEC-100's shape: `toContain('is_published')` stayed green
 * while suspended members were being published, because the string also
 * appeared in the comment explaining the filter. Every case here runs the
 * real `groupFavourites` over real item rows, so it can only pass if the
 * grouping actually groups. The handful of structural assertions at the end
 * exist solely to prove both surfaces are WIRED to that function — they
 * strip comments first, so no comment can satisfy them.
 *
 * MUTATION PROOF (2026-08-03). Each mutation was applied to the real source,
 * this file plus profile-sections/public-profile were re-run, and the source
 * was restored from a /tmp copy and confirmed byte-identical by shasum.
 * Baseline across those four suites: 65 passed, 0 failed.
 *
 *   mutation                                            failures it causes
 *   ----------------------------------------------------------------------
 *   drop 'plays' from the merged screen group                     3
 *   add 'causes' to a favourites group                            3
 *   make groupFavourites ignore group_label entirely              4
 *   offer a picker category no group renders (parity drift)       2
 *   relabel one picker option away from its heading (drift)       1
 *   re-hardcode a favourites list in [slug]/page.tsx (drift)      2
 *   delete the causes section from the editor  (KAN-458)          1
 *   delete the causes heading from [slug]/page (KAN-458)          2
 *   stop passing groupLabel through to onAdd                      1
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SRC } from '../support/source-paths';

import {
  FAVOURITE_GROUPS,
  FAVOURITE_CATEGORIES,
  FAVOURITE_CATEGORY_OPTIONS,
  CUSTOM_FAVOURITE_CATEGORY,
  CUSTOM_FAVOURITE_FALLBACK_LABEL,
  groupFavourites,
  favouriteLabelForItem,
  isFavouriteCategory,
  primaryCategory,
} from '@/modules/profile/favourites';

const ROOT = resolve(__dirname, '../..');

/**
 * Strip // and block comments so a source assertion is answered by the code
 * and not by the prose describing it. This is the failure mode CTL-039 was
 * built for: `sitemap.ts` mentioned `is_published` twice — once in the query
 * and once in the comment explaining the query — so deleting the query left
 * the scan matching the comment.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readSource(relPath: string): string {
  return stripComments(readFileSync(resolve(ROOT, relPath), 'utf-8'));
}

interface Row {
  id: string;
  category: string;
  title: string;
  group_label?: string | null;
}

let nextId = 0;
function item(category: string, title: string, groupLabel?: string | null): Row {
  nextId += 1;
  return { id: `i${nextId}`, category, title, ...(groupLabel !== undefined ? { group_label: groupLabel } : {}) };
}

// ───────────── The five fixed groups ─────────────

describe('KAN-444: five fixed favourites groups', () => {
  test('are exactly Books · Movies, plays & TV · Quotes · Music · Places, in that order', () => {
    expect(FAVOURITE_GROUPS.map((g) => g.label)).toEqual([
      'Books',
      'Movies, plays & TV',
      'Quotes',
      'Music',
      'Places',
    ]);
  });

  test('merges films, plays and TV into ONE group (KAN-404 regression, behavioural)', () => {
    const cards = groupFavourites([
      item('favourite_media', 'Amélie'),
      item('plays', 'Hamlet'),
      item('favourite_tv', 'Detectorists'),
    ]);

    // One card, not three — and every one of the three items inside it.
    expect(cards).toHaveLength(1);
    expect(cards[0].label).toBe('Movies, plays & TV');
    expect(cards[0].items.map((i) => i.title)).toEqual(['Amélie', 'Hamlet', 'Detectorists']);
  });

  test('each of the five groups renders its own card when populated', () => {
    const rows = FAVOURITE_GROUPS.map((g) => item(primaryCategory(g), `a ${g.label} entry`));
    const cards = groupFavourites(rows);
    expect(cards.map((c) => c.label)).toEqual(FAVOURITE_GROUPS.map((g) => g.label));
  });

  test('an empty group produces no card — the grid shows what was shared, not blanks', () => {
    const cards = groupFavourites([item('favourite_books', 'Piranesi')]);
    expect(cards.map((c) => c.label)).toEqual(['Books']);
  });

  test('no item is invented, dropped or duplicated by grouping', () => {
    const rows = [
      item('favourite_books', 'Piranesi'),
      item('plays', 'Hamlet'),
      item('quotes', 'Still I rise'),
      item(CUSTOM_FAVOURITE_CATEGORY, 'Wingspan', 'Board games'),
      item('favourite_music', 'Nina Simone'),
    ];
    const grouped = groupFavourites(rows).flatMap((c) => c.items.map((i) => i.id));
    expect(grouped.sort()).toEqual(rows.map((r) => r.id).sort());
  });
});

// ───────────── The category list itself (independent pin) ─────────────

// Deliberately an explicit literal, NOT derived from FAVOURITE_CATEGORIES.
// The parity tests below build their fixtures FROM that array, so shrinking it
// also shrinks their domain and they stay green — a test that cannot fail.
// This matters because edit-profile-form.tsx filters the editor's items by
// `categories.includes(item.category)`: drop a category here and every existing
// member's items in it VANISH from the editor — invisible, un-editable,
// un-deletable — while still rendering on their public profile.
describe('KAN-444: the favourites category list is pinned', () => {
  test('FAVOURITE_CATEGORIES is exactly the expected set', () => {
    expect([...FAVOURITE_CATEGORIES].sort()).toEqual([
      'favourite_books',
      'favourite_custom',
      'favourite_media',
      'favourite_music',
      'favourite_places',
      'favourite_tv',
      'plays',
      'quotes',
    ]);
  });

  // Every category belongs to exactly one FIXED group — except the custom one,
  // which is deliberately outside FAVOURITE_GROUPS because it renders as
  // member-named cards rather than a fixed heading. Pinning that asymmetry
  // stops a category being silently claimed twice (it would render in two
  // cards) or by none (it would render nowhere while still being editable).
  test('every pinned category is claimed by exactly one fixed group', () => {
    for (const category of FAVOURITE_CATEGORIES) {
      const owners = FAVOURITE_GROUPS.filter((g) => g.categories.includes(category));
      expect({ category, owners: owners.length }).toEqual({
        category,
        owners: category === CUSTOM_FAVOURITE_CATEGORY ? 0 : 1,
      });
    }
  });
});

// ───────────── The editor actually consumes the shared table ─────────────

// The parity guarantee is only structural for groupFavourites(). The editor's
// CONSUMPTION of it lives in ItemsStep, and the repo has no component test
// library — so these are comment-stripped source assertions on the specific
// wiring whose removal is invisible to every other test. Each was proven to
// survive deletion before these were added: the group-name input could be
// disabled (add-your-own permanently un-addable), the picker could fall back
// to raw per-category options, and the row label could bypass labelForItem —
// all with the suite fully green, reintroducing exactly the editor-vs-public
// drift this feature exists to prevent.
describe('KAN-444: the editor is wired to the shared grouping', () => {
  // Via the manifest, not raw literals — raw paths feed the KAN-414 F4
  // shrink-only ratchet, and a path that moves must move in one place.
  const itemsStep = readSource(SRC.itemsStep);
  const editor = readSource(SRC.editProfileForm);

  test('the group-name input is gated only on needsGroupLabel', () => {
    expect(itemsStep).toMatch(/\{\s*needsGroupLabel\s*&&\s*\(/);
    expect(itemsStep).not.toMatch(/\{\s*false\s*&&\s*needsGroupLabel/);
  });

  test('a group name is required before a custom item can be added', () => {
    expect(itemsStep).toMatch(/canAdd[\s\S]{0,120}needsGroupLabel[\s\S]{0,60}groupLabel\.trim\(\)\s*!==\s*''/);
  });

  test('the picker prefers the shared group options over raw categories', () => {
    expect(itemsStep).toMatch(/pickerOptions\s*=\s*categoryOptions\s*\?\?/);
  });

  test('row labels go through labelForItem, so the editor names match the public cards', () => {
    expect(itemsStep).toContain('labelForItem?.(item)');
  });

  test('the favourites section passes both the group options and the label fn', () => {
    expect(editor).toContain('categoryOptions: FAVOURITE_CATEGORY_OPTIONS');
    expect(editor).toContain('labelForItem: favouriteLabelForItem');
    expect(editor).toMatch(/categoryOptions=\{s\.categoryOptions\}/);
  });
});

// ───────────── Causes is NOT a favourite (KAN-458) ─────────────

describe('KAN-458: causes is its own section, never a favourites group', () => {
  test("'causes' is not a favourites category", () => {
    expect(FAVOURITE_CATEGORIES).not.toContain('causes');
    expect(isFavouriteCategory('causes')).toBe(false);
  });

  test('no favourites group claims the causes category', () => {
    for (const group of FAVOURITE_GROUPS) {
      expect(group.categories).not.toContain('causes');
    }
  });

  test('a causes item is not grouped into any favourites card', () => {
    const cards = groupFavourites([
      item('causes', 'Refuge'),
      item('favourite_books', 'Piranesi'),
    ]);
    expect(cards.map((c) => c.label)).toEqual(['Books']);
    expect(cards.flatMap((c) => c.items.map((i) => i.title))).not.toContain('Refuge');
  });

  test('the editor never offers causes as a favourites choice', () => {
    expect(FAVOURITE_CATEGORY_OPTIONS.map((o) => o.value)).not.toContain('causes');
  });

  test('causes is its own editor section, with name + note + link fields', () => {
    const editor = readSource(SRC.editProfileForm);
    // A standalone SECTIONS entry keyed 'causes' whose only category is 'causes'.
    expect(editor).toMatch(/id:\s*'causes'[\s\S]{0,400}?categories:\s*\['causes'\]/);
    expect(editor).toContain('Causes close to my heart');
    // Its rows are ItemsStep rows, which is where title / description / url
    // (name / note / link) come from.
    expect(editor).toMatch(/kind:\s*'items'/);
  });

  test('causes renders under its own heading on the public profile', () => {
    const page = readSource(SRC.slugPage);
    expect(page).toContain("groupedItems['causes']");
    expect(page).toContain('Causes close to my heart');
  });
});

// ───────────── Editor ↔ public parity ─────────────

describe('KAN-444: the editor and the public profile group identically', () => {
  test('every category the editor can write is rendered by the public grouping', () => {
    // One item per editable category; nothing may fall on the floor.
    const rows = FAVOURITE_CATEGORIES.map((c) => item(c, `entry for ${c}`));
    const rendered = groupFavourites(rows).flatMap((c) => c.items.map((i) => i.category));
    for (const category of FAVOURITE_CATEGORIES) {
      expect(rendered).toContain(category);
    }
  });

  test('every category the picker offers is one the public grouping renders', () => {
    for (const option of FAVOURITE_CATEGORY_OPTIONS) {
      const cards = groupFavourites([item(option.value, 'x', 'Board games')]);
      expect(cards).toHaveLength(1);
      expect(cards[0].items).toHaveLength(1);
    }
  });

  test('the picker labels ARE the public headings — same words, same order', () => {
    const pickerFixedLabels = FAVOURITE_CATEGORY_OPTIONS.filter(
      (o) => o.value !== CUSTOM_FAVOURITE_CATEGORY,
    ).map((o) => o.label);

    const rows = FAVOURITE_CATEGORY_OPTIONS.filter((o) => o.value !== CUSTOM_FAVOURITE_CATEGORY).map(
      (o) => item(o.value, `entry for ${o.label}`),
    );
    const publicLabels = groupFavourites(rows).map((c) => c.label);

    expect(pickerFixedLabels).toEqual(publicLabels);
  });

  test("the editor's row label matches the card the item will appear under", () => {
    const rows = [
      item('favourite_books', 'Piranesi'),
      item('plays', 'Hamlet'),
      item(CUSTOM_FAVOURITE_CATEGORY, 'Wingspan', 'Board games'),
    ];
    for (const card of groupFavourites(rows)) {
      for (const row of card.items) {
        expect(favouriteLabelForItem(row)).toBe(card.label);
      }
    }
  });
});

// ───────────── Add your own ─────────────

describe('KAN-444: add-your-own — a group the member names', () => {
  test('a named group becomes a card carrying the member’s own words', () => {
    const cards = groupFavourites([item(CUSTOM_FAVOURITE_CATEGORY, 'Wingspan', 'Board games')]);
    expect(cards).toHaveLength(1);
    expect(cards[0].label).toBe('Board games');
    expect(cards[0].items.map((i) => i.title)).toEqual(['Wingspan']);
  });

  test('items sharing a name collect into one group, whatever the casing or spacing', () => {
    const cards = groupFavourites([
      item(CUSTOM_FAVOURITE_CATEGORY, 'Wingspan', 'Board games'),
      item(CUSTOM_FAVOURITE_CATEGORY, 'Azul', ' board games '),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].items.map((i) => i.title)).toEqual(['Wingspan', 'Azul']);
  });

  test('two different names stay two groups, in the order first used', () => {
    const cards = groupFavourites([
      item(CUSTOM_FAVOURITE_CATEGORY, 'Wingspan', 'Board games'),
      item(CUSTOM_FAVOURITE_CATEGORY, 'Sourdough', 'Baking'),
      item(CUSTOM_FAVOURITE_CATEGORY, 'Azul', 'Board games'),
    ]);
    expect(cards.map((c) => c.label)).toEqual(['Board games', 'Baking']);
    expect(cards[0].items.map((i) => i.title)).toEqual(['Wingspan', 'Azul']);
  });

  test('custom groups come after the five fixed ones', () => {
    const cards = groupFavourites([
      item(CUSTOM_FAVOURITE_CATEGORY, 'Wingspan', 'Board games'),
      item('favourite_books', 'Piranesi'),
    ]);
    expect(cards.map((c) => c.label)).toEqual(['Books', 'Board games']);
  });

  test('a missing or blank name still gets a heading, never an unlabelled card', () => {
    // A row written before the column existed reads back undefined.
    const cards = groupFavourites([
      item(CUSTOM_FAVOURITE_CATEGORY, 'Wingspan'),
      item(CUSTOM_FAVOURITE_CATEGORY, 'Azul', '   '),
      item(CUSTOM_FAVOURITE_CATEGORY, 'Carcassonne', null),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].label).toBe(CUSTOM_FAVOURITE_FALLBACK_LABEL);
    expect(cards[0].label.trim()).not.toBe('');
    expect(cards[0].items).toHaveLength(3);
  });

  test('"Add your own" is offered last in the editor, after the five groups', () => {
    const values = FAVOURITE_CATEGORY_OPTIONS.map((o) => o.value);
    expect(values[values.length - 1]).toBe(CUSTOM_FAVOURITE_CATEGORY);
    expect(FAVOURITE_CATEGORY_OPTIONS[FAVOURITE_CATEGORY_OPTIONS.length - 1].label).toBe('Add your own');
  });
});

// ───────────── Both surfaces are wired to the shared module ─────────────

describe('KAN-444: both surfaces render from the shared grouping', () => {
  test('the public profile groups via groupFavourites and keeps no list of its own', () => {
    const page = readSource(SRC.slugPage);
    expect(page).toContain("from '@/modules/profile/favourites'");
    expect(page).toContain('groupFavourites(typedItems)');
    // The old per-surface table is gone; if a future change re-hardcodes the
    // categories here, the two surfaces can drift again.
    expect(page).not.toContain('FAV_DEFS');
    expect(page).not.toContain("'favourite_books'");
    expect(page).not.toContain("'favourite_music'");
  });

  test('the editor favourites section takes its categories and picker from the module', () => {
    const editor = readSource(SRC.editProfileForm);
    expect(editor).toContain('@/modules/profile/favourites');
    expect(editor).toMatch(/id:\s*'favourites'[\s\S]{0,500}?categories:\s*FAVOURITE_CATEGORIES/);
    expect(editor).toMatch(/categoryOptions:\s*FAVOURITE_CATEGORY_OPTIONS/);
    expect(editor).toMatch(/groupLabelCategory:\s*CUSTOM_FAVOURITE_CATEGORY/);
  });

  test('ItemsStep hands the member’s group name to onAdd', () => {
    const step = readSource(SRC.itemsStep);
    expect(step).toMatch(/needsGroupLabel\s*\?\s*\{\s*groupLabel:\s*groupLabel\.trim\(\)\s*\}/);
    // And will not let them create an unnamed group.
    expect(step).toMatch(/canAdd\s*=[\s\S]{0,120}groupLabel\.trim\(\)\s*!==\s*''/);
  });
});
