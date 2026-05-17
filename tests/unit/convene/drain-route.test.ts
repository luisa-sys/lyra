/**
 * KAN-209 admin drain-queue route — structural tests.
 *
 * DB-touching paths are exercised by the smoke-test (real MCP +
 * route call) rather than mocked here.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');

describe('admin drain-queue route (KAN-209)', () => {
  const routePath = path.join(ROOT, 'src/app/api/convene/admin/drain-queue/route.ts');
  const authPath = path.join(ROOT, 'src/lib/convene/auth-bearer.ts');

  test('route file exists', () => {
    expect(fs.existsSync(routePath)).toBe(true);
  });

  test('auth helper file exists', () => {
    expect(fs.existsSync(authPath)).toBe(true);
  });

  test('route gates on isConveneEnabled + authenticateBearerApiKey', () => {
    const src = fs.readFileSync(routePath, 'utf8');
    expect(src).toMatch(/isConveneEnabled\(\)/);
    expect(src).toMatch(/authenticateBearerApiKey/);
  });

  test('route uses POST not GET (so a stray browser cannot accidentally fire it)', () => {
    const src = fs.readFileSync(routePath, 'utf8');
    expect(src).toMatch(/export async function POST/);
    expect(src).not.toMatch(/export async function GET/);
  });

  test('dispatcher is called with hostUserId filter (per-user scoping)', () => {
    const src = fs.readFileSync(routePath, 'utf8');
    expect(src).toMatch(/dispatchQueuedInvites\(\s*\{\s*hostUserId:\s*auth\.userId\s*\}/);
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
  const dispatchPath = path.join(ROOT, 'src/lib/convene/invites/dispatch.ts');

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
