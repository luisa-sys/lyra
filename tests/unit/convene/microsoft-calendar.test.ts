/**
 * KAN-211 P7 — Microsoft Graph adapter + OAuth helpers — structural tests.
 *
 * The adapter is a thin HTTP shim around Microsoft Graph; behaviour tests
 * (round-tripping a real freeBusy / createEvent) are deferred to the
 * post-deploy smoke test once the user wires the Azure AD app.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');

describe('microsoft/oauth.ts (KAN-211 P7)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/convene/microsoft/oauth.ts'), 'utf8');

  test('declares the documented Microsoft Graph scopes', () => {
    expect(src).toMatch(/offline_access/);
    expect(src).toMatch(/Calendars\.ReadWrite/);
    expect(src).toMatch(/User\.Read/);
  });

  test('uses v2.0 endpoints on the /common tenant', () => {
    expect(src).toMatch(/login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/authorize/);
    expect(src).toMatch(/login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/token/);
  });

  test('buildAuthorizeUrl includes PKCE-friendly query params', () => {
    expect(src).toMatch(/response_type:\s*['"]code['"]/);
    expect(src).toMatch(/response_mode:\s*['"]query['"]/);
    expect(src).toMatch(/prompt:\s*['"]consent['"]/);
  });

  test('exchangeCodeForTokens uses grant_type=authorization_code', () => {
    expect(src).toMatch(/grant_type:\s*['"]authorization_code['"]/);
  });

  test('refreshAccessToken uses grant_type=refresh_token', () => {
    expect(src).toMatch(/grant_type:\s*['"]refresh_token['"]/);
  });

  test('all fetches carry AbortSignal.timeout', () => {
    expect(src).toMatch(/AbortSignal\.timeout/);
  });

  test('fetchUserInfo hits /v1.0/me', () => {
    expect(src).toMatch(/graph\.microsoft\.com\/v1\.0\/me/);
  });
});

describe('microsoft.ts calendar adapter (KAN-211 P7)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/convene/calendar/microsoft.ts'), 'utf8');

  test('exports microsoftCalendarAdapter implementing CalendarAdapter', () => {
    expect(src).toMatch(/export const microsoftCalendarAdapter:\s*CalendarAdapter/);
  });

  test('getFreeBusy uses /me/calendar/getSchedule with UTC envelope', () => {
    expect(src).toMatch(/\/me\/calendar\/getSchedule/);
    expect(src).toMatch(/timeZone:\s*['"]UTC['"]/);
  });

  test('createEvent sends MS Graph-shaped attendees (emailAddress + type)', () => {
    expect(src).toMatch(/emailAddress:\s*\{\s*address:\s*a\.email/);
    expect(src).toMatch(/type:\s*a\.optional\s*\?\s*['"]optional['"]\s*:\s*['"]required['"]/);
  });

  test('updateEvent uses PATCH /me/events/{id}', () => {
    expect(src).toMatch(/PATCH/);
    expect(src).toMatch(/\/me\/events\/\$\{encodeURIComponent\(providerEventId\)\}/);
  });

  test('deleteEvent treats 404/410 as idempotent success', () => {
    expect(src).toMatch(/res\.status !== 404 && res\.status !== 410/);
  });

  test('readErrorOrThrow flags 5xx / 429 as retryable', () => {
    expect(src).toMatch(/err\.retryable =\s*res\.status >= 500 \|\| res\.status === 429/);
  });

  test('busy filter includes oof + tentative blocks too', () => {
    expect(src).toMatch(/i\.status === ['"]busy['"]/);
    expect(src).toMatch(/i\.status === ['"]oof['"]/);
    expect(src).toMatch(/i\.status === ['"]tentative['"]/);
  });
});

describe('Microsoft OAuth routes (KAN-211 P7)', () => {
  test('/api/convene/oauth/microsoft/initiate route exists + gated by Convene flag', () => {
    const p = path.join(ROOT, 'src/app/api/convene/oauth/microsoft/initiate/route.ts');
    expect(fs.existsSync(p)).toBe(true);
    const src = fs.readFileSync(p, 'utf8');
    expect(src).toMatch(/isConveneEnabled\(\)/);
    expect(src).toMatch(/provider:\s*['"]microsoft['"]/);
    expect(src).toMatch(/buildAuthorizeUrl\(state\)/);
  });

  test('/api/convene/oauth/microsoft/callback exists + validates state.provider', () => {
    const p = path.join(ROOT, 'src/app/api/convene/oauth/microsoft/callback/route.ts');
    expect(fs.existsSync(p)).toBe(true);
    const src = fs.readFileSync(p, 'utf8');
    expect(src).toMatch(/stateRow\.provider !== ['"]microsoft['"]/);
    expect(src).toMatch(/exchangeCodeForTokens\(code\)/);
    expect(src).toMatch(/upsertConnection\(/);
    expect(src).toMatch(/provider:\s*['"]microsoft['"]/);
  });

  test('callback consumes the state row (single-use)', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'src/app/api/convene/oauth/microsoft/callback/route.ts'),
      'utf8'
    );
    expect(src).toMatch(/\.delete\(\)\.eq\(['"]state['"]/);
  });

  test('callback rejects when offline_access scope missing (no refresh_token)', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'src/app/api/convene/oauth/microsoft/callback/route.ts'),
      'utf8'
    );
    expect(src).toMatch(/no_refresh_token/);
    expect(src).toMatch(/offline_access/);
  });
});

describe('oauth-connections provider dispatch (KAN-211 P7)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/convene/oauth-connections.ts'), 'utf8');

  test('imports both refresh functions under aliases', () => {
    expect(src).toMatch(/refreshAccessToken as refreshGoogleAccessToken/);
    expect(src).toMatch(/refreshAccessToken as refreshMicrosoftAccessToken/);
  });

  test('refreshWithBackoff dispatches on provider', () => {
    expect(src).toMatch(/provider === ['"]google['"]\s*\?\s*refreshGoogleAccessToken\s*:\s*refreshMicrosoftAccessToken/);
  });

  test('getFreshAccessToken accepts microsoft provider', () => {
    expect(src).toMatch(/conn\.provider !== ['"]google['"] && conn\.provider !== ['"]microsoft['"]/);
  });
});

describe('conveneEnv microsoft entries (KAN-211 P7)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/convene/env.ts'), 'utf8');
  test('declares MICROSOFT_CALENDAR_CLIENT_ID/SECRET/REDIRECT_URI', () => {
    expect(src).toMatch(/MICROSOFT_CALENDAR_CLIENT_ID/);
    expect(src).toMatch(/MICROSOFT_CALENDAR_CLIENT_SECRET/);
    expect(src).toMatch(/MICROSOFT_CALENDAR_REDIRECT_URI/);
  });
});
