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
