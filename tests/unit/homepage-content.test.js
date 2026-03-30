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

  test('contains ParentCallout component', () => {
    expect(content).toContain('function ParentCallout');
    expect(content).toContain('<ParentCallout');
  });

  test('ParentCallout references teacher/parent use case', () => {
    expect(content).toContain('End of term');
    expect(content).toContain('teachers');
  });

  test('all original sections still present', () => {
    expect(content).toContain('function Hero');
    expect(content).toContain('function ProfilePreview');
    expect(content).toContain('function HowItWorks');
    expect(content).toContain('function Sections');
    expect(content).toContain('function CTA');
    expect(content).toContain('function Footer');
  });

  test('components render in correct order', () => {
    const heroPos = content.indexOf('<Hero');
    const profilePos = content.indexOf('<ProfilePreview');
    const howPos = content.indexOf('<HowItWorks');
    const sectionsPos = content.indexOf('<Sections');
    const useCasesPos = content.indexOf('<UseCases');
    const whatNotPos = content.indexOf('<WhatLyraIsNot');
    const parentPos = content.indexOf('<ParentCallout');
    const ctaPos = content.indexOf('<CTA');

    expect(heroPos).toBeLessThan(profilePos);
    expect(profilePos).toBeLessThan(howPos);
    expect(howPos).toBeLessThan(sectionsPos);
    expect(sectionsPos).toBeLessThan(useCasesPos);
    expect(useCasesPos).toBeLessThan(whatNotPos);
    expect(whatNotPos).toBeLessThan(parentPos);
    expect(parentPos).toBeLessThan(ctaPos);
  });
});
