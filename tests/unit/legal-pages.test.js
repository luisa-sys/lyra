/**
 * Privacy policy and terms of service page tests
 * KAN-126: Create live privacy policy and terms of service pages
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

describe('KAN-126: Privacy policy page', () => {
  const filePath = path.join(root, 'src/app/privacy/page.tsx');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(filePath, 'utf8');
  });

  test('page file exists', () => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('exports metadata with title', () => {
    expect(content).toContain('Privacy Policy');
    expect(content).toContain('metadata');
  });

  test('covers data collection', () => {
    expect(content).toContain('What data we collect');
    expect(content).toContain('email address');
    expect(content).toContain('Profile data');
  });

  test('covers MCP/AI access to profiles', () => {
    expect(content).toContain('MCP');
    expect(content).toContain('AI assistant');
  });

  test('covers data storage location', () => {
    expect(content).toContain('Supabase');
    expect(content).toContain('EU');
  });

  test('covers UK GDPR rights', () => {
    expect(content).toContain('UK GDPR');
    expect(content).toContain('Access');
    expect(content).toContain('Erasure');
    expect(content).toContain('Portability');
  });

  test('covers cookies', () => {
    expect(content).toContain('Cookies');
    expect(content).toContain('essential cookies');
  });

  test('covers children policy', () => {
    expect(content).toContain('under 13');
  });

  test('provides contact email', () => {
    expect(content).toContain('privacy@checklyra.com');
  });

  test('references ICO for complaints', () => {
    expect(content).toContain('ico.org.uk');
  });

  test('has solicitor review notice', () => {
    expect(content).toContain('solicitor');
  });
});

describe('KAN-126: Terms of service page', () => {
  const filePath = path.join(root, 'src/app/terms/page.tsx');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(filePath, 'utf8');
  });

  test('page file exists', () => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('exports metadata with title', () => {
    expect(content).toContain('Terms of Service');
    expect(content).toContain('metadata');
  });

  test('covers profile visibility and MCP access', () => {
    expect(content).toContain('MCP');
    expect(content).toContain('AI assistant');
    expect(content).toContain('publish');
  });

  test('covers acceptable use', () => {
    expect(content).toContain('Acceptable use');
    expect(content).toContain('Impersonate');
  });

  test('covers content ownership', () => {
    expect(content).toContain('You own the content');
    expect(content).toContain('licence');
  });

  test('covers account deletion', () => {
    expect(content).toContain('delete your account');
  });

  test('covers limitation of liability', () => {
    expect(content).toContain('Limitation of liability');
  });

  test('governed by English law', () => {
    expect(content).toContain('England and Wales');
  });

  test('has solicitor review notice', () => {
    expect(content).toContain('solicitor');
  });

  test('provides contact email', () => {
    expect(content).toContain('support@checklyra.com');
  });
});

describe('KAN-126: Footer links exist on homepage', () => {
  const filePath = path.join(root, 'src/app/page.tsx');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(filePath, 'utf8');
  });

  test('homepage footer links to /privacy', () => {
    expect(content).toContain('href="/privacy"');
  });

  test('homepage footer links to /terms', () => {
    expect(content).toContain('href="/terms"');
  });
});
