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

  test('wizard has 11 steps (up from 8)', () => {
    const stepMatches = wizardContent.match(/\{ id: '/g);
    expect(stepMatches).not.toBeNull();
    expect(stepMatches.length).toBe(11);
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

describe('KAN-137: Public profile page renders new categories', () => {
  const profilePath = path.join(root, 'src/app/[slug]/page.tsx');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(profilePath, 'utf8');
  });

  test.each(NEW_CATEGORIES)('profile page has label for category: %s', (cat) => {
    expect(content).toContain(`${cat}:`);
  });

  test.each(NEW_CATEGORIES)('profile page has icon for category: %s', (cat) => {
    // Check it exists in categoryIcons
    const iconSection = content.slice(
      content.indexOf('const categoryIcons'),
      content.indexOf('};', content.indexOf('const categoryIcons')) + 2
    );
    expect(iconSection).toContain(`${cat}:`);
  });

  test('categoryOrder includes new standard categories', () => {
    expect(content).toContain("'favourite_books'");
    expect(content).toContain("'favourite_media'");
    expect(content).toContain("'causes'");
    expect(content).toContain("'proud_of'");
    expect(content).toContain("'life_hacks'");
    expect(content).toContain("'questions'");
  });

  test('questions category has special Q&A rendering', () => {
    expect(content).toContain("cat === 'questions'");
    expect(content).toContain('border-l-3');
  });

  test('quotes have special styled rendering', () => {
    expect(content).toContain("groupedItems['quotes']");
    expect(content).toContain('italic');
  });

  test('billboard has special large-quote rendering', () => {
    expect(content).toContain("groupedItems['billboard']");
    expect(content).toContain('giant billboard');
  });

  test('billboard renders with sage green background', () => {
    // Find the billboard section and check it uses sage bg
    const billboardSection = content.slice(
      content.indexOf("groupedItems['billboard']"),
      content.indexOf("Links */")
    );
    expect(billboardSection).toContain('bg-[var(--color-sage)]');
  });
});
