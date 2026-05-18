/**
 * KAN-231 — static-grep regression guard for rate-limit wiring.
 *
 * The 10 mutating profile-save server actions all need to call
 * `checkProfileWriteRateLimit` before any DB write. This guard fails
 * CI if any of them lose the call.
 *
 * Mirrors the pattern of the moderation-wiring static-grep guard
 * (KAN-241 / KAN-242).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

function read(p: string): string {
  return readFileSync(join(__dirname, '..', '..', p), 'utf8');
}

function extractFn(src: string, name: string): string | null {
  const re = new RegExp(`export\\s+async\\s+function\\s+${name}\\s*\\(`);
  const m = src.match(re);
  if (!m) return null;
  const start = m.index!;
  // Greedy: find the matching closing brace at column 0 (heuristic — top-level
  // function body ends at next `^}` line). Tests only care that the slice
  // includes the actual function body up to the next top-level export.
  const rest = src.slice(start);
  const nextExport = rest.search(/\nexport\s+(?:async\s+)?function\s+/);
  return nextExport === -1 ? rest : rest.slice(0, nextExport);
}

describe('KAN-231 rate-limit wiring regression guards', () => {
  describe('src/app/dashboard/profile/actions.ts', () => {
    const src = read('src/app/dashboard/profile/actions.ts');

    test('imports checkProfileWriteRateLimit', () => {
      expect(src).toMatch(
        /import\s*\{\s*checkProfileWriteRateLimit\s*\}\s*from\s*['"]@\/lib\/profile-rate-limit['"]/,
      );
    });

    test.each([
      'updateProfileFields',
      'addProfileItem',
      'addSchoolAffiliation',
      'addExternalLink',
      'uploadAvatar',
    ])('%s calls checkProfileWriteRateLimit and fails closed', (fnName) => {
      const fn = extractFn(src, fnName);
      expect(fn).not.toBeNull();
      expect(fn!).toMatch(/checkProfileWriteRateLimit\s*\(/);
      expect(fn!).toMatch(/if\s*\(\s*!\s*rl\.allowed\s*\)\s*return\s+rl\.result/);
    });
  });

  describe('src/app/dashboard/profile/conversation-starters-actions.ts', () => {
    const src = read('src/app/dashboard/profile/conversation-starters-actions.ts');

    test('imports checkProfileWriteRateLimit', () => {
      expect(src).toMatch(/checkProfileWriteRateLimit/);
    });

    test.each(['addConversationStarter', 'updateConversationStarter'])(
      '%s wires the rate limit',
      (fnName) => {
        const fn = extractFn(src, fnName);
        expect(fn).not.toBeNull();
        expect(fn!).toMatch(/checkProfileWriteRateLimit\s*\(\s*userId\s*\)/);
      },
    );
  });

  describe('src/app/dashboard/profile/manual-of-me-actions.ts', () => {
    const src = read('src/app/dashboard/profile/manual-of-me-actions.ts');

    test('updateManualOfMe wires the rate limit', () => {
      const fn = extractFn(src, 'updateManualOfMe');
      expect(fn).not.toBeNull();
      expect(fn!).toMatch(/checkProfileWriteRateLimit\s*\(\s*user\.id\s*\)/);
    });
  });

  describe('src/app/dashboard/profile/files-actions.ts', () => {
    const src = read('src/app/dashboard/profile/files-actions.ts');

    test('uploadProfileFile wires the rate limit', () => {
      const fn = extractFn(src, 'uploadProfileFile');
      expect(fn).not.toBeNull();
      expect(fn!).toMatch(/checkProfileWriteRateLimit\s*\(/);
    });
  });

  describe('src/app/dashboard/profile/delivery-country-actions.ts', () => {
    const src = read('src/app/dashboard/profile/delivery-country-actions.ts');

    test('updateDeliveryCountry wires the rate limit', () => {
      const fn = extractFn(src, 'updateDeliveryCountry');
      expect(fn).not.toBeNull();
      expect(fn!).toMatch(/checkProfileWriteRateLimit\s*\(/);
    });
  });

  describe('placement: rate-limit runs BEFORE any DB write', () => {
    test('actions.ts: rl.allowed check precedes every .from(...) write', () => {
      const src = read('src/app/dashboard/profile/actions.ts');
      // For each function we wired, find the rate-limit check index and the
      // first .insert/.update/.delete after it. The rate-limit must come
      // first within the function body.
      const wired = [
        ['updateProfileFields', /\.from\(\s*['"]profiles['"]\s*\)\s*\n?\s*\.update/],
        ['addProfileItem', /\.from\(\s*['"]profile_items['"]\s*\)\s*\n?\s*\.insert/],
        ['addSchoolAffiliation', /\.from\(\s*['"]school_affiliations['"]\s*\)\s*\n?\s*\.insert/],
        ['addExternalLink', /\.from\(\s*['"]external_links['"]\s*\)\s*\n?\s*\.insert/],
      ] as const;
      for (const [fnName, writeRe] of wired) {
        const fn = extractFn(src, fnName)!;
        const rlIdx = fn.indexOf('checkProfileWriteRateLimit');
        const writeMatch = fn.match(writeRe);
        expect(rlIdx).toBeGreaterThanOrEqual(0);
        expect(writeMatch).not.toBeNull();
        expect(writeMatch!.index!).toBeGreaterThan(rlIdx);
      }
    });
  });
});
