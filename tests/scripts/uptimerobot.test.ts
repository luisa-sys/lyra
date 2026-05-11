/**
 * KAN-163 unit tests for the UptimeRobot bootstrap library. Pure-function
 * tests for the diff planners + a fetch-mock smoke test for the client.
 */

import {
  ALERT_CONTACT_TYPE,
  FIVE_MINUTES,
  LYRA_MONITORS,
  makeClient,
  makeFormBody,
  planContactDiff,
  planMonitorDiff,
  type HttpClient,
  type MockResponse,
} from '../../scripts/uptimerobot/lib';

describe('makeFormBody', () => {
  test('encodes simple key/values', () => {
    expect(makeFormBody({ a: 1, b: 'hello' })).toBe('a=1&b=hello');
  });

  test('skips null and undefined', () => {
    expect(makeFormBody({ a: 1, b: null, c: undefined, d: 0 })).toBe('a=1&d=0');
  });

  test('url-encodes special characters', () => {
    expect(makeFormBody({ url: 'https://example.com/?q=1&r=2' }))
      .toBe('url=https%3A%2F%2Fexample.com%2F%3Fq%3D1%26r%3D2');
  });
});

describe('LYRA_MONITORS canonical list', () => {
  test('contains exactly 7 monitors covering all environments + MCP', () => {
    expect(LYRA_MONITORS.length).toBe(7);
  });

  test('every monitor has a friendlyName and an https url', () => {
    for (const m of LYRA_MONITORS) {
      expect(m.friendlyName).toMatch(/^Lyra /);
      expect(m.url).toMatch(/^https:\/\//);
    }
  });

  test('covers prod, beta, stage, dev, prod-mcp, dev-mcp', () => {
    // Substring `toContain` rather than unanchored regex matchers — CodeQL
    // flags regex-on-URL patterns as high security-severity (the pattern
    // could match attacker-controlled hosts if lifted into production input
    // validation). toContain has no regex semantics so it can't be misused.
    const urls = LYRA_MONITORS.map((m) => m.url);
    expect(urls).toContain('https://checklyra.com/');
    expect(urls).toContain('https://beta.checklyra.com/');
    expect(urls).toContain('https://stage.checklyra.com/');
    expect(urls).toContain('https://dev.checklyra.com/');
    expect(urls).toContain('https://mcp.checklyra.com/health');
    expect(urls).toContain('https://mcp-dev.checklyra.com/health');
  });

  test('canonical list is frozen — runtime mutation rejected', () => {
    expect(() => {
      // Cast away readonly to attempt a real mutation; Object.freeze should reject.
      (LYRA_MONITORS as unknown as Array<{ friendlyName: string; url: string }>).push({
        friendlyName: 'rogue',
        url: 'https://x',
      });
    }).toThrow();
  });
});

describe('planMonitorDiff', () => {
  test('marks all monitors for create when account is empty', () => {
    const out = planMonitorDiff([], LYRA_MONITORS);
    expect(out.toCreate.length).toBe(LYRA_MONITORS.length);
    expect(out.unchanged.length).toBe(0);
    expect(out.toUpdate.length).toBe(0);
  });

  test('matches by friendly_name and reports unchanged when url already correct', () => {
    const existing = LYRA_MONITORS.map((m, i) => ({
      id: 1000 + i,
      friendly_name: m.friendlyName,
      url: m.url,
    }));
    const out = planMonitorDiff(existing, LYRA_MONITORS);
    expect(out.toCreate).toEqual([]);
    expect(out.toUpdate).toEqual([]);
    expect(out.unchanged.length).toBe(LYRA_MONITORS.length);
  });

  test('flags url drift via toUpdate (manual review) instead of silent overwrite', () => {
    const drifted = [
      {
        id: 42,
        friendly_name: 'Lyra prod — checklyra.com',
        url: 'https://wrong.example.com/',
      },
    ];
    const out = planMonitorDiff(drifted, LYRA_MONITORS);
    expect(out.toUpdate).toHaveLength(1);
    expect(out.toUpdate[0]).toMatchObject({
      id: 42,
      friendlyName: 'Lyra prod — checklyra.com',
      currentUrl: 'https://wrong.example.com/',
      desiredUrl: 'https://checklyra.com/',
      reason: 'url-mismatch',
    });
  });
});

describe('planContactDiff', () => {
  test('case-insensitive match on email value', () => {
    const out = planContactDiff(
      [{ id: 5, type: ALERT_CONTACT_TYPE.EMAIL, value: 'Luisa@Santos-Stephens.COM', status: 2 }],
      ['luisa@santos-stephens.com', 'ben@santos-stephens.com']
    );
    expect(out.present.map((p) => p.id)).toEqual([5]);
    expect(out.toCreate.map((c) => c.value)).toEqual(['ben@santos-stephens.com']);
  });

  test('ignores non-email contact types', () => {
    const out = planContactDiff(
      [{ id: 7, type: ALERT_CONTACT_TYPE.WEBHOOK, value: 'luisa@santos-stephens.com', status: 2 }],
      ['luisa@santos-stephens.com']
    );
    expect(out.present).toEqual([]);
    expect(out.toCreate).toEqual([{ value: 'luisa@santos-stephens.com' }]);
  });
});

describe('makeClient', () => {
  function makeMockResponse(body: unknown, ok = true, status = 200): MockResponse {
    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      json: async () => body,
    };
  }

  test('throws when no api key', () => {
    expect(() => makeClient({})).toThrow(/UPTIMEROBOT_API_KEY/);
  });

  test('sends api_key + format=json on every call and parses ok response', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const httpClient: HttpClient = async (url, init) => {
      calls.push({ url, body: init.body });
      return makeMockResponse({ stat: 'ok', account: { email: 'luisa@santos-stephens.com' } });
    };
    const client = makeClient({ apiKey: 'ur-test', httpClient });
    const out = await client.getAccountDetails();
    expect(out.account.email).toBe('luisa@santos-stephens.com');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.uptimerobot.com/v2/getAccountDetails');
    const params = new URLSearchParams(calls[0].body);
    expect(params.get('api_key')).toBe('ur-test');
    expect(params.get('format')).toBe('json');
  });

  test('throws on stat=fail (preserves the API error message)', async () => {
    const httpClient: HttpClient = async () =>
      makeMockResponse({ stat: 'fail', error: { type: 'invalid_parameter', message: 'api_key invalid' } });
    const client = makeClient({ apiKey: 'ur-bad', httpClient });
    await expect(client.getAccountDetails()).rejects.toThrow(/api_key invalid/);
  });

  test('throws on non-2xx HTTP', async () => {
    const httpClient: HttpClient = async () => makeMockResponse({}, false, 503);
    const client = makeClient({ apiKey: 'ur-test', httpClient });
    await expect(client.getMonitors()).rejects.toThrow(/HTTP 503/);
  });

  test('newMonitor passes our defaults (5-min interval, ssl_expiration_reminder=1)', async () => {
    let captured = '';
    const httpClient: HttpClient = async (_url, init) => {
      captured = init.body;
      return makeMockResponse({ stat: 'ok', monitor: { id: 999 } });
    };
    const client = makeClient({ apiKey: 'ur-test', httpClient });
    await client.newMonitor({
      friendlyName: 'test',
      url: 'https://example.com/',
      alertContacts: '5_0_0',
    });
    const params = new URLSearchParams(captured);
    expect(params.get('interval')).toBe(String(FIVE_MINUTES));
    expect(params.get('ssl_expiration_reminder')).toBe('1');
    expect(params.get('alert_contacts')).toBe('5_0_0');
    expect(params.get('type')).toBe('1'); // HTTP
  });
});
