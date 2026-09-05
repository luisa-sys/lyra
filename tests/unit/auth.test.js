/**
 * Auth system unit tests
 * KAN-7: Authentication & User Management
 * KAN-130: Apple Sign-In commented out
 */

const fs = require('fs');
const path = require('path');
const { SRC } = require('../support/source-paths.json');

const root = path.join(__dirname, '../..');

describe('Auth pages', () => {
  test('signup page file exists', () => {
    expect(fs.existsSync(path.join(root, SRC.signupPage))).toBe(true);
  });

  test('login page file exists', () => {
    expect(fs.existsSync(path.join(root, SRC.loginPage))).toBe(true);
  });

  test('auth callback route exists', () => {
    expect(fs.existsSync(path.join(root, SRC.authCallbackRoute))).toBe(true);
  });

  test('dashboard page exists', () => {
    expect(fs.existsSync(path.join(root, SRC.dashboardPage))).toBe(true);
  });

  test('middleware exists', () => {
    // REPOINTED, KAN-415 D4 C5 (approved 2026-08-09).
    //
    // This block used to read src/middleware.ts as SOURCE TEXT and assert it
    // contained the strings '/dashboard', '/login' and 'auth.getUser'. All
    // three moved: the session refresh into src/modules/access/session.ts, the
    // two paths into the gates and the exemption table.
    //
    // Replacing them with behavioural assertions is a STRENGTHENING, and the
    // repo already knew the old form was weak: BOTH '/dashboard' and '/login'
    // are recorded in tests/support/comment-assertion-baseline.json as
    // COMMENT-SHADOWED — satisfiable by a header comment alone, with the code
    // deleted. A toContain on source text cannot tell "the middleware redirects
    // anonymous users to /login" from "someone mentioned /login in a comment".
    //
    // The behaviour those three strings were standing in for is now asserted
    // properly, through the real middleware, in:
    //   tests/unit/middleware-gate-order.test.ts       (the redirects, and their ORDER)
    //   tests/unit/middleware-response-contract.test.ts (getUser's cookie refresh
    //                                                    actually reaching the response)
    // Both are mutation-proven; the source-text form never was.
    expect(fs.existsSync(path.join(root, SRC.middleware))).toBe(true);
  });

  test('server actions file exists with signUp, signIn', () => {
    const actionsPath = path.join(root, SRC.actions);
    expect(fs.existsSync(actionsPath)).toBe(true);
    const content = fs.readFileSync(actionsPath, 'utf8');
    expect(content).toContain('export async function signUp');
    expect(content).toContain('export async function signIn');
  });

  test('signOut is a server action at the app root, not inside a route segment', () => {
    // KAN-415 moved it out of (auth)/actions.ts: /dashboard imported it across
    // route segments, which was the last `no-cross-segment-app` violation.
    //
    // Asserted at its new home rather than deleted, and the `'use server'`
    // check is the load-bearing half — the qa-sweep destructive denylist keys
    // on an INVENTORIED action, and inventory.py inventories only `'use
    // server'` functions. Lose that directive and the sign-out hazard silently
    // leaves the safety envelope while this file still says signOut exists.
    const sessionActionsPath = path.join(root, SRC.sessionActions);
    expect(fs.existsSync(sessionActionsPath)).toBe(true);
    const content = fs.readFileSync(sessionActionsPath, 'utf8');
    expect(content).toContain("'use server'");
    expect(content).toContain('export async function signOut');
  });
});

describe('KAN-130: Apple Sign-In commented out', () => {
  test('social-login-buttons does not import signInWithApple as active import', () => {
    const filePath = path.join(root, SRC.socialLoginButtons);
    const content = fs.readFileSync(filePath, 'utf8');
    // signInWithApple should only appear inside a comment, not as an active import
    const lines = content.split('\n');
    const activeImportLines = lines.filter(
      line => line.includes('signInWithApple') && !line.trimStart().startsWith('//')
    );
    // The only active references to signInWithApple should be inside JSX comments {/* ... */}
    const nonCommentRefs = activeImportLines.filter(
      line => !line.includes('{/*') && !line.includes('*/}') && !line.includes('formAction={signInWithApple}')
    );
    expect(nonCommentRefs).toHaveLength(0);
  });

  test('social-login-buttons still exports SocialLoginButtons with Google', () => {
    const filePath = path.join(root, SRC.socialLoginButtons);
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('export function SocialLoginButtons');
    expect(content).toContain('signInWithGoogle');
    expect(content).toContain('Continue with Google');
  });

  test('actions.ts has signInWithApple commented out with KAN-37 reference', () => {
    const actionsPath = path.join(root, SRC.actions);
    const content = fs.readFileSync(actionsPath, 'utf8');
    // signInWithApple should be commented out
    expect(content).not.toMatch(/^export async function signInWithApple/m);
    // But the commented version should still exist for easy restoration
    expect(content).toContain('// export async function signInWithApple');
    // Should reference KAN-37
    expect(content).toContain('KAN-37');
  });

  test('Google signInWithGoogle is still exported and active', () => {
    const actionsPath = path.join(root, SRC.actions);
    const content = fs.readFileSync(actionsPath, 'utf8');
    expect(content).toMatch(/^export async function signInWithGoogle/m);
  });
});
