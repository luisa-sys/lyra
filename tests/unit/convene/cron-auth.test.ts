/**
 * SEC-76 (web-convene-4) — Convene cron bearer auth is constant-time.
 *
 * The three Convene cron routes authenticate with
 * `Authorization: Bearer ${CRON_SECRET}`. A plain `!==` / `===` comparison
 * short-circuits on the first differing byte and leaks, via response timing,
 * how many leading bytes of the secret an attacker has guessed. These tests
 * pin the constant-time helper's behaviour and assert every cron route routes
 * its comparison through it.
 */

import fs from 'fs';
import path from 'path';
import { timingSafeStrEqual } from '@/lib/convene/cron-auth';
import { SRC } from '../../support/source-paths';

const ROOT = path.join(__dirname, '..', '..', '..');

describe('timingSafeStrEqual', () => {
  test('returns true for identical strings', () => {
    expect(timingSafeStrEqual('Bearer secret-123', 'Bearer secret-123')).toBe(true);
  });

  test('returns false for differing same-length strings', () => {
    expect(timingSafeStrEqual('Bearer secret-123', 'Bearer secret-124')).toBe(false);
  });

  test('returns false for differing-length strings (no throw)', () => {
    expect(timingSafeStrEqual('Bearer short', 'Bearer a-much-longer-secret')).toBe(false);
    expect(timingSafeStrEqual('Bearer a-much-longer-secret', 'Bearer short')).toBe(false);
  });

  test('returns false for null / undefined / empty actual', () => {
    expect(timingSafeStrEqual(null, 'Bearer secret')).toBe(false);
    expect(timingSafeStrEqual(undefined, 'Bearer secret')).toBe(false);
    expect(timingSafeStrEqual('', 'Bearer secret')).toBe(false);
  });

  test('empty expected only matches empty actual', () => {
    expect(timingSafeStrEqual('', '')).toBe(true);
    expect(timingSafeStrEqual('x', '')).toBe(false);
  });

  test('handles multi-byte UTF-8 without throwing', () => {
    expect(timingSafeStrEqual('Bearer café', 'Bearer café')).toBe(true);
    expect(timingSafeStrEqual('Bearer café', 'Bearer cafe')).toBe(false);
  });
});

describe('cron routes use the constant-time helper', () => {
  const routes = [
    SRC.sendInvitesRoute,
    SRC.postEventRoute,
    SRC.tokenHealthRoute,
  ];

  test.each(routes)('%s imports and calls timingSafeStrEqual', (rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    expect(src).toMatch(/from '@\/lib\/convene\/cron-auth'/);
    expect(src).toMatch(/timingSafeStrEqual\(/);
    // The insecure short-circuit comparison must not remain.
    expect(src).not.toMatch(/authorization'\)\s*!==\s*`Bearer/);
    expect(src).not.toMatch(/!==\s*`Bearer \$\{expected\}`/);
  });
});
