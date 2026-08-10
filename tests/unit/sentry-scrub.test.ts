/**
 * SEC-55: verify the Sentry scrubbing layer strips OAuth secrets / PII from
 * events and breadcrumbs before they ship. Acceptance: the enumerated keys are
 * removed from captured events and `/oauth/*` URLs are redacted.
 */
import {
  scrubSentryEvent,
  scrubSentryBreadcrumb,
  scrubUrl,
} from '@/modules/observability/sentry-scrub';

const SENSITIVE_KEYS = [
  'code',
  'code_verifier',
  'state',
  'refresh_token',
  'access_token',
  'client_secret',
  'token',
];

describe('scrubUrl', () => {
  it('redacts the entire query string on /oauth/* URLs', () => {
    const out = scrubUrl(
      'https://checklyra.com/oauth/token?code=abc123&code_verifier=xyz&state=nonce',
    );
    expect(out).toBe('https://checklyra.com/oauth/token?[Filtered]');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('xyz');
    expect(out).not.toContain('nonce');
  });

  it('redacts /api/convene/oauth/* URLs in full', () => {
    const out = scrubUrl('/api/convene/oauth/callback?code=secretcode&next=/home');
    expect(out).toBe('/api/convene/oauth/callback?[Filtered]');
    expect(out).not.toContain('secretcode');
  });

  it('drops only sensitive params on non-oauth URLs, keeping benign context', () => {
    const out = scrubUrl(
      'https://checklyra.com/search?q=teachers&access_token=leaked&page=2',
    );
    expect(out).not.toContain('leaked');
    expect(out).not.toContain('access_token');
    expect(out).toContain('q=teachers');
    expect(out).toContain('page=2');
  });

  it('leaves URLs without a query string untouched', () => {
    expect(scrubUrl('https://checklyra.com/oauth/authorize')).toBe(
      'https://checklyra.com/oauth/authorize',
    );
    expect(scrubUrl('/dashboard')).toBe('/dashboard');
  });

  it('is case-insensitive on param names', () => {
    const out = scrubUrl('/callback?Refresh_Token=x&keep=1');
    expect(out).not.toContain('x');
    expect(out).toContain('keep=1');
  });
});

describe('scrubSentryEvent — request URL / query / body', () => {
  it('redacts the request URL for an oauth token exchange', () => {
    const event = {
      request: {
        url: 'https://checklyra.com/oauth/token?code=authcode&client_secret=shh',
      },
    };
    const out = scrubSentryEvent(event)!;
    expect(out.request.url).toBe('https://checklyra.com/oauth/token?[Filtered]');
    expect(JSON.stringify(out)).not.toContain('authcode');
    expect(JSON.stringify(out)).not.toContain('shh');
  });

  it('removes every enumerated key from a JSON request body (object form)', () => {
    const event = {
      request: {
        url: '/api/convene/oauth/token',
        data: {
          grant_type: 'authorization_code',
          code: 'AUTH_CODE',
          code_verifier: 'PKCE_VERIFIER',
          refresh_token: 'RT',
          access_token: 'AT',
          client_secret: 'CS',
          token: 'TOK',
          state: 'STATE',
          redirect_uri: 'https://app/cb',
        },
      },
    };
    const out = scrubSentryEvent(event)!;
    const data = out.request.data as Record<string, unknown>;
    for (const key of SENSITIVE_KEYS) {
      expect(data).not.toHaveProperty(key);
    }
    // Benign fields survive.
    expect(data.grant_type).toBe('authorization_code');
    expect(data.redirect_uri).toBe('https://app/cb');
    // No secret value anywhere in the serialised event.
    const serialised = JSON.stringify(out);
    for (const secret of ['AUTH_CODE', 'PKCE_VERIFIER', 'RT', 'AT', 'CS', 'TOK', 'STATE']) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('scrubs a JSON string request body', () => {
    const event = {
      request: {
        data: JSON.stringify({ code: 'SECRET', foo: 'bar' }),
      },
    };
    const out = scrubSentryEvent(event)!;
    expect(out.request.data).not.toContain('SECRET');
    expect(out.request.data).toContain('bar');
  });

  it('strips sensitive params from request.query_string (raw string form)', () => {
    const event = {
      request: { query_string: 'code=SECRET&page=1&refresh_token=RT' },
    };
    const out = scrubSentryEvent(event)!;
    expect(out.request.query_string).not.toContain('SECRET');
    expect(out.request.query_string).not.toContain('RT');
    expect(out.request.query_string).toContain('page=1');
  });

  it('drops Authorization / Cookie headers wholesale', () => {
    const event = {
      request: {
        headers: {
          Authorization: 'Bearer leaked.jwt.token',
          Cookie: 'sb-access-token=leaked',
          'Content-Type': 'application/json',
          token: 'raw-token',
        },
      },
    };
    const out = scrubSentryEvent(event)!;
    const headers = out.request.headers as Record<string, unknown>;
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers).not.toHaveProperty('Cookie');
    expect(headers).not.toHaveProperty('token');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.stringify(out)).not.toContain('leaked');
  });

  it('scrubs nested secrets inside the body tree', () => {
    const event = {
      request: {
        data: { outer: { inner: { refresh_token: 'DEEP', keep: 'ok' } } },
      },
    };
    const out = scrubSentryEvent(event)!;
    const inner = (out.request.data as { outer: { inner: Record<string, unknown> } })
      .outer.inner;
    expect(inner).not.toHaveProperty('refresh_token');
    expect(inner.keep).toBe('ok');
  });
});

