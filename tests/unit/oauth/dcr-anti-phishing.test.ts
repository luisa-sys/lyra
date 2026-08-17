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
import { SRC } from '../../support/source-paths';

const ROOT = path.join(__dirname, '..', '..', '..');

describe('consent screen wires the trust surface (SEC-76 web-oauth-7)', () => {
  const src = fs.readFileSync(path.join(ROOT, SRC.authorizePage), 'utf8');

  test('imports clientTrust + redirectHost from the helper module', () => {
    // The module SPECIFIER is derived from the manifest, not written out. It
    // used to be the literal '@/lib/oauth/client-trust', and the `oauth-as`
    // extraction (KAN-415) broke it — an assertion about wiring failing for a
    // reason that has nothing to do with wiring, which is the KAN-417 coupling
    // this manifest exists to remove. Deriving it means the next move updates
    // one entry instead of this regex.
    const specifier = `@/${SRC.clientTrust.replace(/^src\//, '').replace(/\.ts$/, '')}`;
    const importRe = new RegExp(
      `import\\s+\\{[^}]*clientTrust[^}]*redirectHost[^}]*\\}\\s+from\\s+['"]${specifier.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      )}['"]`,
    );

    // Guard the derivation itself: a manifest key that silently became
    // undefined would build the regex `@/undefined` and fail confusingly, or —
    // worse, if the pattern were looser — match nothing while looking green.
    expect(SRC.clientTrust).toMatch(/client-trust\.ts$/);
    expect(src).toMatch(importRe);
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
  const src = fs.readFileSync(path.join(ROOT, SRC.clients), 'utf8');

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
    path.join(ROOT, SRC.migrations20260707193000Sec76OauthClientsIsFirstParty),
    'utf8'
  );

  test('adds is_first_party boolean defaulting false', () => {
    expect(mig).toMatch(/add column if not exists is_first_party boolean not null default false/i);
  });

  test('documents a rollback', () => {
    expect(mig).toMatch(/drop column if exists is_first_party/i);
  });
});
