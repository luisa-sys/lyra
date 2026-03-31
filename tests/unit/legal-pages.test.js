/**
 * Privacy policy and terms of service page tests
 * KAN-126: Create live privacy policy and terms of service pages
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

describe('KAN-126: Privacy policy page', () => {
  const filePath = path.join(root, 'src/app/(legal)/privacy/page.tsx');
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
    expect(content).toContain('Email address');
    expect(content).toContain('Profile data');
    expect(content).toContain('profile photo');
  });

  test('covers MCP/AI access to profiles', () => {
    expect(content).toContain('MCP');
    expect(content).toContain('AI companion');
  });

  test('covers data storage location', () => {
    expect(content).toContain('Supabase');
    expect(content).toContain('EU');
    expect(content).toContain('R2');
  });

  test('covers UK GDPR rights', () => {
    expect(content).toContain('GDPR');
    expect(content).toContain('Access');
    expect(content).toContain('Erasure');
    expect(content).toContain('portability');
  });

  test('covers cookies', () => {
    expect(content).toContain('Cookies');
    expect(content).toContain('authentication');
  });

  test('covers children policy', () => {
    expect(content).toContain('13');
  });

  test('provides contact email', () => {
    expect(content).toContain('privacy@checklyra.com');
  });

  test('references ICO for complaints', () => {
    expect(content).toContain('ico.org.uk');
  });
});

describe('KAN-126: Terms of service page', () => {
  const filePath = path.join(root, 'src/app/(legal)/terms/page.tsx');
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
    expect(content).toContain('AI companion');
    expect(content).toContain('publish');
  });

  test('covers acceptable use', () => {
    expect(content).toContain('harmful');
    expect(content).toContain('illegal');
  });

  test('covers content ownership', () => {
    expect(content).toContain('You own');
    expect(content).toContain('licence');
  });

  test('covers account deletion', () => {
    expect(content).toContain('delete your account');
  });

  test('covers limitation of liability', () => {
    expect(content).toContain('liability');
  });

  test('governed by English law', () => {
    expect(content).toContain('England and Wales');
  });

  test('provides contact info', () => {
    expect(content).toContain('checklyra.com');
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

  test('homepage footer links to /cookies', () => {
    expect(content).toContain('href="/cookies"');
  });
});

describe('KAN-144: Cookie policy page', () => {
  const filePath = path.join(root, 'src/app/(legal)/cookies/page.tsx');
  let content;

  beforeAll(() => {
    content = fs.readFileSync(filePath, 'utf8');
  });

  test('page file exists', () => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('exports metadata with title', () => {
    expect(content).toContain('Cookie Policy');
    expect(content).toContain('metadata');
  });

  test('explains what cookies are', () => {
    expect(content).toContain('What are cookies');
  });

  test('lists specific cookies used', () => {
    expect(content).toContain('sb-');
    expect(content).toContain('auth-token');
    expect(content).toContain('Essential');
  });

  test('mentions third-party cookies (Google, Cloudflare)', () => {
    expect(content).toContain('Google');
    expect(content).toContain('Cloudflare');
  });

  test('explains how to manage cookies', () => {
    expect(content).toContain('Managing cookies');
    expect(content).toContain('browser settings');
  });

  test('commits to no advertising cookies', () => {
    expect(content).toContain('advertising');
    expect(content).toContain('tracking');
  });

  test('provides contact email', () => {
    expect(content).toContain('privacy@checklyra.com');
  });

  test('links to privacy policy and terms', () => {
    expect(content).toContain('href="/privacy"');
    expect(content).toContain('href="/terms"');
  });
});