describe('scrubSentryEvent — breadcrumbs', () => {
  it('redacts oauth URLs in breadcrumb data + strips sensitive keys', () => {
    const event = {
      breadcrumbs: [
        {
          category: 'fetch',
          data: {
            url: 'https://checklyra.com/oauth/token?code=BCRUMB',
            access_token: 'AT_IN_CRUMB',
          },
        },
      ],
    };
    const out = scrubSentryEvent(event)!;
    const crumb = out.breadcrumbs[0] as { data: Record<string, unknown> };
    expect(crumb.data.url).toBe('https://checklyra.com/oauth/token?[Filtered]');
    expect(crumb.data).not.toHaveProperty('access_token');
    expect(JSON.stringify(out)).not.toContain('BCRUMB');
    expect(JSON.stringify(out)).not.toContain('AT_IN_CRUMB');
  });

  it('handles the { breadcrumbs: { values: [] } } envelope shape', () => {
    const event = {
      breadcrumbs: {
        values: [{ data: { url: '/search?token=SECRET&q=x' } }],
      },
    };
    const out = scrubSentryEvent(event)!;
    const crumb = out.breadcrumbs.values[0] as { data: Record<string, unknown> };
    expect(crumb.data.url).not.toContain('SECRET');
    expect(crumb.data.url).toContain('q=x');
  });
});

describe('scrubSentryBreadcrumb', () => {
  it('redacts a URL embedded in a breadcrumb message', () => {
    const bc = {
      category: 'xhr',
      message: 'GET https://checklyra.com/oauth/authorize?code=MSGCODE',
    };
    const out = scrubSentryBreadcrumb(bc)!;
    expect(out.message).not.toContain('MSGCODE');
    expect(out.message).toContain('[Filtered]');
  });

  it('scrubs sensitive keys in breadcrumb data', () => {
    const bc = { data: { client_secret: 'CS_CRUMB', ok: 1 } };
    const out = scrubSentryBreadcrumb(bc)!;
    expect(out.data).not.toHaveProperty('client_secret');
    expect(out.data.ok).toBe(1);
  });
});

describe('robustness', () => {
  it('returns null / undefined / primitives unchanged', () => {
    expect(scrubSentryEvent(null)).toBeNull();
    expect(scrubSentryEvent(undefined)).toBeUndefined();
    expect(scrubSentryBreadcrumb(null)).toBeNull();
    expect(scrubSentryEvent(42 as unknown)).toBe(42);
  });

  it('does not throw on an event with no request/breadcrumbs', () => {
    const event = { message: 'boom', level: 'error' };
    expect(() => scrubSentryEvent(event)).not.toThrow();
    expect(scrubSentryEvent(event)).toBe(event);
  });
});
