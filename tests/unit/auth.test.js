/**
 * Auth system unit tests
 * KAN-7: Authentication & User Management
 */

describe('Auth pages', () => {
  test('signup page file exists', () => {
    const fs = require('fs');
    const path = require('path');
    const signupPath = path.join(__dirname, '../../src/app/(auth)/signup/page.tsx');
    expect(fs.existsSync(signupPath)).toBe(true);
  });

  test('login page file exists', () => {
    const fs = require('fs');
    const path = require('path');
    const loginPath = path.join(__dirname, '../../src/app/(auth)/login/page.tsx');
    expect(fs.existsSync(loginPath)).toBe(true);
  });

  test('auth callback route exists', () => {
    const fs = require('fs');
    const path = require('path');
    const callbackPath = path.join(__dirname, '../../src/app/auth/callback/route.ts');
    expect(fs.existsSync(callbackPath)).toBe(true);
  });

  test('dashboard page exists', () => {
    const fs = require('fs');
    const path = require('path');
    const dashboardPath = path.join(__dirname, '../../src/app/dashboard/page.tsx');
    expect(fs.existsSync(dashboardPath)).toBe(true);
  });

  test('middleware exists and handles auth routes', () => {
    const fs = require('fs');
    const path = require('path');
    const middlewarePath = path.join(__dirname, '../../src/middleware.ts');
    expect(fs.existsSync(middlewarePath)).toBe(true);
    const content = fs.readFileSync(middlewarePath, 'utf8');
    expect(content).toContain('/dashboard');
    expect(content).toContain('/login');
    expect(content).toContain('auth.getUser');
  });

  test('server actions file exists with signUp, signIn, signOut', () => {
    const fs = require('fs');
    const path = require('path');
    const actionsPath = path.join(__dirname, '../../src/app/(auth)/actions.ts');
    expect(fs.existsSync(actionsPath)).toBe(true);
    const content = fs.readFileSync(actionsPath, 'utf8');
    expect(content).toContain('export async function signUp');
    expect(content).toContain('export async function signIn');
    expect(content).toContain('export async function signOut');
  });
});
