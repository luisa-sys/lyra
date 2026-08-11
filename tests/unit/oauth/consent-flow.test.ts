/**
 * KAN-415 D7 part 3 — behavioural coverage for the OAuth consent flow.
 *
 * These functions were reachable only by driving a `'use server'` action inside
 * the app tree, so the pure decisions inside them — the open-redirect guard and
 * the authorize-URL rebuild — had never been tested as themselves. The existing
 * suites around this flow (`consent-account-banner`, `sec57-issuance-suspension`)
 * are largely SOURCE-TEXT scans, which is the weakest form of guard we have:
 * every string they look for can sit in a comment. Those are kept and repointed;
 * this file is the behavioural half they could not express.
 *
 * ⚠️ THE ASYMMETRY THIS FILE EXISTS TO PIN: the consent PAGE fails OPEN on an
 * `'unknown'` standing (a transient lookup blip must not bounce a good user to
 * /suspended), and the credential MINT here fails CLOSED on the same value.
 * Those two are easy to "tidy" into agreement, and either direction is a real
 * defect — one is an outage, the other issues an OAuth code to an account we
 * could not verify. The page half lives in oauth-authorize-suspension-guard.
 *
 * Mutation-proven 2026-08-11, each reverted after confirming red — and each
 * mutation confirmed to have actually applied to the file first, because a
 * string-replace that matches nothing yields a green run indistinguishable from
 * a real one.
 */
import {
  buildAuthorizePath,
  safeAuthorizeNext,
  switchAccountAndContinue,
  submitConsent,
  type DecideInput,
} from '@/modules/oauth-as/consent-flow';

let calls: string[] = [];
let currentUser: { id: string } | null = { id: 'user-123' };
let standing: 'ok' | 'suspended' | 'unknown' = 'ok';

jest.mock('next/navigation', () => ({
  redirect: jest.fn((to: string) => {
    calls.push(`redirect:${to}`);
    // Next's redirect throws to halt execution; mimic it so nothing downstream
    // runs that a real request would never reach.
    const err = new Error(`NEXT_REDIRECT:${to}`);
    (err as unknown as { digest: string }).digest = `NEXT_REDIRECT;${to}`;
    throw err;
  }),
}));

const mockSignOut = jest.fn(async () => {
  calls.push('signOut');
});
jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: jest.fn(async () => ({
    auth: {
      signOut: (...a: unknown[]) => mockSignOut(...(a as [])),
      getUser: jest.fn(async () => ({ data: { user: currentUser } })),
    },
  })),
}));

// The real `shouldRefuseIssuance` is used deliberately — mocking it would make
// the fail-closed test assert against a stub of the very decision under test.
jest.mock('@/lib/account-status', () => ({
  ...jest.requireActual('@/lib/account-status'),
  getAccountStanding: jest.fn(async () => standing),
}));

const mockGetOauthClient = jest.fn();
jest.mock('@/modules/oauth-as/lib/clients', () => ({
  getOauthClient: (...a: unknown[]) => mockGetOauthClient(...a),
}));

const mockRecordConsent = jest.fn(async () => {
  calls.push('recordConsent');
});
jest.mock('@/modules/oauth-as/lib/consents', () => ({
  recordConsent: (...a: unknown[]) => mockRecordConsent(...(a as [])),
}));

const mockIssueAuthCode = jest.fn(async () => {
  calls.push('issueAuthCode');
  return { code: 'authcode-xyz' };
});
jest.mock('@/modules/oauth-as/lib/codes', () => ({
  issueAuthCode: (...a: unknown[]) => mockIssueAuthCode(...(a as [])),
}));

jest.mock('@/modules/oauth-as/lib/authorize', () => ({
  buildErrorRedirect: (uri: string, code: string, _d: string, state?: string) =>
    `${uri}?error=${code}${state ? `&state=${state}` : ''}`,
  buildSuccessRedirect: (uri: string, code: string, state?: string) =>
    `${uri}?code=${code}${state ? `&state=${state}` : ''}`,
}));

const VALID: DecideInput = {
  client_id: 'client-1',
  redirect_uri: 'https://claude.ai/callback',
  scope: 'lyra:full',
  state: 'xyz',
  code_challenge: 'abc123',
  code_challenge_method: 'S256',
  decision: 'allow',
};

beforeEach(() => {
  calls = [];
  currentUser = { id: 'user-123' };
  standing = 'ok';
  jest.clearAllMocks();
  mockGetOauthClient.mockResolvedValue({
    client_id: 'client-1',
    revoked_at: null,
    redirect_uris: ['https://claude.ai/callback'],
  });
});

/** Every path here ends in a redirect; swallow it and inspect `calls`. */
async function run(fn: () => Promise<void>): Promise<void> {
  await expect(fn()).rejects.toThrow(/NEXT_REDIRECT/);
}

