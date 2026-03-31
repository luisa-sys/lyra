/**
 * GDPR data export and account deletion tests
 * KAN-140: Verify Settings page has complete GDPR functionality
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const actionsPath = path.join(root, 'src/app/dashboard/settings/actions.ts');
const clientPath = path.join(root, 'src/app/dashboard/settings/settings-client.tsx');

describe('KAN-140: Data export action', () => {
  let content;
  beforeAll(() => { content = fs.readFileSync(actionsPath, 'utf8'); });

  test('exportUserData function exists', () => {
    expect(content).toContain('export async function exportUserData');
  });

  test('exports profile data', () => {
    expect(content).toContain("from('profiles')");
  });

  test('exports profile items', () => {
    expect(content).toContain("from('profile_items')");
  });

  test('exports school affiliations', () => {
    expect(content).toContain("from('school_affiliations')");
  });

  test('exports external links', () => {
    expect(content).toContain("from('external_links')");
  });

  test('exports api keys (without hash)', () => {
    expect(content).toContain("from('api_keys')");
    expect(content).toContain('key_prefix');
    // Must NOT include key_hash in export
    expect(content).toMatch(/api_keys.*select.*key_prefix/s);
  });

  test('includes export timestamp', () => {
    expect(content).toContain('exported_at');
  });

  test('includes account email', () => {
    expect(content).toContain('user.email');
  });
});

describe('KAN-140: Account deletion action', () => {
  let content;
  beforeAll(() => { content = fs.readFileSync(actionsPath, 'utf8'); });

  test('deleteAccount function exists', () => {
    expect(content).toContain('export async function deleteAccount');
  });

  test('deletes api_keys before profile', () => {
    const deleteApiKeysPos = content.indexOf("from('api_keys').delete()");
    const deleteProfilePos = content.indexOf("from('profiles').delete()");
    expect(deleteApiKeysPos).toBeGreaterThan(-1);
    expect(deleteProfilePos).toBeGreaterThan(-1);
    expect(deleteApiKeysPos).toBeLessThan(deleteProfilePos);
  });

  test('cleans up storage photos', () => {
    expect(content).toContain('profile-photos');
    expect(content).toContain('.remove(');
  });

  test('signs out after deletion', () => {
    expect(content).toContain('signOut');
  });

  test('redirects to home after deletion', () => {
    expect(content).toContain("redirect('/')");
  });
});

describe('KAN-140: Settings UI has GDPR controls', () => {
  let content;
  beforeAll(() => { content = fs.readFileSync(clientPath, 'utf8'); });

  test('has data export button', () => {
    expect(content).toContain('Download my data');
  });

  test('has delete account section', () => {
    expect(content).toContain('Delete your account');
  });

  test('requires DELETE confirmation text', () => {
    expect(content).toContain("deleteText !== 'DELETE'");
  });

  test('has cancel button for delete', () => {
    expect(content).toContain('Cancel');
  });

  test('creates downloadable JSON blob', () => {
    expect(content).toContain('application/json');
    expect(content).toContain('lyra-data-export');
  });
});
