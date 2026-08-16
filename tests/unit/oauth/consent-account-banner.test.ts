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
import { SRC } from '../../support/source-paths';

const ROOT = path.join(__dirname, '..', '..', '..');

describe('Account banner on /oauth/authorize page (KAN-88)', () => {
  const src = fs.readFileSync(path.join(ROOT, SRC.authorizePage), 'utf8');

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

  test('the preserved next is built by the shared builder, not a fourth copy', () => {
    // KAN-415 D7 part 3. This previously asserted four literal
    // `currentAuthorizeUrl.searchParams.set('…')` lines. The page built that URL
    // twice and the action a third time — three hand-written copies of a FROZEN
    // contract — so the builder was extracted and all three now call it.
    //
    // The four scans could not survive that and could not have caught the
    // divergence either: each only proved a substring was present, and all four
    // pass just as happily against a comment. What replaces them is stronger,
    // not weaker — `tests/unit/oauth/consent-flow.test.ts` pins the emitted
    // path VERBATIM including parameter order, asserts state is omitted rather
    // than emitted empty, and asserts the page's field shape and the action's
    // produce byte-identical output. Mutation-proven: reordering two params
    // reddens it. All this file still needs to prove is that the page has not
    // grown a fourth copy.
    expect(src).toMatch(/buildAuthorizePath\(/);
    expect(src).toMatch(
      /import\s+\{[^}]*buildAuthorizePath[^}]*\}\s+from\s+['"]@\/modules\/oauth-as\/consent-flow['"]/
    );
    expect(src).not.toMatch(/searchParams\.set\(['"]code_challenge['"]/);
  });

  test('imports switchAccountAndContinue from ./actions', () => {
    expect(src).toMatch(/import\s+\{[^}]*switchAccountAndContinue[^}]*\}\s+from\s+['"]\.\/actions['"]/);
  });
});

describe('switchAccountAndContinue server action (KAN-88)', () => {
  // KAN-415 D7 part 3 split this in two: the `'use server'` action the form
  // binds to still lives in actions.ts, and the body moved to the oauth-as
  // module where it can be executed by a test instead of read as text.
  const actionSrc = fs.readFileSync(path.join(ROOT, SRC.authorizeActions), 'utf8');
  const flowSrc = fs.readFileSync(path.join(ROOT, SRC.consentFlow), 'utf8');

  test('is an exported async function (use-server safe)', () => {
    // Still the action's own property, and still worth asserting on the action
    // file: a 'use server' file that exports a non-async member is rejected at
    // action-INVOCATION time, so it ships green and 500s the first submission.
    expect(actionSrc).toMatch(/export async function switchAccountAndContinue/);
  });

  test('the action delegates rather than reimplementing', () => {
    expect(actionSrc).toMatch(/@\/modules\/oauth-as\/consent-flow/);
    expect(actionSrc).not.toMatch(/auth\.signOut\(\)/);
  });

  test('signs out the Supabase session', () => {
    expect(flowSrc).toMatch(/sb\.auth\.signOut\(\)/);
  });

  test('redirects to /login with the authorize URL as ?next=…', () => {
    expect(flowSrc).toMatch(/`\/login\?next=\$\{encodeURIComponent\(safeNext\)\}`/);
  });

  test('open-redirect guarded: only /oauth/authorize? targets accepted', () => {
    expect(flowSrc).toMatch(/authorizePathWithQuery\.startsWith\(['"]\/oauth\/authorize\?['"]\)/);
  });
});