// ── buildAuthorizePath — one implementation, previously three ──────────────
describe('buildAuthorizePath', () => {
  const params = {
    clientId: 'client-1',
    redirectUri: 'https://claude.ai/callback',
    scope: 'lyra:full',
    state: 'xyz',
    codeChallenge: 'abc123',
    codeChallengeMethod: 'S256',
  };

  test('emits the seven parameters in the order external clients already see', () => {
    // Pinned verbatim, not by parsing: this is a frozen contract, and a
    // round-trip through URLSearchParams would happily accept a reordering
    // that changes the literal string a client compares against.
    expect(buildAuthorizePath(params)).toBe(
      '/oauth/authorize?client_id=client-1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcallback' +
        '&response_type=code&scope=lyra%3Afull&state=xyz&code_challenge=abc123' +
        '&code_challenge_method=S256'
    );
  });

  test('omits state entirely when absent — it does not emit state=', () => {
    // `state` is optional in OAuth. An empty `state=` is not the same request
    // as no state at all, and a client echoing it back would differ.
    const withoutState = buildAuthorizePath({ ...params, state: undefined });
    expect(withoutState).not.toContain('state=');
    expect(withoutState).toContain('scope=lyra%3Afull&code_challenge=abc123');
  });

  test('an empty-string state is treated as absent, matching the pre-move code', () => {
    expect(buildAuthorizePath({ ...params, state: '' })).toBe(
      buildAuthorizePath({ ...params, state: undefined })
    );
  });

  test('percent-encodes values that would otherwise break the query', () => {
    const path = buildAuthorizePath({
      ...params,
      redirectUri: 'https://evil.test/cb?a=1&b=2',
      state: 'a b&c=d',
    });
    // The injected `&b=2` must not become a sibling parameter of the outer URL.
    expect(path).toContain('redirect_uri=https%3A%2F%2Fevil.test%2Fcb%3Fa%3D1%26b%3D2');
    expect(new URLSearchParams(path.split('?')[1]).get('state')).toBe('a b&c=d');
  });

  test('the page shape and the action shape produce the SAME path', () => {
    // The claim that justified collapsing three copies into one. If this ever
    // fails, the de-duplication changed behaviour and the commit is wrong.
    const fromPage = buildAuthorizePath({
      clientId: 'client-1',
      redirectUri: 'https://claude.ai/callback',
      scope: 'lyra:full',
      state: 'xyz',
      codeChallenge: 'abc123',
      codeChallengeMethod: 'S256',
    });
    const fromAction = buildAuthorizePath({
      clientId: VALID.client_id,
      redirectUri: VALID.redirect_uri,
      scope: VALID.scope,
      state: VALID.state,
      codeChallenge: VALID.code_challenge,
      codeChallengeMethod: VALID.code_challenge_method,
    });
    expect(fromAction).toBe(fromPage);
  });
});

// ── safeAuthorizeNext — the open-redirect guard ────────────────────────────
describe('safeAuthorizeNext', () => {
  test('accepts a relative authorize path with a query', () => {
    expect(safeAuthorizeNext('/oauth/authorize?client_id=x')).toBe('/oauth/authorize?client_id=x');
  });

  test.each([
    ['an absolute URL', 'https://evil.test/oauth/authorize?x=1'],
    ['a protocol-relative URL', '//evil.test/oauth/authorize?x=1'],
    ['a backslash-prefixed URL', '\\\\evil.test/oauth/authorize?x=1'],
    ['a path that merely CONTAINS the prefix', '/redirect?to=/oauth/authorize?x=1'],
    ['a lookalike path', '/oauth/authorize-evil?x=1'],
    ['the bare path with no query', '/oauth/authorize'],
    ['an empty string', ''],
  ])('falls back to /login for %s', (_label, input) => {
    expect(safeAuthorizeNext(input)).toBe('/login');
  });

  test('an evil host embedded AFTER a legitimate prefix is still accepted — by design', () => {
    // Documenting the actual boundary rather than implying one that is not
    // there. The value is only ever used as a same-origin relative path, so a
    // query parameter naming another host is inert; the guard exists to stop
    // the PATH itself leaving the origin.
    expect(safeAuthorizeNext('/oauth/authorize?redirect_uri=https://evil.test')).toBe(
      '/oauth/authorize?redirect_uri=https://evil.test'
    );
  });
});

// ── switchAccountAndContinue ───────────────────────────────────────────────
describe('switchAccountAndContinue', () => {
  test('signs out BEFORE redirecting, and preserves the authorize request', async () => {
    await run(() => switchAccountAndContinue('/oauth/authorize?client_id=x'));
    expect(calls).toEqual([
      'signOut',
      `redirect:/login?next=${encodeURIComponent('/oauth/authorize?client_id=x')}`,
    ]);
  });

  test('a hostile next target is replaced with /login, and the sign-out still happens', async () => {
    // The order matters: bailing out early would leave the user signed in as
    // the wrong account, which is the exact bug this button was added to fix.
    await run(() => switchAccountAndContinue('https://evil.test/steal'));
    expect(calls).toEqual(['signOut', `redirect:/login?next=${encodeURIComponent('/login')}`]);
  });
});

