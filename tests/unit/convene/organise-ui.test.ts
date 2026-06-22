/**
 * KAN-305 — Organise wizard UI structural tests.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');
const base = 'src/app/dashboard/convene/organise';
const pagePath = path.join(ROOT, base, 'page.tsx');
const wizardPath = path.join(ROOT, base, 'organise-wizard.tsx');
const actionsPath = path.join(ROOT, base, 'actions.ts');
const fieldsPath = path.join(ROOT, base, 'organise-fields.ts');

describe('Convene organise wizard UI (KAN-305)', () => {
  test('all four files exist', () => {
    expect(fs.existsSync(pagePath)).toBe(true);
    expect(fs.existsSync(wizardPath)).toBe(true);
    expect(fs.existsSync(actionsPath)).toBe(true);
    expect(fs.existsSync(fieldsPath)).toBe(true);
  });

  describe('page', () => {
    const src = fs.readFileSync(pagePath, 'utf8');
    test('gates on the per-user convene gate', () => expect(src).toMatch(/isConveneEnabledForCurrentUser\(\)/));
    test('redirects unauthenticated users', () => expect(src).toMatch(/redirect\(['"]\/login\?next=\/dashboard\/convene\/organise/));
    test('scopes contacts to the owner', () => expect(src).toMatch(/\.eq\(['"]owner_user_id['"],\s*user\.id\)/));
    test('honours a ?contact= preselect', () => expect(src).toMatch(/sp\.contact/));
  });

  describe('server actions', () => {
    const src = fs.readFileSync(actionsPath, 'utf8');
    test("'use server' directive at top", () => expect(src).toMatch(/^['"]use server['"]/m));
    test('exports the three actions', () => {
      for (const fn of ['createGatheringDraft', 'getHostBusyTimes', 'suggestVenues']) {
        expect(src).toMatch(new RegExp(`export async function ${fn}\\b`));
      }
    });
    test('createGatheringDraft stamps host_user_id and starts as draft', () => {
      expect(src).toMatch(/host_user_id:\s*userId/);
      expect(src).toMatch(/status:\s*['"]draft['"]/);
    });
    test('verifies invitee contacts are owned by the host', () => {
      expect(src).toMatch(/\.from\(['"]contacts['"]\)[\s\S]{0,160}\.in\(['"]id['"]/);
    });
    test('host-scoped writes carry ownership-ok comments', () => {
      expect((src.match(/ownership-ok:/g) || []).length).toBeGreaterThanOrEqual(4);
    });
    test('moderates free-text before creating', () => expect(src).toMatch(/moderateAndAudit\(/));
    test('appends a gathering_created audit row', () => expect(src).toMatch(/gathering_created/));
    test('suggestVenues uses the scoreVenue engine over the venues catalogue', () => {
      expect(src).toMatch(/scoreVenue\(/);
      expect(src).toMatch(/\.from\(['"]venues['"]\)/);
    });
    test('getHostBusyTimes reads the host calendar via the adapter', () => {
      expect(src).toMatch(/getConnectionForUser\(/);
      expect(src).toMatch(/getFreeBusy\(/);
    });
    test('exports no non-async runtime values (Gotcha #18)', () => {
      expect(src).not.toMatch(/export const /);
      expect(src).not.toMatch(/export function (?!async)/);
    });
  });

  describe('fields module', () => {
    const src = fs.readFileSync(fieldsPath, 'utf8');
    test('is not a use-server file', () => expect(src).not.toMatch(/^['"]use server['"]/m));
    test('exports the gathering-type list + guard', () => {
      expect(src).toMatch(/export const GATHERING_TYPES/);
      expect(src).toMatch(/export function isGatheringType/);
    });
  });

  describe('wizard island', () => {
    const src = fs.readFileSync(wizardPath, 'utf8');
    test("'use client' directive at top", () => expect(src).toMatch(/^['"]use client['"]/m));
    test('imports the organise actions', () => expect(src).toMatch(/from ['"]\.\/actions['"]/));
    test('routes to the new gathering detail page on success', () =>
      expect(src).toMatch(/\/dashboard\/convene\/gatherings\/\$\{res\.gatheringId\}/));
  });
});
