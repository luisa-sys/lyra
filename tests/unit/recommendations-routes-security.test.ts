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
    test(`${rel} reads the public_profiles view, so suspension is not optional`, () => {
      // SEC-104. Was: assert `.eq('is_suspended', false)` is present in the
      // source. The predicate moved into the `public_profiles` view body, where
      // it binds the service-role client these routes use — so the source no
      // longer contains the filter, by design.
      //
      // SEC-19/F-13's invariant is unchanged: a suspended profile must not
      // return recommendations. What changed is where it is enforced, and
      // therefore what this file can honestly check — that the route reads the
      // constrained source. The view's own definition is asserted live, per
      // database, by scripts/check-db-invariants.py.
      const content = fs.readFileSync(path.join(root, rel), 'utf8');
      expect(content).toMatch(/\.from\(\s*['"]public_profiles['"]\s*\)/);
      expect(content).not.toMatch(/\.from\(\s*['"]profiles['"]\s*\)/);
    });
  }
});
