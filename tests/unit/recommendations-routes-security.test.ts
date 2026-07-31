/**
 * SEC-19 / F-13 — the recommendation API routes must not return data for
 * suspended profiles. These routes use the service-role client (bypassing
 * RLS), so the `is_suspended` filter has to be explicit. Source assertion
 * locks the filter in against regression.
 */
import fs from 'fs';
import path from 'path';
import { SRC } from '../support/source-paths';

const root = path.join(__dirname, '../..');

describe('SEC-19/F-13: recommendation routes filter suspended profiles', () => {
  for (const rel of [
    SRC.slugRoute,
    SRC.v2SlugRoute,
  ]) {
    test(`${rel} filters is_suspended = false on the profile lookup`, () => {
      const content = fs.readFileSync(path.join(root, rel), 'utf8');
      expect(content).toMatch(/\.eq\(\s*['"]is_suspended['"]\s*,\s*false\s*\)/);
    });
  }
});
