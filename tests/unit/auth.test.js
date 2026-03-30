/**
 * Auth system unit tests
 * KAN-7: Authentication & User Management
 * KAN-130: Apple Sign-In commented out
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

describe('Auth pages', () => {
  test('signup page file exists', () => {
    expect(fs.existsSync(path.join(root, 'src/app/(auth)/signup/page.tsx'))).toBe(true);
  });

  test('login page file exists', () => {
    expect(fs.existsSync(path.join(root, 'src/app/(auth)/login/page.tsx'))).toBe(true);
  });

  test('auth callback route exists', () => {
    expect(fs.existsSync(path.join(root, 'src/app/auth/callback/route.ts'))).toBe(true);
  });

  test('dashboard page exists', () => {
    expect(fs.existsSync(path.join(root, 'src/app/dashboard/page.tsx'))).toBe(true);
  });

  test('middleware exists and handles auth routes', () => {
    const middlewarePath = path.join(root, 'src/middleware.ts');
    expect(fs.existsSync(middlewarePath)).toBe(true);
    const content = fs.readFileSync(middlewarePath, 'utf8');
    expect(content).toContain('/dashboard');
    expect(content).toContain('/login');
    expect(content).toContain('auth.getUser');
  });

  test('server actions file exists with signUp, signIn, signOut', () => {
    const actionsPath = path.join(root, 'src/app/(auth)/actions.ts');
    expect(fs.existsSync(actionsPath)).toBe(true);
    const content = fs.readFileSync(actionsPath, 'utf8');
    expect(content).toContain('export async function signUp');
    expect(content).toContain('export async function signIn');
    expect(content).toContain('export async function signOut');
  });
});

describe('KAN-130: Apple Sign-In commented out', () => {
  test('social-login-buttons does not import signInWithApple as active import', () => {
    const filePath = path.join(root, 'src/app/(auth)/social-login-buttons.tsx');
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
    const filePath = path.join(root, 'src/app/(auth)/social-login-buttons.tsx');
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('export function SocialLoginButtons');
    expect(content).toContain('signInWithGoogle');
    expect(content).toContain('Continue with Google');
  });

  test('actions.ts has signInWithApple commented out with KAN-37 reference', () => {
    const actionsPath = path.join(root, 'src/app/(auth)/actions.ts');
    const content = fs.readFileSync(actionsPath, 'utf8');
    // signInWithApple should be commented out
    expect(content).not.toMatch(/^export async function signInWithApple/m);
    // But the commented version should still exist for easy restoration
    expect(content).toContain('// export async function signInWithApple');
    // Should reference KAN-37
    expect(content).toContain('KAN-37');
  });

  test('Google signInWithGoogle is still exported and active', () => {
    const actionsPath = path.join(root, 'src/app/(auth)/actions.ts');
    const content = fs.readFileSync(actionsPath, 'utf8');
    expect(content).toMatch(/^export async function signInWithGoogle/m);
  });
});
