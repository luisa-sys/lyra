/**
 * Homepage content tests
 * KAN-138: Restore missing homepage content from original Python site
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const homepagePath = path.join(root, 'src/app/page.tsx');

describe('KAN-138: Homepage content restoration', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(homepagePath, 'utf8');
  });

  test('homepage file exists', () => {
    expect(fs.existsSync(homepagePath)).toBe(true);
  });

  test('contains UseCases component', () => {
    expect(content).toContain('function UseCases');
    expect(content).toContain('<UseCases');
  });

  test('UseCases includes all four audience segments', () => {
    expect(content).toContain('Parents');
    expect(content).toContain('Friends');
    expect(content).toContain('Colleagues');
    expect(content).toContain('Teachers');
  });

  test('contains WhatLyraIsNot component', () => {
    expect(content).toContain('function WhatLyraIsNot');
    expect(content).toContain('<WhatLyraIsNot');
  });

  test('WhatLyraIsNot includes key differentiators', () => {
    expect(content).toContain('followers');
    expect(content).toContain('algorithms');
    expect(content).toContain('notifications');
  });

  test('contains ParentTeacherCallout component (KAN-158)', () => {
    // KAN-158 split the single ParentCallout into a side-by-side
    // ParentTeacherCallout that addresses both audiences.
    expect(content).toContain('function ParentTeacherCallout');
    expect(content).toContain('<ParentTeacherCallout');
  });

  test('ParentTeacherCallout references both audiences with KAN-156 copy', () => {
    expect(content).toContain('Are you a parent?');
    expect(content).toContain('Are you a teacher?');
    // KAN-156: "End of term" → "End of year"
    expect(content).toContain('End of year');
    expect(content).toContain('teachers');
  });

  test('contains AboutLyra section (KAN-157)', () => {
    expect(content).toContain('function AboutLyra');
    expect(content).toContain('<AboutLyra');
    // Mission statement signal
    expect(content).toContain('real life');
  });

  test('AboutLyra lists at least 5 use cases (KAN-157 acceptance)', () => {
    const aboutMatch = content.match(/function AboutLyra[\s\S]*?const useCases = \[([\s\S]*?)\]/);
    expect(aboutMatch).not.toBeNull();
    const items = (aboutMatch?.[1] ?? '').match(/"[^"]+"/g) || [];
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  test('contains WishKnowFindFirstHand sections (KAN-159)', () => {
    expect(content).toContain('function WishKnowFindFirstHand');
    expect(content).toContain('<WishKnowFindFirstHand');
    expect(content).toContain('Wish people just knew?');
    expect(content).toContain('Want to find information first hand?');
  });

  test('WhatLyraIsNot includes the new KAN-156 anti-social items', () => {
    expect(content).toContain('No friend requests, direct or group messages');
    expect(content).toContain('No endless scrolling');
    expect(content).toContain('Only see what you want to see');
  });

  test('Hero copy no longer includes "calm" (KAN-156)', () => {
    const heroMatch = content.match(/function Hero\(\)[\s\S]*?<\/section>/);
    expect(heroMatch).not.toBeNull();
    expect(heroMatch[0]).not.toMatch(/\bcalm\b/);
  });

  test('all original sections still present', () => {
    expect(content).toContain('function Hero');
    expect(content).toContain('function ProfilePreview');
    expect(content).toContain('function HowItWorks');
    expect(content).toContain('function Sections');
    expect(content).toContain('function CTA');
    expect(content).toContain('function Footer');
  });

  test('components render in correct order (post KAN-156/157/158/159)', () => {
    // Hero → AboutLyra (new) → ProfilePreview → HowItWorks → Sections
    // → UseCases → WhatLyraIsNot → ParentTeacherCallout (replaces
    // ParentCallout) → WishKnowFindFirstHand (new) → CTA
    const heroPos = content.indexOf('<Hero');
    const aboutPos = content.indexOf('<AboutLyra');
    const profilePos = content.indexOf('<ProfilePreview');
    const howPos = content.indexOf('<HowItWorks');
    const sectionsPos = content.indexOf('<Sections');
    const useCasesPos = content.indexOf('<UseCases');
    const whatNotPos = content.indexOf('<WhatLyraIsNot');
    const parentTeacherPos = content.indexOf('<ParentTeacherCallout');
    const wishKnowPos = content.indexOf('<WishKnowFindFirstHand');
    const ctaPos = content.indexOf('<CTA');

    for (const [name, pos] of Object.entries({
      heroPos, aboutPos, profilePos, howPos, sectionsPos, useCasesPos,
      whatNotPos, parentTeacherPos, wishKnowPos, ctaPos,
    })) {
      expect(pos).toBeGreaterThan(-1);
      // Surface which slot is missing if any of the above fail.
      if (pos === -1) throw new Error(`Missing slot: ${name}`);
    }

    expect(heroPos).toBeLessThan(aboutPos);
    expect(aboutPos).toBeLessThan(profilePos);
    expect(profilePos).toBeLessThan(howPos);
    expect(howPos).toBeLessThan(sectionsPos);
    expect(sectionsPos).toBeLessThan(useCasesPos);
    expect(useCasesPos).toBeLessThan(whatNotPos);
    expect(whatNotPos).toBeLessThan(parentTeacherPos);
    expect(parentTeacherPos).toBeLessThan(wishKnowPos);
    expect(wishKnowPos).toBeLessThan(ctaPos);
  });
});
