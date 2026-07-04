/**
 * KAN-348 — Playwright globalSetup for the authenticated E2E harness.
 *
 * NO-OP unless `E2E_AUTHED` is set. The anon PR gate (e2e-tests.yml) runs with
 * dummy Supabase env and NO E2E_AUTHED, so this function returns immediately and
 * makes ZERO Supabase calls — the cred-free anon gate is entirely unaffected.
 *
 * When E2E_AUTHED is set it:
 *   1. asserts E2E_SUPABASE_URL + E2E_SUPABASE_SERVICE_ROLE_KEY are present
 *      (supabase-admin.ts additionally hard-guards against prod);
 *   2. seeds one deterministic user per journey state (seed-user.ts);
 *   3. mints one storageState per state into tests/e2e/.auth/<state>.json
 *      (mint-session.ts);
 *   4. writes tests/e2e/.auth/manifest.json mapping state -> {slug,userId,email}
 *      that the journey spec reads (avoids re-querying Supabase from the spec).
 *
 * tests/e2e/.auth/ is gitignored — the storageState files contain LIVE session
 * tokens and must never be committed or uploaded as a public CI artifact.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';
import { seedJourneyUser, emailForState, type JourneyState } from './support/seed-user';
import { mintSession } from './support/mint-session';

/** The states the journey spec provisions. Order is not significant. */
export const JOURNEY_STATES: readonly JourneyState[] = [
  'empty',
  'drafted',
  'published_activate',
  'published_grow',
  'no_convene',
  'age_none',
];

export const AUTH_DIR = path.join(__dirname, '.auth');
export const MANIFEST_PATH = path.join(AUTH_DIR, 'manifest.json');
export function statePath(state: JourneyState): string {
  return path.join(AUTH_DIR, `${state}.json`);
}

export interface ManifestEntry {
  state: JourneyState;
  slug: string;
  userId: string;
  profileId: string;
  email: string;
  storageState: string;
}
export type Manifest = Record<JourneyState, ManifestEntry>;

async function globalSetup(config: FullConfig): Promise<void> {
  if (!process.env.E2E_AUTHED) {
    // Anon gate: do nothing. No Supabase calls, no seeding.
    return;
  }

  if (!process.env.E2E_SUPABASE_URL || !process.env.E2E_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'E2E_AUTHED is set but E2E_SUPABASE_URL / E2E_SUPABASE_SERVICE_ROLE_KEY are missing. ' +
        'Provision these as GitHub Secrets scoped to DEV/STAGING (never prod). See .github/workflows/e2e-authed.yml.',
    );
  }

  const baseURL =
    config.projects[0]?.use?.baseURL ??
    process.env.BASE_URL ??
    'http://localhost:3000';

  mkdirSync(AUTH_DIR, { recursive: true });

  const manifest = {} as Manifest;
  for (const state of JOURNEY_STATES) {
    const seeded = await seedJourneyUser(state);
    const sp = statePath(state);
    await mintSession(String(baseURL), emailForState(state), sp);
    manifest[state] = {
      state,
      slug: seeded.slug,
      userId: seeded.userId,
      profileId: seeded.profileId,
      email: seeded.email,
      storageState: sp,
    };
  }

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

export default globalSetup;
