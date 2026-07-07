/**
 * SEC-76 (web-oauth-7) — DCR anti-phishing wiring guard.
 *
 * Static-source assertions that the consent screen surfaces the trust badge,
 * the unverified warning, and the real redirect host, and that DCR-registered
 * clients are persisted (and read back) as NOT first-party. These protect the
 * anti-phishing controls from silently regressing in a future refactor.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');

describe('consent screen wires the trust surface (SEC-76 web-oauth-7)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/app/oauth/authorize/page.tsx'), 'utf8');

  test('imports clientTrust + redirectHost from the helper module', () => {
    expect(src).toMatch(
      /import\s+\{[^}]*clientTrust[^}]*redirectHost[^}]*\}\s+from\s+['"]@\/lib\/oauth\/client-trust['"]/
    );
  });

  test('computes trust from the client is_first_party flag', () => {
    expect(src).toMatch(/clientTrust\(req\.client\.is_first_party\)/);
  });

  test('computes the redirect host from the validated redirect URI', () => {
    expect(src).toMatch(/redirectHost\(req\.redirectUri\)/);
  });

  test('renders the trust badge', () => {
    expect(src).toMatch(/data-testid="client-trust-badge"/);
  });

  test('renders an unverified-client warning gated on !verified', () => {
    expect(src).toMatch(/!trust\.verified\s*&&/);
    expect(src).toMatch(/data-testid="unverified-client-warning"/);
    expect(src).toMatch(/has not been verified by Lyra/);
  });

  test('surfaces the redirect host to the user', () => {
    expect(src).toMatch(/you&apos;ll be returned to/);
    expect(src).toMatch(/\{returnHost\}/);
  });
});

describe('oauth_clients repository treats DCR clients as unverified (SEC-76)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/oauth/clients.ts'), 'utf8');

  test('DCR insert explicitly sets is_first_party: false', () => {
    expect(src).toMatch(/is_first_party:\s*false/);
  });

  test('getOauthClient selects is_first_party so the consent screen can read it', () => {
    expect(src).toMatch(/\.select\(\s*['"][^'"]*is_first_party[^'"]*['"]/);
  });

  test('ClientRecord type carries is_first_party', () => {
    expect(src).toMatch(/is_first_party:\s*boolean/);
  });
});

describe('migration adds the is_first_party column (SEC-76)', () => {
  const mig = fs.readFileSync(
    path.join(ROOT, 'supabase/migrations/20260707193000_sec76_oauth_clients_is_first_party.sql'),
    'utf8'
  );

  test('adds is_first_party boolean defaulting false', () => {
    expect(mig).toMatch(/add column if not exists is_first_party boolean not null default false/i);
  });

  test('documents a rollback', () => {
    expect(mig).toMatch(/drop column if exists is_first_party/i);
  });
});
