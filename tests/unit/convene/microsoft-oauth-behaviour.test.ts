/**
 * KAN-414 F4 (KAN-417 §8 group 3) — behavioural replacement for the
 * authorize/token scans in tests/unit/convene/microsoft-calendar.test.ts.
 *
 * WHAT THE SCAN CANNOT SEE
 * ------------------------
 * It greps `oauth.ts` for `offline_access`, `User.Read`, `Calendars.ReadWrite`
 * and the two v2.0 URLs. Every one of those is a DECLARATION. What reaches
 * Microsoft is the authorize URL, and the scan never looks at it:
 *
 *   * Delete `scope: MICROSOFT_SCOPES.join(' ')` from the URLSearchParams and
 *     the array survives untouched — all three scope regexes stay green while
 *     Microsoft is asked for **no permissions at all**: no calendar access and,
 *     critically, **no refresh token**.
 *   * Join with `,` instead of `' '`. Microsoft v2.0 requires space-delimited
 *     scopes. Array and `scope:` line both intact, so the scan is green. A
 *     delimiter bug is far likelier than deleting the line outright.
 *   * ADD a scope — `Mail.Read`, say. A presence-only assertion is
 *     structurally incapable of noticing over-requested Graph permissions on a
 *     service holding minors' personal data.
 *
 * DO NOT COPY tests/unit/convene/google-oauth.test.ts:37-43
 * --------------------------------------------------------
 * That file does `for (const s of GOOGLE_SCOPES) expect(scope).toContain(s)`,
 * which uses the constant under test as its own oracle: delete an entry and it
 * stays green; empty the constant and it passes with ZERO assertions executed.
 * Copying it here would produce a test WEAKER than the scan it replaces on the
 * one mutation that matters — losing `offline_access`. Raised as **BUGS-86**.
 *
 * So the literals below are written out by hand, and compared as a SET, not
 * with `toContain`. The set comparison is what catches over-requesting.
 *
 * WHY offline_access IS THE ONE
 * -----------------------------
 * Without it Microsoft returns no `refresh_token`, so every calendar
 * connection works until the first access-token expiry and then dies. That
 * fails quietly, hours after the deploy, per-user.
 *
 * MUTATION PROOF (2026-08-02, each reverted). The old scan stayed 22/22 green
 * under every one.
 *
 *   | mutation to src/lib/convene/microsoft/oauth.ts | this suite |
 *   |------------------------------------------------|------------|
 *   | delete the `scope:` entry from authorize params | 3 failed   |
 *   | `MICROSOFT_SCOPES.join(',')`                    | 2 failed   |
 *   | add 'Mail.Read' to MICROSOFT_SCOPES             | 2 failed   |
 *   | `fetch(TOKEN_URL)` -> `fetch(AUTHORIZE_URL)`    | 1 failed   |
 */
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
} from '@/lib/convene/microsoft/oauth';

// Hardcoded on purpose — see the header. Deriving these from MICROSOFT_SCOPES
// would reproduce BUGS-86.
const EXPECTED_SCOPES = ['offline_access', 'User.Read', 'Calendars.ReadWrite'];

const REDIRECT = 'https://checklyra.com/api/convene/oauth/microsoft/callback';

const ORIGINAL = { ...process.env };
beforeAll(() => {
  process.env.MICROSOFT_CALENDAR_CLIENT_ID = 'client-abc';
  process.env.MICROSOFT_CALENDAR_CLIENT_SECRET = 'secret-xyz';
  process.env.MICROSOFT_CALENDAR_REDIRECT_URI = REDIRECT;
});
afterAll(() => {
  process.env = { ...ORIGINAL };
});

const authorize = (state = 'st-1') => new URL(buildAuthorizeUrl(state));

describe('buildAuthorizeUrl — what Microsoft is actually asked for', () => {
  it('requests EXACTLY the three documented scopes', () => {
    const scope = authorize().searchParams.get('scope') ?? '';

    // Set equality, not toContain: this fails on a MISSING scope and on an
    // EXTRA one. `URLSearchParams` encodes the joined string with '+', and
    // `searchParams.get` decodes it back to spaces.
    expect(new Set(scope.split(' '))).toEqual(new Set(EXPECTED_SCOPES));
  });

  it('space-delimits the scopes, as Microsoft v2.0 requires', () => {
    const scope = authorize().searchParams.get('scope') ?? '';

    // A ',' join leaves every literal present in the file, so the scan is blind
    // to it, and Microsoft rejects or silently narrows the request.
    expect(scope).not.toContain(',');
    expect(scope.split(' ')).toHaveLength(EXPECTED_SCOPES.length);
  });

  it('asks for offline_access, without which there is no refresh token', () => {
    // Called out separately from the set assertion because the failure mode is
    // distinctive: connections work until the first expiry, then die quietly,
    // per-user, hours after the deploy.
    expect(authorize().searchParams.get('scope')).toContain('offline_access');
  });

  it('targets the v2.0 /common authorize endpoint', () => {
    const url = authorize();

    expect(url.origin).toBe('https://login.microsoftonline.com');
    expect(url.pathname).toBe('/common/oauth2/v2.0/authorize');
  });

  it('carries the code-flow params and the caller’s state', () => {
    const p = authorize('state-xyz').searchParams;

    expect(p.get('response_type')).toBe('code');
    expect(p.get('response_mode')).toBe('query');
    expect(p.get('state')).toBe('state-xyz');
    expect(p.get('client_id')).toBe('client-abc');
    expect(p.get('redirect_uri')).toBe(REDIRECT);
    // prompt=consent is what makes Microsoft re-issue a refresh token when a
    // user reconnects, rather than returning an access token alone.
    expect(p.get('prompt')).toBe('consent');
  });
});

describe('exchangeCodeForTokens — where the code is actually POSTed', () => {
  const realFetch = global.fetch;
  let sent: { url: string; body: URLSearchParams } | null = null;

  beforeEach(() => {
    sent = null;
    global.fetch = (async (url: string, init: { body: string }) => {
      sent = { url: String(url), body: new URLSearchParams(init.body) };
      return {
        ok: true,
        json: async () => ({ access_token: 'a', expires_in: 3600, token_type: 'Bearer' }),
      };
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('POSTs to the v2.0 /common TOKEN endpoint, not the authorize one', async () => {
    await exchangeCodeForTokens('code-1');

    // Both URLs are declared in the same file, so swapping them at the call
    // site leaves every literal — and the scan — untouched.
    expect(new URL(sent!.url).pathname).toBe('/common/oauth2/v2.0/token');
  });

  it('uses grant_type=authorization_code and sends the client secret', async () => {
    await exchangeCodeForTokens('code-1');

    expect(sent!.body.get('grant_type')).toBe('authorization_code');
    expect(sent!.body.get('code')).toBe('code-1');
    expect(sent!.body.get('client_secret')).toBe('secret-xyz');
    // The redirect_uri must match the one used at authorize time or Microsoft
    // rejects the exchange.
    expect(sent!.body.get('redirect_uri')).toBe(REDIRECT);
  });

  it('raises on a non-OK token response rather than returning a partial', async () => {
    global.fetch = (async () => ({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    })) as unknown as typeof fetch;

    // Returning a half-built token object here would store an unusable
    // connection that fails later, away from the cause.
    await expect(exchangeCodeForTokens('stale')).rejects.toThrow(/400/);
  });
});
