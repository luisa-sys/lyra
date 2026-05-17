/**
 * KAN-206 P2 — connections page + cron route structural tests.
 *
 * Light tests that verify the files exist, export the right things, and
 * carry the expected gates. Behavioural tests (auth required, RLS, cron
 * secret check) are exercised by E2E in P5.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');

describe('Convene connections page (KAN-206)', () => {
  const pagePath = path.join(ROOT, 'src/app/dashboard/convene/connections/page.tsx');
  const clientPath = path.join(ROOT, 'src/app/dashboard/convene/connections/connections-client.tsx');

  test('page file exists', () => {
    expect(fs.existsSync(pagePath)).toBe(true);
  });

  test('client file exists', () => {
    expect(fs.existsSync(clientPath)).toBe(true);
  });

  test('page gates on isConveneEnabled', () => {
    const src = fs.readFileSync(pagePath, 'utf8');
    expect(src).toMatch(/isConveneEnabled\(\)/);
  });

  test('page redirects unauthenticated users to /login', () => {
    const src = fs.readFileSync(pagePath, 'utf8');
    expect(src).toMatch(/redirect\(['"]\/login/);
  });

  test('page chains owner_user_id filter on oauth_connections read', () => {
    const src = fs.readFileSync(pagePath, 'utf8');
    expect(src).toMatch(/from\(['"]oauth_connections['"]\)[\s\S]*?\.eq\(['"]owner_user_id['"],\s*user\.id\)/);
  });

  test('client soft-deletes (sets deleted_at + status revoked) on disconnect', () => {
    const src = fs.readFileSync(clientPath, 'utf8');
    expect(src).toMatch(/deleted_at:/);
    expect(src).toMatch(/status:\s*['"]revoked['"]/);
  });

  test('client shows Connect Google button pointing at /api/convene/oauth/google/initiate', () => {
    const src = fs.readFileSync(clientPath, 'utf8');
    expect(src).toMatch(/\/api\/convene\/oauth\/google\/initiate/);
  });

  test('client maps Google scope URLs to human-readable labels', () => {
    const src = fs.readFileSync(clientPath, 'utf8');
    expect(src).toMatch(/calendar\.readonly/);
    expect(src).toMatch(/Read calendar/);
  });
});

describe('Convene token-health cron route (KAN-206)', () => {
  const routePath = path.join(ROOT, 'src/app/api/convene/cron/token-health/route.ts');

  test('route file exists', () => {
    expect(fs.existsSync(routePath)).toBe(true);
  });

  test('gates on isConveneEnabled', () => {
    const src = fs.readFileSync(routePath, 'utf8');
    expect(src).toMatch(/isConveneEnabled\(\)/);
  });

  test('requires CRON_SECRET bearer auth', () => {
    const src = fs.readFileSync(routePath, 'utf8');
    expect(src).toMatch(/CRON_SECRET/);
    expect(src).toMatch(/Bearer/);
    expect(src).toMatch(/unauthorised/);
  });

  test('reads active oauth_connections oldest-first', () => {
    const src = fs.readFileSync(routePath, 'utf8');
    expect(src).toMatch(/from\(['"]oauth_connections['"]\)/);
    expect(src).toMatch(/\.eq\(['"]status['"],\s*['"]active['"]\)/);
    expect(src).toMatch(/order\(['"]last_used_at['"]/);
  });

  test('marks failures as status=error', () => {
    const src = fs.readFileSync(routePath, 'utf8');
    expect(src).toMatch(/status:\s*['"]error['"]/);
  });
});

describe('vercel.json cron entry (KAN-206)', () => {
  const vercelJsonPath = path.join(ROOT, 'vercel.json');

  test('contains crons array with token-health entry', () => {
    const cfg = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf8'));
    expect(Array.isArray(cfg.crons)).toBe(true);
    const tokenHealth = cfg.crons.find(
      (c: { path: string }) => c.path === '/api/convene/cron/token-health'
    );
    expect(tokenHealth).toBeDefined();
    expect(tokenHealth?.schedule).toMatch(/^\d+\s+\d+\s+/); // some valid cron format
  });
});
