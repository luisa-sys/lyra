/**
 * Missing profile sections tests
 * KAN-137: Restore missing profile section types from original Python/Flask app
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

const NEW_CATEGORIES = [
  'favourite_books', 'favourite_media', 'causes', 'quotes',
  'proud_of', 'life_hacks', 'questions', 'billboard',
];

describe('KAN-137: Wizard supports new section categories', () => {
  const wizardPath = path.join(root, 'src/app/dashboard/profile/wizard.tsx');
  let wizardContent;

  beforeAll(() => {
    wizardContent = fs.readFileSync(wizardPath, 'utf8');
  });

  test('wizard file exists', () => {
    expect(fs.existsSync(wizardPath)).toBe(true);
  });

  test('wizard has 14 steps (was 13; KAN-181 added Things to ask me)', () => {
    // KAN-154 took this from 11 → 12 (Manual of Me).
    // KAN-142 took it from 12 → 13 (Files & media).
    // KAN-181 took it from 13 → 14 (Things to ask me / conversation
    // starters). Each is a deliberate user-facing addition, not a
    // regression — update the assertion to match. If a future refactor
    // drops a step accidentally, this test catches it.
    const stepMatches = wizardContent.match(/\{ id: '/g);
    expect(stepMatches).not.toBeNull();
    expect(stepMatches.length).toBe(14);
  });

  test('wizard includes Files & media step (KAN-142)', () => {
    expect(wizardContent).toContain("'files'");
    expect(wizardContent).toContain('Files & media');
  });

  test('wizard includes Things to ask me step (KAN-181)', () => {
    expect(wizardContent).toContain("'starters'");
    expect(wizardContent).toContain('Things to ask me');
  });

  test('wizard includes Books & Media step', () => {
    expect(wizardContent).toContain("'favourite_books'");
    expect(wizardContent).toContain("'favourite_media'");
    expect(wizardContent).toContain('Books & Media');
  });

  test('wizard includes Causes & Quotes step', () => {
    expect(wizardContent).toContain("'causes'");
    expect(wizardContent).toContain("'quotes'");
    expect(wizardContent).toContain('Causes & Quotes');
  });

  test('wizard includes More about you step', () => {
    expect(wizardContent).toContain("'proud_of'");
    expect(wizardContent).toContain("'life_hacks'");
    expect(wizardContent).toContain("'questions'");
    expect(wizardContent).toContain("'billboard'");
    expect(wizardContent).toContain('More about you');
  });
});

describe('KAN-137: ItemsStep has labels for all categories', () => {
  const itemsStepPath = path.join(root, 'src/app/dashboard/profile/steps/items-step.tsx');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(itemsStepPath, 'utf8');
  });

  test.each(NEW_CATEGORIES)('itemsStep has label for category: %s', (cat) => {
    expect(content).toContain(`${cat}:`);
  });
});

describe('KAN-137 / KAN-265: Public profile renders all categories (redesign)', () => {
  // The June-2026 redesign (KAN-265) replaced the categoryLabels / categoryIcons /
  // categoryOrder maps with explicit, warmly-titled sections (white cards, a sage
  // left-rule on each heading, a favourites grid, a Q&A block). Every category is
  // still rendered — these guards prove each is referenced so a future refactor
  // can't silently drop one (which would make those items vanish from profiles).
  const profilePath = path.join(root, 'src/app/[slug]/page.tsx');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(profilePath, 'utf8');
  });

  test.each(NEW_CATEGORIES)('page renders category: %s', (cat) => {
    expect(content).toContain(`'${cat}'`);
  });

  test('favourites render in a dedicated favourites grid', () => {
    expect(content).toContain('A few of my favourite things');
    expect(content).toContain("['favourite_books'");
    expect(content).toContain("['favourite_media'");
    expect(content).toContain("['quotes'");
  });

  test('questions + conversation starters render as a Q&A section', () => {
    expect(content).toContain("groupedItems['questions']");
    expect(content).toContain('A few more things about me');
  });

  test('billboard has special large-quote rendering', () => {
    expect(content).toContain("groupedItems['billboard']");
    expect(content).toContain('giant billboard');
  });

  test('billboard renders with sage green background', () => {
    const billboardSection = content.slice(
      content.indexOf("groupedItems['billboard']"),
      content.indexOf('Links */')
    );
    expect(billboardSection).toContain('bg-[var(--color-sage)]');
  });

  test('section headings use the sage left-rule (border-l-[3px])', () => {
    expect(content).toContain('border-l-[3px]');
    expect(content).toContain('border-[var(--color-sage)]');
  });
});
