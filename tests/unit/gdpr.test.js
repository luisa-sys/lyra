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
    // KAN-407: the form markup moved from page.tsx into the signup-form.tsx
    // client component so one 18+ tick could gate both the email and Google
    // paths. Same assertions, new file.
    const content = fs.readFileSync(
      path.join(root, 'src/app/(auth)/signup/signup-form.tsx'),
      'utf8',
    );
    expect(content).toContain('consent');
    expect(content).toContain('Privacy Policy');
    expect(content).toContain('Terms of Service');
  });

  test('signup form requires an explicit 18+ declaration on BOTH auth paths', () => {
    // KAN-407: Lyra is 18+. The tick must gate the Google button too — gating
    // only the email form would leave OAuth as an undeclared signup route.
    const content = fs.readFileSync(
      path.join(root, 'src/app/(auth)/signup/signup-form.tsx'),
      'utf8',
    );
    expect(content).toContain('18 or over');
    expect(content).toContain('AGE_DECLARATION_FIELD');
    // Both submit buttons disabled until confirmed.
    expect(content.match(/disabled=\{!ageConfirmed\}/g) || []).toHaveLength(2);
  });

  test('site-wide footer includes privacy and terms links', () => {
    // KAN-272: the legal footer links moved off page.tsx into the shared
    // <Footer/> rendered in the root layout, so they appear on every page.
    const content = fs.readFileSync(path.join(root, 'src/app/footer.tsx'), 'utf8');
    expect(content).toContain('/privacy');
    expect(content).toContain('/terms');
  });

  test('dashboard includes settings link', () => {
    const content = fs.readFileSync(path.join(root, 'src/app/dashboard/page.tsx'), 'utf8');
    expect(content).toContain('/dashboard/settings');
  });
});
