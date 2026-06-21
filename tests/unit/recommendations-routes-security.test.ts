/**
 * SEC-19 / F-13 — the recommendation API routes must not return data for
 * suspended profiles. These routes use the service-role client (bypassing
 * RLS), so the `is_suspended` filter has to be explicit. Source assertion
 * locks the filter in against regression.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '../..');

describe('SEC-19/F-13: recommendation routes filter suspended profiles', () => {
  for (const rel of [
    'src/app/api/recommendations/[slug]/route.ts',
    'src/app/api/recommendations/v2/[slug]/route.ts',
  ]) {
    test(`${rel} filters is_suspended = false on the profile lookup`, () => {
      const content = fs.readFileSync(path.join(root, rel), 'utf8');
      expect(content).toMatch(/\.eq\(\s*['"]is_suspended['"]\s*,\s*false\s*\)/);
    });
  }
});
