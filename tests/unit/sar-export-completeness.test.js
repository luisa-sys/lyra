/**
 * SEC-71: Subject-access / data-portability export completeness
 * (UK-GDPR Art. 15/20).
 *
 * exportUserData() must cover EVERY table keyed to the person and stay in
 * lockstep with the deletion cascade — export and erasure have to describe
 * the same data set. These are static-source assertions (the settings-actions
 * suite has no DI seam) that lock the export set and the secret redaction so a
 * future edit can't silently drop a section or leak token material.
 */

const fs = require('fs');
const path = require('path');
const { SRC } = require('../support/source-paths.json');

const root = path.join(__dirname, '../..');
const actionsPath = path.join(root, SRC.settingsActions);

describe('SEC-71: SAR export covers all user/profile-keyed personal data', () => {
  let content;
  let exportBody;
  beforeAll(() => {
    content = fs.readFileSync(actionsPath, 'utf8');
    // Isolate the exportUserData function body so assertions don't accidentally
    // match deleteAccount() or the other actions in the same file.
    const start = content.indexOf('export async function exportUserData');
    const next = content.indexOf('export async function deleteAccount');
    expect(start).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(start);
    exportBody = content.slice(start, next);
  });

  // Every table the deletion cascade removes must also be exported.
  const requiredTables = [
    'profiles',
    'profile_items',
    'school_affiliations',
    'external_links',
    'profile_manual_of_me',
    'profile_conversation_starters',
    'profile_files',
    'content_moderation_flags',
    'api_keys',
    'oauth_connections',
    'reports',
    'contacts',
    'contact_methods',
    'gatherings',
    'gathering_invitees',
    'gathering_proposed_slots',
    'gathering_invite_messages',
    'gathering_events_log',
  ];

  test.each(requiredTables)("exports the '%s' table", (table) => {
    expect(exportBody).toContain(`from('${table}')`);
  });

  test('scopes user-keyed tables by owner_user_id / actor / reporter', () => {
    expect(exportBody).toContain("eq('owner_user_id', user.id)"); // contacts, oauth
    expect(exportBody).toContain("eq('host_user_id', user.id)");  // gatherings
    expect(exportBody).toContain("eq('actor_user_id', user.id)"); // events log
    expect(exportBody).toContain("eq('reporter_user_id', user.id)"); // reports filed
  });

  test('scopes contact_methods and gathering children to the user’s own parents', () => {
    expect(exportBody).toContain("in('contact_id', contactIds)");
    expect(exportBody).toContain("in('gathering_id', gatheringIds)");
  });
});

describe('SEC-71: SAR export never leaks secret material', () => {
  let exportBody;
  beforeAll(() => {
    const content = fs.readFileSync(actionsPath, 'utf8');
    const start = content.indexOf('export async function exportUserData');
    const next = content.indexOf('export async function deleteAccount');
    exportBody = content.slice(start, next);
  });

  test('api_keys export omits the key hash', () => {
    expect(exportBody).toContain('key_prefix');
    expect(exportBody).not.toContain('key_hash');
  });

  test('oauth_connections export omits Vault token secret references', () => {
    expect(exportBody).toContain("from('oauth_connections')");
    expect(exportBody).not.toContain('refresh_token_secret_id');
    expect(exportBody).not.toContain('access_token_secret_id');
  });

  test('gathering_invitees export omits the live RSVP bearer token', () => {
    expect(exportBody).toContain("from('gathering_invitees')");
    expect(exportBody).not.toContain('rsvp_token');
  });
});

describe('SEC-71: SAR export is honest about partial failures', () => {
  let exportBody;
  beforeAll(() => {
    const content = fs.readFileSync(actionsPath, 'utf8');
    const start = content.indexOf('export async function exportUserData');
    const next = content.indexOf('export async function deleteAccount');
    exportBody = content.slice(start, next);
  });

  test('surfaces fetch failures rather than presenting a partial export as complete', () => {
    expect(exportBody).toContain('export_incomplete_errors');
  });
});
