/**
 * KAN-303 — Convene navigation entry points are feature-flag gated.
 *
 * Structural assertions that the dashboard header + landing card and the
 * profile-page header only surface the Convene link behind isConveneEnabled().
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');
const dashboardPath = path.join(ROOT, 'src/app/dashboard/page.tsx');
const profileFormPath = path.join(ROOT, 'src/app/dashboard/profile/edit-profile-form.tsx');
const profilePagePath = path.join(ROOT, 'src/app/dashboard/profile/page.tsx');

describe('Convene nav entry points (KAN-303)', () => {
  describe('dashboard page', () => {
    const src = fs.readFileSync(dashboardPath, 'utf8');
    test('imports the per-user convene gate', () =>
      expect(src).toMatch(/import \{ isConveneEnabledForCurrentUser \} from ['"]@\/lib\/convene\/flags-user['"]/));
    test('computes conveneEnabled from the per-user gate', () =>
      expect(src).toMatch(/const conveneEnabled = await isConveneEnabledForCurrentUser\(\)/));
    test('gates the header Convene link on the flag', () => {
      expect(src).toMatch(/conveneEnabled &&[\s\S]{0,200}\/dashboard\/convene\/gatherings/);
    });
    test('gates a landing card on the flag and links to People', () => {
      expect(src).toMatch(/\/dashboard\/convene\/contacts/);
      // Both the header link and the landing card are wrapped in `conveneEnabled &&`.
      expect((src.match(/conveneEnabled &&/g) || []).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('profile editor header', () => {
    const src = fs.readFileSync(profileFormPath, 'utf8');
    test('accepts a conveneEnabled prop (default false)', () =>
      expect(src).toMatch(/conveneEnabled\s*=\s*false/));
    test('declares conveneEnabled in the props type', () =>
      expect(src).toMatch(/conveneEnabled\?:\s*boolean/));
    test('renders the Convene link only when the flag is on', () =>
      expect(src).toMatch(/conveneEnabled &&[\s\S]{0,200}\/dashboard\/convene\/gatherings/));
  });

  describe('profile page wiring', () => {
    const src = fs.readFileSync(profilePagePath, 'utf8');
    test('passes the live per-user gate value into the editor', () =>
      expect(src).toMatch(/conveneEnabled=\{await isConveneEnabledForCurrentUser\(\)\}/));
  });
});
