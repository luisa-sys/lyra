/**
 * Profile Wizard unit tests
 * KAN-5: Profile Wizard (Web App)
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

describe('Profile Wizard', () => {
  test('wizard page exists', () => {
    expect(fs.existsSync(path.join(root, 'src/app/dashboard/profile/page.tsx'))).toBe(true);
  });

  test('wizard client component exists', () => {
    expect(fs.existsSync(path.join(root, 'src/app/dashboard/profile/wizard.tsx'))).toBe(true);
  });

  test('wizard has all 8 steps defined', () => {
    const content = fs.readFileSync(path.join(root, 'src/app/dashboard/profile/wizard.tsx'), 'utf8');
    expect(content).toContain("id: 'identity'");
    expect(content).toContain("id: 'school'");
    expect(content).toContain("id: 'bio'");
    expect(content).toContain("id: 'likes'");
    expect(content).toContain("id: 'gifts'");
    expect(content).toContain("id: 'boundaries'");
    expect(content).toContain("id: 'links'");
    expect(content).toContain("id: 'preview'");
  });

  test('profile actions file exists with all CRUD operations', () => {
    const content = fs.readFileSync(path.join(root, 'src/app/dashboard/profile/actions.ts'), 'utf8');
    expect(content).toContain('export async function updateProfileFields');
    expect(content).toContain('export async function addProfileItem');
    expect(content).toContain('export async function removeProfileItem');
    expect(content).toContain('export async function addSchoolAffiliation');
    expect(content).toContain('export async function addExternalLink');
    expect(content).toContain('export async function publishProfile');
  });

  test('dashboard links to profile wizard', () => {
    const content = fs.readFileSync(path.join(root, 'src/app/dashboard/page.tsx'), 'utf8');
    expect(content).toContain('/dashboard/profile');
  });
});