// ── submitConsent ──────────────────────────────────────────────────────────
describe('submitConsent — client and PKCE re-validation', () => {
  test('an unknown client issues nothing', async () => {
    mockGetOauthClient.mockResolvedValue(null);
    await run(() => submitConsent(VALID));
    expect(calls).toEqual(['redirect:/oauth/error?reason=invalid_client']);
  });

  test('a REVOKED client issues nothing — revocation is checked, not just existence', async () => {
    mockGetOauthClient.mockResolvedValue({
      client_id: 'client-1',
      revoked_at: '2026-01-01T00:00:00Z',
      redirect_uris: ['https://claude.ai/callback'],
    });
    await run(() => submitConsent(VALID));
    expect(calls).toEqual(['redirect:/oauth/error?reason=invalid_client']);
  });

  test('a redirect_uri the client never registered is refused', async () => {
    // The form payload is attacker-controllable, so the registered list is the
    // only authority on where a code may be delivered.
    await run(() => submitConsent({ ...VALID, redirect_uri: 'https://evil.test/cb' }));
    expect(calls).toEqual(['redirect:/oauth/error?reason=invalid_redirect_uri']);
    expect(mockIssueAuthCode).not.toHaveBeenCalled();
  });

  test.each([
    ['a downgraded challenge method', { code_challenge_method: 'plain' }],
    ['a missing challenge', { code_challenge: '' }],
  ])('PKCE is mandatory: %s is refused', async (_label, override) => {
    await run(() => submitConsent({ ...VALID, ...override }));
    expect(calls[0]).toContain('error=invalid_request');
    expect(mockIssueAuthCode).not.toHaveBeenCalled();
  });

  test('a session that expired between render and submit bounces to login, request intact', async () => {
    currentUser = null;
    await run(() => submitConsent(VALID));
    const expected = buildAuthorizePath({
      clientId: VALID.client_id,
      redirectUri: VALID.redirect_uri,
      scope: VALID.scope,
      state: VALID.state,
      codeChallenge: VALID.code_challenge,
      codeChallengeMethod: VALID.code_challenge_method,
    });
    expect(calls).toEqual([`redirect:/login?next=${encodeURIComponent(expected)}`]);
  });
});

describe('submitConsent — the decision', () => {
  test('deny records NO consent and issues NO code', async () => {
    await run(() => submitConsent({ ...VALID, decision: 'deny' }));
    expect(calls).toEqual([
      'redirect:https://claude.ai/callback?error=access_denied&state=xyz',
    ]);
    expect(mockRecordConsent).not.toHaveBeenCalled();
    expect(mockIssueAuthCode).not.toHaveBeenCalled();
  });

  test('allow records consent BEFORE issuing the code, then redirects', async () => {
    // Order is the contract. A code issued before the grant is recorded is a
    // live credential with no audit trail of the user having agreed to it.
    await run(() => submitConsent(VALID));
    expect(calls).toEqual([
      'recordConsent',
      'issueAuthCode',
      'redirect:https://claude.ai/callback?code=authcode-xyz&state=xyz',
    ]);
  });

  test('the code is always minted with S256, never with whatever was submitted', async () => {
    await run(() => submitConsent(VALID));
    expect(mockIssueAuthCode).toHaveBeenCalledWith(
      expect.objectContaining({ codeChallengeMethod: 'S256', userId: 'user-123' })
    );
  });
});

describe('submitConsent — SEC-57 issuance standing (fails CLOSED)', () => {
  test('a suspended user gets no code', async () => {
    standing = 'suspended';
    await run(() => submitConsent(VALID));
    expect(calls).toEqual(['redirect:/suspended']);
    expect(mockIssueAuthCode).not.toHaveBeenCalled();
  });

  test("⚠️ an UNKNOWN standing also gets no code — the mint fails closed", async () => {
    // The half most at risk of being "tidied" into matching the page, which
    // fails OPEN on the same value for availability. Aligning them would either
    // cause an outage or mint a credential for an unverifiable account.
    standing = 'unknown';
    await run(() => submitConsent(VALID));
    expect(calls).toEqual(['redirect:/suspended']);
    expect(mockRecordConsent).not.toHaveBeenCalled();
    expect(mockIssueAuthCode).not.toHaveBeenCalled();
  });

  test('the standing check runs AFTER deny — a suspended user denying still just denies', async () => {
    standing = 'suspended';
    await run(() => submitConsent({ ...VALID, decision: 'deny' }));
    expect(calls[0]).toContain('error=access_denied');
    expect(calls).not.toContain('redirect:/suspended');
  });
});
