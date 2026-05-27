/**
 * KAN-88 consent-screen safety net — tests that the prominent
 * account banner + switch-account flow are wired correctly.
 *
 * Background (2026-05-18): a user with multiple Supabase accounts
 * granted Claude access from the wrong one because the original
 * "Signed in as …" text was dim grey and easy to miss. claude.ai
 * then queried that wrong account's Convene data. Fix: yellow
 * banner with bold email + a Switch account button that
 * preserves the OAuth state through a re-login.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');

describe('Account banner on /oauth/authorize page (KAN-88)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/app/oauth/authorize/page.tsx'), 'utf8');

  test("the prominent 'granting access as <email>' line exists", () => {
    expect(src).toMatch(/You will be granting access as/);
  });

  test('email is displayed in bold inside the banner', () => {
    expect(src).toMatch(/<strong[^>]*>\{user!?\.email\}<\/strong>/);
  });

  test('banner has a high-contrast yellow background (not dim grey)', () => {
    expect(src).toMatch(/background:\s*['"]#fef9e7['"]/);
    expect(src).toMatch(/border:\s*['"]1px solid #f0d97d['"]/);
  });

  test('Switch account button is rendered inline', () => {
    expect(src).toMatch(/Switch account/);
  });

  test('Switch account button is wired to switchAccountAndContinue', () => {
    expect(src).toMatch(/switchAccountAndContinue\(authorizePathWithQuery\)/);
  });

  test('current authorize URL is rebuilt with all params for the preserved next', () => {
    expect(src).toMatch(/currentAuthorizeUrl\.searchParams\.set\(['"]client_id['"]/);
    expect(src).toMatch(/currentAuthorizeUrl\.searchParams\.set\(['"]redirect_uri['"]/);
    expect(src).toMatch(/currentAuthorizeUrl\.searchParams\.set\(['"]code_challenge['"]/);
    expect(src).toMatch(/currentAuthorizeUrl\.searchParams\.set\(['"]code_challenge_method['"]/);
  });

  test('imports switchAccountAndContinue from ./actions', () => {
    expect(src).toMatch(/import\s+\{[^}]*switchAccountAndContinue[^}]*\}\s+from\s+['"]\.\/actions['"]/);
  });
});

describe('switchAccountAndContinue server action (KAN-88)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/app/oauth/authorize/actions.ts'), 'utf8');

  test('is an exported async function (use-server safe)', () => {
    expect(src).toMatch(/export async function switchAccountAndContinue/);
  });

  test('signs out the Supabase session', () => {
    expect(src).toMatch(/sb\.auth\.signOut\(\)/);
  });

  test('redirects to /login with the authorize URL as ?next=…', () => {
    expect(src).toMatch(/`\/login\?next=\$\{encodeURIComponent\(safeNext\)\}`/);
  });

  test('open-redirect guarded: only /oauth/authorize? targets accepted', () => {
    expect(src).toMatch(/authorizePathWithQuery\.startsWith\(['"]\/oauth\/authorize\?['"]\)/);
  });
});
