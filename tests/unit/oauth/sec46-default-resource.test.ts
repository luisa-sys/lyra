/**
 * SEC-46 — the DEFAULT resource, for every environment rather than the one it
 * was developed on.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Phase C shipped `allowedResources()` with the default derived as
 * `siteUrl().replace('://', '://mcp-')`. That is correct for dev
 * (`dev.checklyra.com` -> `mcp-dev.checklyra.com`) and wrong for every other
 * environment: production produced `mcp-checklyra.com`, a host that does not
 * exist, and beta produced `mcp-beta.checklyra.com` when beta shares
 * production's MCP server.
 *
 * It was caught by enumerating the environments instead of the one under the
 * cursor. The lesson is the general one — a rule that happens to hold on the
 * environment you develop against will look correct until it reaches the ones
 * you cannot see — so these tests are written as a TABLE over all four
 * deployments plus the preview case, not as a spot check.
 *
 * WHY IT MATTERED MORE THAN A COSMETIC WRONG STRING
 * -------------------------------------------------
 * An unknown `resource` is rejected with `invalid_target` by design, and the
 * MCP authorization spec requires clients to SEND `resource`. So on production
 * a spec-compliant client presenting the genuine
 * `https://mcp.checklyra.com/mcp` would have been refused, breaking the OAuth
 * flow outright — a regression introduced by the change meant to harden it,
 * since `resource` was previously ignored altogether. Separately, every token
 * minted without an explicit `resource` would have carried a bogus `aud` and
 * 401-ed the moment `OAUTH_AUDIENCE_CHECK` was turned on.
 */

import { defaultResourceForSite, oauthConfig } from '@/modules/oauth-as/lib/config';

const PROD_MCP = 'https://mcp.checklyra.com/mcp';
const DEV_MCP = 'https://mcp-dev.checklyra.com/mcp';

describe('SEC-46 — default resource per deployed environment', () => {
  // The whole point is coverage of every environment, so the corpus is asserted
  // non-empty and complete before it is iterated (catalogue failure mode 4).
  const CASES: ReadonlyArray<readonly [string, string, string]> = [
    ['prod', 'https://checklyra.com', PROD_MCP],
    ['prod (www)', 'https://www.checklyra.com', PROD_MCP],
    // Beta shares production's MCP server AND its Supabase project. This is the
    // case no string transform can produce, and the reason the map exists.
    ['beta', 'https://beta.checklyra.com', PROD_MCP],
    ['dev', 'https://dev.checklyra.com', DEV_MCP],
    ['staging', 'https://stage.checklyra.com', 'https://mcp-stage.checklyra.com/mcp'],
  ];

  test('the case table covers every deployed environment', () => {
    expect(CASES.length).toBe(5);
    const envs = CASES.map(([name]) => name);
    expect(envs).toEqual(expect.arrayContaining(['prod', 'beta', 'dev', 'staging']));
  });

  test.each(CASES)('%s resolves to its REAL MCP resource', (_name, site, expected) => {
    expect(defaultResourceForSite(site)).toBe(expected);
  });

  test('production does NOT resolve to the mcp- prefixed host that never existed', () => {
    // The exact defect. Pinned by value so a reintroduced transform fails here
    // rather than only showing up as a 401 after the audience flip.
    expect(defaultResourceForSite('https://checklyra.com')).not.toBe(
      'https://mcp-checklyra.com/mcp'
    );
  });

  test('beta does NOT get its own MCP host — it shares production’s', () => {
    expect(defaultResourceForSite('https://beta.checklyra.com')).not.toBe(
      'https://mcp-beta.checklyra.com/mcp'
    );
    expect(defaultResourceForSite('https://beta.checklyra.com')).toBe(
      defaultResourceForSite('https://checklyra.com')
    );
  });

  test('a trailing slash on the site URL does not change the answer', () => {
    expect(defaultResourceForSite('https://checklyra.com/')).toBe(PROD_MCP);
  });

  test('an unknown host (a Vercel preview) falls towards DEV, never production', () => {
    // A preview build runs against the dev Supabase project, so dev is the only
    // MCP whose api_keys table could recognise it. Falling towards production
    // would hand out a production-bound token from an unreviewed deployment.
    expect(defaultResourceForSite('https://lyra-git-somebranch.vercel.app')).toBe(DEV_MCP);
  });

  test('an unparseable site URL falls towards DEV rather than throwing', () => {
    expect(defaultResourceForSite('not a url')).toBe(DEV_MCP);
  });
});

describe('SEC-46 — the env var is the authority, the map is only the fallback', () => {
  const prev = process.env.OAUTH_ALLOWED_RESOURCES;
  afterEach(() => {
    if (prev === undefined) delete process.env.OAUTH_ALLOWED_RESOURCES;
    else process.env.OAUTH_ALLOWED_RESOURCES = prev;
  });

  test('OAUTH_ALLOWED_RESOURCES overrides the built-in default entirely', () => {
    process.env.OAUTH_ALLOWED_RESOURCES = 'https://mcp.example.test/mcp';
    expect(oauthConfig.allowedResources()).toEqual(['https://mcp.example.test/mcp']);
    expect(oauthConfig.defaultResource()).toBe('https://mcp.example.test/mcp');
  });

  test('multiple configured resources are all honoured, first one is the default', () => {
    process.env.OAUTH_ALLOWED_RESOURCES =
      'https://mcp.checklyra.com/mcp, https://admin-mcp.checklyra.com/mcp';
    expect(oauthConfig.allowedResources()).toEqual([
      'https://mcp.checklyra.com/mcp',
      'https://admin-mcp.checklyra.com/mcp',
    ]);
    expect(oauthConfig.defaultResource()).toBe('https://mcp.checklyra.com/mcp');
  });

  test('an UNSET env var still yields exactly one concrete resource, never empty', () => {
    // An empty allow-list would reject every `resource` a client could send.
    delete process.env.OAUTH_ALLOWED_RESOURCES;
    const resources = oauthConfig.allowedResources();
    expect(resources.length).toBeGreaterThan(0);
    expect(resources.every((r) => r.startsWith('https://'))).toBe(true);
    expect(oauthConfig.defaultResource()).toBe(resources[0]);
  });
});
