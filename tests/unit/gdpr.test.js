/**
 * GDPR Compliance unit tests
 * KAN-33: GDPR Compliance & Data Protection
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

describe('GDPR Compliance', () => {
  test('privacy policy page exists', () => {
    expect(fs.existsSync(path.join(root, 'src/app/(legal)/privacy/page.tsx'))).toBe(true);
  });

  test('terms of service page exists', () => {
    expect(fs.existsSync(path.join(root, 'src/app/(legal)/terms/page.tsx'))).toBe(true);
  });

  test('privacy policy covers required GDPR sections', () => {
    const content = fs.readFileSync(path.join(root, 'src/app/(legal)/privacy/page.tsx'), 'utf8');
    expect(content).toContain('What data we collect');
    expect(content).toContain('Your rights');
    expect(content).toContain('Data retention');
    expect(content).toContain('Cookies');
    expect(content).toContain('ico.org.uk');
  });

  test('cookie consent component exists', () => {
    expect(fs.existsSync(path.join(root, 'src/app/cookie-consent.tsx'))).toBe(true);
    const content = fs.readFileSync(path.join(root, 'src/app/cookie-consent.tsx'), 'utf8');
    expect(content).toContain('Essential only');
    expect(content).toContain('Accept all');
    expect(content).toContain('lyra-cookie-consent');
  });

  test('cookie consent is included in root layout', () => {
    const content = fs.readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
    expect(content).toContain('CookieConsent');
  });

  test('account settings page exists with data export and deletion', () => {
    expect(fs.existsSync(path.join(root, 'src/app/dashboard/settings/page.tsx'))).toBe(true);
    const actions = fs.readFileSync(path.join(root, 'src/app/dashboard/settings/actions.ts'), 'utf8');
    expect(actions).toContain('exportUserData');
    expect(actions).toContain('deleteAccount');
  });

  test('signup form includes consent checkbox', () => {
    const content = fs.readFileSync(path.join(root, 'src/app/(auth)/signup/page.tsx'), 'utf8');
    expect(content).toContain('consent');
    expect(content).toContain('Privacy Policy');
    expect(content).toContain('Terms of Service');
  });

  test('landing page footer includes privacy and terms links', () => {
    const content = fs.readFileSync(path.join(root, 'src/app/page.tsx'), 'utf8');
    expect(content).toContain('href="/privacy"');
    expect(content).toContain('href="/terms"');
  });

  test('dashboard includes settings link', () => {
    const content = fs.readFileSync(path.join(root, 'src/app/dashboard/page.tsx'), 'utf8');
    expect(content).toContain('/dashboard/settings');
  });
});
