const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../');
const SCRIPT = path.join(REPO_ROOT, 'scripts/smoke-tests.sh');

/**
 * BUGS-134 — the staging/dev "protected" checks must accept what Cloudflare
 * Access ACTUALLY returns to an unauthenticated browser-shaped request (a 302
 * to the team login page), without turning into a false PASS for a public
 * site (SEC-192) or for a redirect that goes anywhere else.
 *
 * curl is replaced by a fake on PATH that answers from env vars, so the test
 * never touches the network. FAKE_CODE/FAKE_LOCATION drive the staging/dev
 * URL, FAKE_PROD_CODE the production landing page; every other URL answers
 * healthy.
 */

const ACCESS_LOGIN = 'https://checklyra.cloudflareaccess.com/cdn-cgi/access/login';

let binDir;

beforeAll(() => {
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-fake-curl-'));
  const fake = `#!/usr/bin/env bash
FMT=""; URL=""
while [ $# -gt 0 ]; do
  case "$1" in
    -w) FMT="$2"; shift 2 ;;
    -A|-H|-d|-X|--max-time|-o) shift 2 ;;
    -*) shift ;;
    *) URL="$1"; shift ;;
  esac
done
case "$URL" in
  https://stage.checklyra.com*|https://dev.checklyra.com*) CODE="$FAKE_CODE"; LOC="\${FAKE_LOCATION:-}" ;;
  https://checklyra.com) CODE="\${FAKE_PROD_CODE:-200}"; LOC="" ;;
  *) CODE=200; LOC="" ;;
esac
if [ -n "$FMT" ]; then
  OUT="\${FMT//%\\{http_code\\}/$CODE}"
  OUT="\${OUT//%\\{redirect_url\\}/$LOC}"
  printf '%s' "$OUT"
else
  printf '%s' '{"serverInfo":{"name":"lyra-mcp-server"}}'
fi
`;
  fs.writeFileSync(path.join(binDir, 'curl'), fake, { mode: 0o755 });
});

afterAll(() => {
  fs.rmSync(binDir, { recursive: true, force: true });
});

function runEnv(env, code, location, prodCode = 200) {
  const r = spawnSync('bash', [SCRIPT, env], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      FAKE_CODE: String(code),
      FAKE_LOCATION: location || '',
      FAKE_PROD_CODE: String(prodCode),
      ADMIN_MCP_HEALTHCHECK_ENABLED: '',
    },
    encoding: 'utf8',
  });
  const line = r.stdout.split('\n').find((l) => l.includes('site (protected)')) || '';
  return { status: r.status, line, out: r.stdout + r.stderr };
}

describe.each([
  ['staging', 'stage.checklyra.com'],
  ['dev', 'dev.checklyra.com'],
])('%s protected-site check (BUGS-134)', (env, host) => {
  test('a 302 to Lyra’s own Access login for this host PASSES', () => {
    const r = runEnv(env, 302, `${ACCESS_LOGIN}/${host}?kid=abc&redirect_url=%2F`);
    expect(r.line).toContain('✓');
    expect(r.status).toBe(0);
  });

  test.each([401, 403])('a bare %i still PASSES', (code) => {
    const r = runEnv(env, code);
    expect(r.line).toContain('✓');
    expect(r.status).toBe(0);
  });

  test('a bare 200 FAILS — the site is public (SEC-192)', () => {
    const r = runEnv(env, 200);
    expect(r.line).toContain('✗');
    expect(r.status).toBe(1);
  });

  test.each([
    ['an app-level redirect', `https://${host}/login`],
    ['another Access team', `https://evil.cloudflareaccess.com/cdn-cgi/access/login/${host}`],
    ['Access login for a different host', `${ACCESS_LOGIN}/checklyra.com`],
    ['a host-prefix lookalike', `${ACCESS_LOGIN}/${host}.attacker.example`],
    ['no Location at all', ''],
  ])('a 302 to %s FAILS', (_label, location) => {
    const r = runEnv(env, 302, location);
    expect(r.line).toContain('✗');
    expect(r.status).toBe(1);
  });

  test('curl failing outright (000) FAILS', () => {
    const r = runEnv(env, '000');
    expect(r.line).toContain('✗');
    expect(r.status).toBe(1);
  });
});

describe('production landing-page check (BUGS-134)', () => {
  const landing = (code) => {
    const r = runEnv('production', 0, '', code);
    const line = r.out.split('\n').find((l) => l.includes('Landing page')) || '';
    return { ...r, line };
  };

  test.each([200, 503, 403])('%i PASSES (live / maintenance / bot-blocked)', (code) => {
    const r = landing(code);
    expect(r.line).toContain('✓');
    expect(r.status).toBe(0);
  });

  test.each([500, 404, '000'])('%s FAILS', (code) => {
    const r = landing(code);
    expect(r.line).toContain('✗');
    expect(r.status).toBe(1);
  });
});
