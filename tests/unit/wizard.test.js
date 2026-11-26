/**
 * Profile Wizard unit tests
 * KAN-5: Profile Wizard (Web App)
 *
 * KAN-487 part 3 (founder sign-off 2026-11-23, chat): the legacy wizard
 * (`wizard.tsx`, `/dashboard/profile/legacy`) is deleted, so the two tests
 * that pinned it — "wizard client component exists" and "wizard has all 8
 * steps defined" — are deleted with it. The three that describe live
 * behaviour (the profile route, the CRUD actions, the dashboard link) stay.
 */

const fs = require('fs');
const path = require('path');
const { SRC } = require('../support/source-paths.json');

const root = path.join(__dirname, '../..');

describe('Profile Wizard', () => {
  test('wizard page exists', () => {
    expect(fs.existsSync(path.join(root, SRC.profilePage))).toBe(true);
  });

  test('profile actions file exists with all CRUD operations', () => {
    const content = fs.readFileSync(path.join(root, SRC.profileActions), 'utf8');
    expect(content).toContain('export async function updateProfileFields');
    expect(content).toContain('export async function addProfileItem');
    expect(content).toContain('export async function removeProfileItem');
    expect(content).toContain('export async function addSchoolAffiliation');
    expect(content).toContain('export async function addExternalLink');
    expect(content).toContain('export async function publishProfile');
  });

  test('dashboard links to profile wizard', () => {
    const content = fs.readFileSync(path.join(root, SRC.dashboardPage), 'utf8');
    expect(content).toContain('/dashboard/profile');
  });
});
