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

  test('accepts api_key in JSON body as fallback when Authorization header absent (KAN-240 symmetry)', () => {
    const src = fs.readFileSync(routePath, 'utf8');
    // Body parse + api_key extraction.
    expect(src).toMatch(/await req\.json\(\)/);
    expect(src).toMatch(/api_key\?:\s*unknown/);
    expect(src).toMatch(/typeof apiKey === ['"]string['"] && apiKey\.length > 0/);
    // The fallback re-runs Bearer auth with the body value wrapped as a Bearer.
    expect(src).toMatch(/authenticateBearerApiKey\(`Bearer \$\{apiKey\}`\)/);
  });

  test('header path is preferred over body — header is tried first', () => {
    const src = fs.readFileSync(routePath, 'utf8');
    // Implementation order matters: header path runs before body path.
    const headerIdx = src.indexOf("req.headers.get('authorization')");
    const bodyIdx = src.indexOf('await req.json()');
    expect(headerIdx).toBeGreaterThan(-1);
    expect(bodyIdx).toBeGreaterThan(-1);
    expect(headerIdx).toBeLessThan(bodyIdx);
  });

  test('body-parse errors do not crash the route', () => {
    const src = fs.readFileSync(routePath, 'utf8');
    // try/catch around req.json() so non-JSON bodies just fall through
    // to the header-auth error.
    expect(src).toMatch(/try\s*\{\s*body\s*=\s*await req\.json\(\)/);
    expect(src).toMatch(/\}\s*catch\b/);
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
