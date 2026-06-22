/**
 * KAN-304 — Contacts/People UI structural tests.
 *
 * Verifies the page/client/actions/helpers files exist, carry the expected
 * feature-gate + ownership + Gotcha-#18 properties, and wire together.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');
const base = 'src/app/dashboard/convene/contacts';
const pagePath = path.join(ROOT, base, 'page.tsx');
const clientPath = path.join(ROOT, base, 'contacts-client.tsx');
const actionsPath = path.join(ROOT, base, 'actions.ts');
const helpersPath = path.join(ROOT, base, 'contacts-helpers.ts');

describe('Convene contacts UI (KAN-304)', () => {
  test('all four files exist', () => {
    expect(fs.existsSync(pagePath)).toBe(true);
    expect(fs.existsSync(clientPath)).toBe(true);
    expect(fs.existsSync(actionsPath)).toBe(true);
    expect(fs.existsSync(helpersPath)).toBe(true);
  });

  describe('page', () => {
    const src = fs.readFileSync(pagePath, 'utf8');
    test('gates on the per-user convene gate', () => expect(src).toMatch(/isConveneEnabledForCurrentUser\(\)/));
    test('redirects unauthenticated users to /login with ?next', () =>
      expect(src).toMatch(/redirect\(['"]\/login\?next=\/dashboard\/convene\/contacts/));
    test('scopes the contacts query to owner_user_id', () =>
      expect(src).toMatch(/\.eq\(['"]owner_user_id['"],\s*user\.id\)/));
    test('excludes soft-deleted contacts', () =>
      expect(src).toMatch(/\.is\(['"]deleted_at['"],\s*null\)/));
  });

  describe('server actions', () => {
    const src = fs.readFileSync(actionsPath, 'utf8');
    test("'use server' directive at top", () => expect(src).toMatch(/^['"]use server['"]/m));
    test('exports the five actions', () => {
      for (const fn of [
        'addContact',
        'updateContact',
        'deleteContact',
        'linkContactToProfile',
        'searchDirectoryProfiles',
      ]) {
        expect(src).toMatch(new RegExp(`export async function ${fn}\\b`));
      }
    });
    test('addContact stamps owner_user_id from the authed user', () =>
      expect(src).toMatch(/owner_user_id:\s*user\.id/));
    test('deleteContact is a soft delete (sets deleted_at)', () =>
      expect(src).toMatch(/deleted_at:\s*new Date\(\)\.toISOString\(\)/));
    test('linkContactToProfile verifies the profile is published', () =>
      expect(src).toMatch(/is_published/));
    test('directory search only queries published profiles', () =>
      expect(src).toMatch(/\.eq\(['"]is_published['"],\s*true\)/));
    test('exports NO non-async runtime values (Gotcha #18)', () => {
      expect(src).not.toMatch(/export const /);
      expect(src).not.toMatch(/export function (?!async)/);
    });
  });

  describe('helpers (sibling module)', () => {
    const src = fs.readFileSync(helpersPath, 'utf8');
    test('is NOT a use-server file', () => expect(src).not.toMatch(/^['"]use server['"]/m));
    test('exports runtime constants/helpers', () => {
      expect(src).toMatch(/export const CONTACT_LIMITS/);
      expect(src).toMatch(/export function normaliseEmail/);
      expect(src).toMatch(/export function sanitiseDirectoryQuery/);
    });
  });

  describe('client island', () => {
    const src = fs.readFileSync(clientPath, 'utf8');
    test("'use client' directive at top", () => expect(src).toMatch(/^['"]use client['"]/m));
    test('imports the contact actions', () =>
      expect(src).toMatch(/from ['"]\.\/actions['"]/));
    test('offers an Organise entry point per contact', () =>
      expect(src).toMatch(/\/dashboard\/convene\/organise\?contact=/));
    test('confirms before deleting', () => expect(src).toMatch(/confirm\(/));
  });
});
