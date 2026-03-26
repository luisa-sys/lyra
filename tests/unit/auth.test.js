/**
 * Auth system unit tests
 * KAN-7: Authentication & User Management
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
