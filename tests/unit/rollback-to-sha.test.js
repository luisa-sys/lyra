/**
 * BUGS-9: SHA-verified rollback — pure-logic tests.
 *
 * Drives the Python helper functions in scripts/rollback-to-sha.py via
 * a `python3 -c` subprocess. Covers the parsing layer (find_target,
 * parse_current_sha, format_summary) — the network calls in main() are
 * exercised manually against the real Vercel API.
 *
 * The bug this guards against: the previous parser silently returned
 * "NONE" on shape mismatch and the workflow happily promoted "NONE",
 * producing a false-positive "rolled back successfully" message. Every
 * branch below ensures find_target either returns the right deployment
 * or returns None — never a misleading sentinel string.
 */
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'rollback-to-sha.py');

function callPyFunction(funcName, args) {
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("rollback_to_sha", "${SCRIPT}")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
fn = getattr(mod, "${funcName}")
parsed = json.loads(sys.stdin.read())
result = fn(*parsed)
print(json.dumps(result))
`;
  const r = spawnSync('python3', ['-c', script], {
    input: JSON.stringify(args),
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(`python failed: ${r.stderr}`);
  }
  return JSON.parse(r.stdout);
}

describe('rollback-to-sha.py — find_target', () => {
  test('returns the deployment with matching meta.githubCommitSha', () => {
    const response = {
      deployments: [
        { uid: 'dpl_a', url: 'lyra-a.vercel.app', meta: { githubCommitSha: 'aaa111' } },
        { uid: 'dpl_b', url: 'lyra-b.vercel.app', meta: { githubCommitSha: 'bbb222' } },
      ],
    };
    const result = callPyFunction('find_target', [response, 'bbb222']);
    expect(result).not.toBeNull();
    expect(result.uid).toBe('dpl_b');
  });

  test('returns null when no deployment matches', () => {
    const response = {
      deployments: [
        { uid: 'dpl_a', meta: { githubCommitSha: 'aaa111' } },
      ],
    };
    expect(callPyFunction('find_target', [response, 'zzz999'])).toBeNull();
  });

  test('returns null on empty deployments list', () => {
    expect(callPyFunction('find_target', [{ deployments: [] }, 'aaa111'])).toBeNull();
  });

  test('returns null on missing deployments key', () => {
    expect(callPyFunction('find_target', [{}, 'aaa111'])).toBeNull();
  });

  test('handles deployments with missing meta gracefully', () => {
    const response = {
      deployments: [
        { uid: 'dpl_no_meta' },
        { uid: 'dpl_null_meta', meta: null },
        { uid: 'dpl_match', meta: { githubCommitSha: 'aaa111' } },
      ],
    };
    expect(callPyFunction('find_target', [response, 'aaa111']).uid).toBe('dpl_match');
  });

  test('does not match an empty target SHA against deployments with no SHA', () => {
    const response = {
      deployments: [
        { uid: 'dpl_no_sha', meta: {} },
      ],
    };
    expect(callPyFunction('find_target', [response, ''])).toBeNull();
  });

  test('regression: never returns a string sentinel ("NONE", "null", etc.)', () => {
    // The original bug printed the literal string "NONE" when the parser
    // failed, which the workflow then promoted as a deployment URL. This
    // test guards against any caller assuming a sentinel.
    const response = { deployments: [] };
    const result = callPyFunction('find_target', [response, 'aaa111']);
    expect(result).toBeNull();
    expect(typeof result).not.toBe('string');
  });
});

describe('rollback-to-sha.py — parse_current_sha', () => {
  test('returns the most recent production deployment SHA', () => {
    const response = {
      deployments: [
        { uid: 'dpl_newest', meta: { githubCommitSha: 'newest_sha' } },
        { uid: 'dpl_older', meta: { githubCommitSha: 'older_sha' } },
      ],
    };
    expect(callPyFunction('parse_current_sha', [response])).toBe('newest_sha');
  });

  test('returns null on empty list', () => {
    expect(callPyFunction('parse_current_sha', [{ deployments: [] }])).toBeNull();
  });

  test('returns null when meta.githubCommitSha is missing', () => {
    const response = { deployments: [{ uid: 'dpl_a', meta: {} }] };
    expect(callPyFunction('parse_current_sha', [response])).toBeNull();
  });

  test('returns null when meta is null', () => {
    const response = { deployments: [{ uid: 'dpl_a', meta: null }] };
    expect(callPyFunction('parse_current_sha', [response])).toBeNull();
  });
});

describe('rollback-to-sha.py — format_summary', () => {
  test('includes the target SHA, deployment uid, and url', () => {
    const summary = callPyFunction('format_summary', [
      'abc123def456',
      'dpl_xyz',
      'lyra-xyz.vercel.app',
    ]);
    expect(summary).toContain('Auto-Rollback Executed');
    expect(summary).toContain('abc123de');
    expect(summary).toContain('dpl_xyz');
    expect(summary).toContain('lyra-xyz.vercel.app');
    expect(summary).toContain('Verified');
  });
});

/**
 * The 409 branch (2026-08-09).
 *
 * Auto-rollback failed 3/3 recent production promotes with a Vercel 409, and
 * the reason was not a rollback bug: the rollback was firing on promotes whose
 * deploy never ran (sitting at `waiting` for the SEC-106 required reviewer), so
 * production had never moved off the pre-merge SHA. "Roll back" then meant
 * "promote the deployment that is already live", which Vercel rejects.
 *
 * Rolling back to where production already is, is a NO-OP — and a no-op
 * reported as a failure produced a red rollback alert on a production that was
 * never at risk. The expensive part is not the red tick; it is that it teaches
 * everyone to distrust the rollback alert.
 *
 * Both directions are pinned below, because "treat 409 as success" on its own
 * would be exactly the false-green this repo keeps finding: a 409 while
 * production serves something OTHER than the target is a REAL rollback failure
 * and must stay red.
 */
function runMainWithStubbedHttp({ promoteStatus, liveSha, targetSha }) {
  const script = `
import importlib.util, json, os, sys, urllib.error, io
spec = importlib.util.spec_from_file_location("rollback_to_sha", "${SCRIPT}")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

TARGET = ${JSON.stringify(targetSha)}
LIVE   = ${JSON.stringify(liveSha)}

def fake_list(token, project_id, team_id, limit=20):
    return {"deployments": [
        {"uid": "dpl_live", "url": "live.vercel.app", "readyState": "READY",
         "meta": {"githubCommitSha": LIVE}},
        {"uid": "dpl_target", "url": "target.vercel.app", "readyState": "READY",
         "meta": {"githubCommitSha": TARGET}},
    ]}

def fake_promote(token, team_id, uid):
    raise urllib.error.HTTPError(
        "https://api.vercel.com/promote", ${promoteStatus}, "Conflict", {},
        io.BytesIO(b'{"error":{"code":"conflict"}}'))

mod.list_production_deployments = fake_list
mod.promote_deployment = fake_promote

os.environ.update(TARGET_SHA=TARGET, VERCEL_TOKEN="t",
                  VERCEL_ORG_ID="team", VERCEL_PROJECT_ID="prj")
sys.exit(mod.main())
`;
  return spawnSync('python3', ['-c', script], { encoding: 'utf8' });
}

describe('rollback-to-sha.py — 409 handling', () => {
  const TARGET = 'a'.repeat(40);

  test('409 while production ALREADY serves the target exits 0 — nothing to undo', () => {
    const r = runMainWithStubbedHttp({
      promoteStatus: 409,
      liveSha: TARGET, // production never moved
      targetSha: TARGET,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/already the live production deployment/);
    expect(r.stdout).toMatch(/nothing\s+to\s+undo|nothing to undo/i);
  });

  test('409 while production serves something ELSE stays a REAL failure', () => {
    // The inverse. Without this, "treat 409 as success" would silently swallow
    // a genuine inability to roll production back — the worst possible
    // false-green, on the one control that exists for when things go wrong.
    const r = runMainWithStubbedHttp({
      promoteStatus: 409,
      liveSha: 'b'.repeat(40), // production is on a DIFFERENT sha
      targetSha: TARGET,
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/real rollback failure/i);
  });

  test('a non-409 promote error is still a failure', () => {
    const r = runMainWithStubbedHttp({
      promoteStatus: 500,
      liveSha: TARGET,
      targetSha: TARGET,
    });
    expect(r.status).toBe(1);
  });
});
