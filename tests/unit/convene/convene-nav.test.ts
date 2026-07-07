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
    test('gates the Convene widget (W6) by wiring the per-user flag into the resolver (KAN-349)', () => {
      // KAN-349 moved the old inline Convene landing card to the W6 dashboard widget
      // (src/app/dashboard/widgets/dashboard-widgets.tsx). It stays flag-gated: the page
      // passes the live per-user flag into resolveWidgets({ conveneEntitled }). Re-pointed,
      // not weakened — see the resolver assertion below for the actual gating.
      expect(src).toMatch(/conveneEntitled:\s*conveneEnabled/);
    });
    test('the widget resolver only emits the convene widget when entitled (KAN-349)', () => {
      const resolverSrc = fs.readFileSync(path.join(ROOT, 'src/lib/dashboard/resolve-widgets.ts'), 'utf8');
      expect(resolverSrc).toMatch(/if \(input\.conveneEntitled\)[\s\S]{0,80}'convene'/);
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
