/**
 * Tests for the `is_phantom` classification logic in
 * scripts/cleanup-phantom-check-suites.py.
 *
 * The script is Python but we drive it through Node by spawning python3
 * and feeding fixtures via stdin / argv. Keeps the tests in one place
 * (the existing tests/scripts/ pattern) and ensures the classifier
 * doesn't accidentally start flagging real check_suites as phantoms.
 *
 * If python3 isn't on PATH, the suite skips itself rather than failing
 * — local DX over CI strictness, since CI always has python3.
 */

const { execSync, spawnSync } = require('node:child_process');
const { writeFileSync, unlinkSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { tmpdir } = require('node:os');

const SCRIPT = resolve(__dirname, '../../scripts/cleanup-phantom-check-suites.py');

function pythonAvailable() {
  try {
    execSync('python3 --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe the is_phantom function by writing a tiny Python harness that
 * imports it and prints JSON results. Keeps the test surface narrow:
 * we're checking the pure logic, not the GitHub API plumbing.
 */
function classifyAll(suites, targetApps = ['vercel']) {
  const harnessFile = resolve(tmpdir(), `phantom-harness-${Date.now()}.py`);
  // Embed the fixtures as JSON STRINGS that Python re-parses, so JSON
  // tokens like `null` / `true` / `false` don't collide with Python
  // identifiers (`None` / `True` / `False`).
  const suitesJson = JSON.stringify(JSON.stringify(suites));
  const appsJson = JSON.stringify(JSON.stringify(targetApps));
  const code = `
import json, sys
sys.path.insert(0, ${JSON.stringify(resolve(__dirname, '../../scripts'))})
from importlib.util import spec_from_file_location, module_from_spec
spec = spec_from_file_location("cleanup", ${JSON.stringify(SCRIPT)})
mod = module_from_spec(spec)
spec.loader.exec_module(mod)
suites = json.loads(${suitesJson})
apps = set(json.loads(${appsJson}))
print(json.dumps([mod.is_phantom(s, apps) for s in suites]))
`;
  writeFileSync(harnessFile, code);
  try {
    const out = spawnSync('python3', [harnessFile], { encoding: 'utf-8' });
    if (out.status !== 0) {
      throw new Error(`python harness failed: ${out.stderr}`);
    }
    return JSON.parse(out.stdout.trim());
  } finally {
    if (existsSync(harnessFile)) unlinkSync(harnessFile);
  }
}

const describeIfPython = pythonAvailable() ? describe : describe.skip;

describeIfPython('cleanup-phantom-check-suites — is_phantom classifier', () => {
  test('flags the canonical Vercel phantom (queued, 0 runs)', () => {
    const result = classifyAll([
      {
        app: { slug: 'vercel' },
        status: 'queued',
        latest_check_runs_count: 0,
      },
    ]);
    expect(result).toEqual([true]);
  });

  test('does NOT flag a completed Vercel suite', () => {
    const result = classifyAll([
      {
        app: { slug: 'vercel' },
        status: 'completed',
        conclusion: 'success',
        latest_check_runs_count: 1,
      },
    ]);
    expect(result).toEqual([false]);
  });

  test('does NOT flag an in_progress suite (real work is happening)', () => {
    const result = classifyAll([
      {
        app: { slug: 'vercel' },
        status: 'in_progress',
        latest_check_runs_count: 1,
      },
    ]);
    expect(result).toEqual([false]);
  });

  test('does NOT flag a queued suite from an app outside the target list', () => {
    // GitHub-Actions sometimes sits at status=queued for a moment before
    // creating runs. We don't want to spam rerequests at it.
    const result = classifyAll([
      {
        app: { slug: 'github-actions' },
        status: 'queued',
        latest_check_runs_count: 0,
      },
    ]);
    expect(result).toEqual([false]);
  });

  test('does flag a queued Supabase suite if Supabase is in target list', () => {
    // Supabase IS in the phantom-prone list historically (was fixed for
    // us in early May but may regress for someone else). Configurable
    // means flexible.
    const result = classifyAll(
      [
        {
          app: { slug: 'supabase' },
          status: 'queued',
          latest_check_runs_count: 0,
        },
      ],
      ['supabase'],
    );
    expect(result).toEqual([true]);
  });

  test('does NOT flag a queued Vercel suite that has at least 1 run', () => {
    // A queued suite WITH runs is just in-progress work. The phantom
    // pattern is specifically zero runs.
    const result = classifyAll([
      {
        app: { slug: 'vercel' },
        status: 'queued',
        latest_check_runs_count: 1,
      },
    ]);
    expect(result).toEqual([false]);
  });

  test('handles missing fields gracefully', () => {
    // Real API responses sometimes omit fields. Should not throw.
    const result = classifyAll([
      { app: null, status: 'queued', latest_check_runs_count: 0 },
      { app: { slug: 'vercel' } }, // missing status + count
    ]);
    expect(result).toEqual([false, false]);
  });
});
