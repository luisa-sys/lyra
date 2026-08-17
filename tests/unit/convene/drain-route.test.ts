/**
 * KAN-209 admin drain-queue route — structural tests.
 *
 * DB-touching paths are exercised by the smoke-test (real MCP +
 * route call) rather than mocked here.
 */

import fs from 'fs';
import path from 'path';
import { SRC } from '../../support/source-paths';

const ROOT = path.join(__dirname, '..', '..', '..');

describe('admin drain-queue route (KAN-209)', () => {
  // Six route-behaviour scans that sat here — the isConveneEnabled/auth gate,
  // POST-not-GET, the body api_key fallback, header-preferred ordering,
  // body-parse resilience, and the per-user hostUserId scoping — are now
  // executed rather than regexed, in ./drain-route-behaviour.test.ts.
  //
  // The scoping one is why it was worth doing: hardcoding a different id is a
  // cross-user data leak, and `hostUserId:` is STILL PRESENT in the file
  // afterwards, so the old regex stayed green through it. Mutation-proven.
  //
  // The remaining tests here are deliberately NOT converted: file-existence
  // checks, and assertions about auth-bearer's internals (sha256 hashing, the
  // lyra_ prefix, revoked-key handling) which the behavioural test mocks out
  // rather than exercises. Deleting those would lose real coverage.
  // (KAN-414 F4, KAN-417 §8 group 3.)

  const routePath = path.join(ROOT, SRC.route);
  const authPath = path.join(ROOT, SRC.authBearer);

  test('route file exists', () => {
    expect(fs.existsSync(routePath)).toBe(true);
  });

  test('auth helper file exists', () => {
    expect(fs.existsSync(authPath)).toBe(true);
  });







  test('auth helper hashes the key with sha256 (matches generateApiKey storage)', () => {
    const src = fs.readFileSync(authPath, 'utf8');
    expect(src).toMatch(/createHash\(['"]sha256['"]\)/);
  });

  test('auth helper rejects keys without lyra_ prefix', () => {
    const src = fs.readFileSync(authPath, 'utf8');
    expect(src).toMatch(/startsWith\(['"]lyra_['"]\)/);
  });

  test('auth helper rejects revoked keys', () => {
    const src = fs.readFileSync(authPath, 'utf8');
    expect(src).toMatch(/revoked_at/);
    expect(src).toMatch(/revoked_key/);
  });
});

describe('dispatchQueuedInvites — hostUserId filter (KAN-209)', () => {
  const dispatchPath = path.join(ROOT, SRC.dispatch);

  test('accepts optional hostUserId option', () => {
    const src = fs.readFileSync(dispatchPath, 'utf8');
    expect(src).toMatch(/hostUserId\?:\s*string/);
  });

  test('narrows to host_user_id when set', () => {
    const src = fs.readFileSync(dispatchPath, 'utf8');
    expect(src).toMatch(/eq\(['"]host_user_id['"],\s*opts\.hostUserId\)/);
  });

  test('uses .in("gathering_id", …) for the narrowed query', () => {
    const src = fs.readFileSync(dispatchPath, 'utf8');
    expect(src).toMatch(/\.in\(['"]gathering_id['"]/);
  });
});
