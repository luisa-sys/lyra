/**
 * KAN-165: tests for scripts/dashboard-shapers.py.
 *
 * The shapers are the load-bearing piece of the new dashboard sections.
 * Each test invokes the CLI in a subprocess with a JSON payload on stdin
 * and asserts the markdown body + `section-<N>=<status>` line are correct.
 *
 * Per the test-integrity policy: these tests are exercising the pure
 * data-shaping logic only. The actual API fetches happen in the workflow
 * and are surfaced through these shapers via the `error` / `skipped_reason`
 * fields, which we also test here.
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, '../../scripts/dashboard-shapers.py');

function run(shape, payload) {
  const json = JSON.stringify(payload);
  let result;
  try {
    const out = execFileSync('python3', [SCRIPT, shape], {
      input: json,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    result = { exitCode: 0, stdout: out, stderr: '' };
  } catch (err) {
    result = {
      exitCode: err.status ?? 1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
    };
  }
  // The shapers write `section-<N>=<status>` to stderr. execFileSync's
  // success path doesn't expose stderr, so for ok paths we re-run with
  // a try block. The simpler approach: assert the markdown body in
  // stdout and assert the status line by parsing it out of stderr when
  // available. For test purposes we run python3 separately for the
  // status check.
  return result;
}

function runCapturingStderr(shape, payload) {
  // Spawn synchronously, capturing both streams via inheritable fds.
  const { spawnSync } = require('node:child_process');
  const r = spawnSync('python3', [SCRIPT, shape], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
  });
  return {
    exitCode: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
  };
}

describe('dashboard-shapers.py — release_cadence', () => {
  test('green when drift is green and tag date is recent', () => {
    const today = new Date();
    today.setDate(today.getDate() - 2);
    const r = runCapturingStderr('release_cadence', {
      latest_tag: 'v0.1.40',
      latest_tag_date: today.toISOString(),
      drift: {
        commits_ahead: '2',
        days_since_last_commit: '1',
        status: 'green',
      },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/## 15. Release Cadence/);
    expect(r.stdout).toMatch(/v0\.1\.40/);
    expect(r.stdout).toMatch(/🟢 green/);
    expect(r.stderr).toMatch(/section-15=ok/);
  });

  test('partial:drift-red when drift status is red', () => {
    const r = runCapturingStderr('release_cadence', {
      latest_tag: 'v0.1.20',
      latest_tag_date: '2026-03-01T00:00:00Z',
      drift: {
        commits_ahead: '40',
        days_since_last_commit: '15',
        status: 'red',
      },
    });
    expect(r.stdout).toMatch(/🔴 red/);
    expect(r.stderr).toMatch(/section-15=partial:drift-red/);
  });

  test('failed:drift-data-unavailable when drift status is unknown', () => {
    const r = runCapturingStderr('release_cadence', {
      latest_tag: 'v0.1.40',
      latest_tag_date: '',
      drift: {
        commits_ahead: 'DATA_UNAVAILABLE',
        days_since_last_commit: 'DATA_UNAVAILABLE',
        status: 'unknown',
      },
    });
    expect(r.stderr).toMatch(/section-15=failed:drift-data-unavailable/);
  });
});

describe('dashboard-shapers.py — in_flight', () => {
  test('renders a sorted table by age (oldest first)', () => {
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 86400_000).toISOString();
    const twoDaysAgo = new Date(now.getTime() - 2 * 86400_000).toISOString();
    const r = runCapturingStderr('in_flight', {
      issues: [
        {
          key: 'KAN-100',
          fields: {
            summary: 'newer ticket',
            updated: twoDaysAgo,
            assignee: { displayName: 'Luisa' },
          },
        },
        {
          key: 'KAN-50',
          fields: {
            summary: 'older ticket',
            updated: tenDaysAgo,
            assignee: null,
          },
        },
      ],
    });
    expect(r.exitCode).toBe(0);
    // Older should appear before newer in the table body.
    const olderIdx = r.stdout.indexOf('KAN-50');
    const newerIdx = r.stdout.indexOf('KAN-100');
    expect(olderIdx).toBeGreaterThan(0);
    expect(newerIdx).toBeGreaterThan(olderIdx);
    expect(r.stdout).toMatch(/Unassigned/);
    expect(r.stderr).toMatch(/section-16=ok/);
  });

  test('ok with empty issues list', () => {
    const r = runCapturingStderr('in_flight', { issues: [] });
    expect(r.stdout).toMatch(/No tickets currently In Progress/);
    expect(r.stderr).toMatch(/section-16=ok/);
  });

  test('failed when error field is set', () => {
    const r = runCapturingStderr('in_flight', {
      error: 'JQL returned 403',
    });
    expect(r.stdout).toMatch(/DATA UNAVAILABLE — JQL returned 403/);
    expect(r.stderr).toMatch(/section-16=failed:jira-fetch:/);
  });

  test('failed when issues key is missing entirely', () => {
    const r = runCapturingStderr('in_flight', {});
    expect(r.stdout).toMatch(/DATA UNAVAILABLE/);
    expect(r.stderr).toMatch(/section-16=failed:jira-issues-key-missing/);
  });

  test('parses Jira no-colon timezone offset (e.g. +0000)', () => {
    // Jira returns timestamps like "2026-05-01T00:00:00.000+0000" —
    // Python <3.11's fromisoformat refuses that without normalization.
    // Lock in that we handle this format and compute the correct age.
    const ageDays = 7;
    const target = new Date(Date.now() - ageDays * 86400_000);
    // Build a Jira-style no-colon offset string.
    const isoPlain = target.toISOString();
    const jiraStyle = isoPlain.replace(/\.\d+Z$/, '.000+0000');
    const r = runCapturingStderr('in_flight', {
      issues: [
        {
          key: 'KAN-77',
          fields: {
            summary: 'jira-format check',
            updated: jiraStyle,
            assignee: { displayName: 'Luisa' },
          },
        },
      ],
    });
    expect(r.exitCode).toBe(0);
    // Should compute age ~7 days, not 0 (which would indicate parse-failure).
    expect(r.stdout).toMatch(/oldest is [67] day\(s\)/);
    expect(r.stderr).toMatch(/section-16=ok/);
  });
});

describe('dashboard-shapers.py — pr_queue', () => {
  test('groups PRs by base, counts draft vs ready, dependabot vs human', () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400_000).toISOString();
    const r = runCapturingStderr('pr_queue', {
      pulls: [
        {
          number: 1,
          title: 'A',
          base: { ref: 'develop' },
          draft: false,
          created_at: fiveDaysAgo,
          user: { login: 'luisa-sys' },
        },
        {
          number: 2,
          title: 'B',
          base: { ref: 'develop' },
          draft: true,
          created_at: fiveDaysAgo,
          user: { login: 'dependabot[bot]' },
        },
        {
          number: 3,
          title: 'C',
          base: { ref: 'main' },
          draft: false,
          created_at: fiveDaysAgo,
          user: { login: 'luisa-sys' },
        },
      ],
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/Total open:\*\* 3/);
    expect(r.stdout).toMatch(/2 ready \/ 1 draft/);
    expect(r.stdout).toMatch(/2 human \/ 1 dependabot/);
    expect(r.stdout).toMatch(/`develop` \| 2/);
    expect(r.stdout).toMatch(/`main` \| 1/);
    expect(r.stderr).toMatch(/section-17=ok/);
  });

  test('ok with empty pulls list', () => {
    const r = runCapturingStderr('pr_queue', { pulls: [] });
    expect(r.stdout).toMatch(/No open pull requests/);
    expect(r.stderr).toMatch(/section-17=ok/);
  });

  test('failed when error field is set', () => {
    const r = runCapturingStderr('pr_queue', { error: 'gh api 502' });
    expect(r.stdout).toMatch(/DATA UNAVAILABLE — gh api 502/);
    expect(r.stderr).toMatch(/section-17=failed:pr-fetch:/);
  });
});

describe('dashboard-shapers.py — ci_flakiness', () => {
  test('computes success rate and flags <80% as partial', () => {
    // pr-checks: 1 success, 4 failure → 20% → flaky
    // deploy-dev: 5 success → 100%
    const runs = [];
    for (let i = 0; i < 4; i++) runs.push({ name: 'pr-checks', conclusion: 'failure' });
    runs.push({ name: 'pr-checks', conclusion: 'success' });
    for (let i = 0; i < 5; i++) runs.push({ name: 'deploy-dev', conclusion: 'success' });
    const r = runCapturingStderr('ci_flakiness', { runs });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/pr-checks/);
    expect(r.stdout).toMatch(/deploy-dev/);
    expect(r.stdout).toMatch(/⚠️ 20%/);
    expect(r.stdout).toMatch(/100%/);
    expect(r.stderr).toMatch(/section-18=partial:flaky-workflows/);
  });

  test('ok when every workflow ≥ 80%', () => {
    const runs = [
      { name: 'pr-checks', conclusion: 'success' },
      { name: 'pr-checks', conclusion: 'success' },
      { name: 'pr-checks', conclusion: 'success' },
      { name: 'pr-checks', conclusion: 'success' },
      { name: 'pr-checks', conclusion: 'failure' },
    ];
    const r = runCapturingStderr('ci_flakiness', { runs });
    expect(r.stderr).toMatch(/section-18=ok/);
  });

  test('partial:no-runs when window is empty', () => {
    const r = runCapturingStderr('ci_flakiness', { runs: [] });
    expect(r.stderr).toMatch(/section-18=partial:no-runs-in-window/);
  });
});

describe('dashboard-shapers.py — mcp_health', () => {
  test('renders monitors with up status', () => {
    const r = runCapturingStderr('mcp_health', {
      monitors: [
        { friendly_name: 'mcp.checklyra.com', status: 2, all_time_uptime_ratio: '99.97' },
        { friendly_name: 'mcp-dev.checklyra.com', status: 2, all_time_uptime_ratio: '99.50' },
      ],
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/✅ up/);
    expect(r.stdout).toMatch(/99\.97%/);
    expect(r.stderr).toMatch(/section-19=ok/);
  });

  test('partial:monitor-down when any monitor is seems-down or down', () => {
    const r = runCapturingStderr('mcp_health', {
      monitors: [
        { friendly_name: 'mcp.checklyra.com', status: 9, all_time_uptime_ratio: '95.00' },
      ],
    });
    expect(r.stdout).toMatch(/❌ down/);
    expect(r.stderr).toMatch(/section-19=partial:monitor-down/);
  });

  test('unavailable when skipped_reason is set (no API key)', () => {
    const r = runCapturingStderr('mcp_health', {
      skipped_reason: 'UPTIMEROBOT_API_KEY secret not configured',
    });
    expect(r.stdout).toMatch(/DATA UNAVAILABLE — UPTIMEROBOT_API_KEY secret not configured/);
    expect(r.stderr).toMatch(/section-19=unavailable:UPTIMEROBOT_API_KEY/);
  });

  test('failed when error is set', () => {
    const r = runCapturingStderr('mcp_health', { error: 'http 500' });
    expect(r.stderr).toMatch(/section-19=failed:uptimerobot-fetch:/);
  });
});

describe('dashboard-shapers.py — cost_spotcheck', () => {
  test('renders mixed available/unavailable providers', () => {
    const r = runCapturingStderr('cost_spotcheck', {
      providers: {
        Vercel: { available: true, detail: 'Hobby plan — within free tier' },
        Supabase: { available: false, detail: 'SUPABASE_MANAGEMENT_TOKEN not set' },
      },
    });
    expect(r.stdout).toMatch(/Vercel \| ✅ ok/);
    expect(r.stdout).toMatch(/Supabase \| ⚠️ DATA UNAVAILABLE/);
    expect(r.stderr).toMatch(/section-20=partial:some-cost-providers-unavailable/);
  });

  test('ok when all providers available', () => {
    const r = runCapturingStderr('cost_spotcheck', {
      providers: {
        Vercel: { available: true, detail: 'ok' },
      },
    });
    expect(r.stderr).toMatch(/section-20=ok/);
  });

  test('unavailable when no providers configured', () => {
    const r = runCapturingStderr('cost_spotcheck', { providers: {} });
    expect(r.stderr).toMatch(/section-20=unavailable:no-providers-configured/);
  });
});

describe('dashboard-shapers.py — CLI error paths', () => {
  test('exits 2 on unknown shape name', () => {
    const r = runCapturingStderr('not_a_real_shape', {});
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/Usage/);
  });

  test('exits 1 and emits failed status when stdin is malformed JSON', () => {
    const { spawnSync } = require('node:child_process');
    const r = spawnSync('python3', [SCRIPT, 'in_flight'], {
      input: 'not-json',
      encoding: 'utf-8',
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/DATA UNAVAILABLE — payload was not valid JSON/);
    expect(r.stderr).toMatch(/section-16=failed:invalid-json/);
  });
});
