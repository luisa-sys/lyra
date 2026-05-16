/**
 * KAN-63-A: anomaly-detect.py classifier tests.
 *
 * Drives the pure-function entrypoints (`is_anomalous` and
 * `compare_window_against_baseline`) via a Python harness, same shape
 * as `cleanup-phantom-check-suites.test.js`. The harness writes a
 * tiny .py file that imports the script as a module and prints JSON.
 *
 * Skips automatically if python3 isn't on PATH so the broader unit
 * suite remains runnable on machines without python.
 */

const { execSync, spawnSync } = require('node:child_process');
const { writeFileSync, unlinkSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { tmpdir } = require('node:os');

const SCRIPT = resolve(__dirname, '../../scripts/anomaly-detect.py');

function pythonAvailable() {
  try {
    execSync('python3 --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function callPython(harnessSource) {
  const harnessFile = resolve(tmpdir(), `anomaly-harness-${Date.now()}-${Math.random()}.py`);
  writeFileSync(harnessFile, harnessSource);
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

/** Probe `is_anomalous(current, mean, stddev)` */
function isAnomalous(current, mean, stddev, sigma = 3.0) {
  return callPython(`
import json, sys
from importlib.util import spec_from_file_location, module_from_spec
spec = spec_from_file_location("ad", ${JSON.stringify(SCRIPT)})
mod = module_from_spec(spec)
spec.loader.exec_module(mod)
result, kind = mod.is_anomalous(${current}, ${mean}, ${stddev}, ${sigma})
print(json.dumps([result, kind]))
`);
}

/** Probe `compare_window_against_baseline(window, baseline, sigma)` */
function compareWindow(window, baseline, sigma = 3.0) {
  const windowJson = JSON.stringify(JSON.stringify(window));
  const baselineJson = JSON.stringify(JSON.stringify(baseline));
  return callPython(`
import json, sys
from importlib.util import spec_from_file_location, module_from_spec
spec = spec_from_file_location("ad", ${JSON.stringify(SCRIPT)})
mod = module_from_spec(spec)
spec.loader.exec_module(mod)
window = json.loads(${windowJson})
baseline_raw = json.loads(${baselineJson})
baseline = {k: tuple(v) for k, v in baseline_raw.items()}
findings = mod.compare_window_against_baseline(window, baseline, ${sigma})
print(json.dumps(findings))
`);
}

const describeIfPython = pythonAvailable() ? describe : describe.skip;

describeIfPython('KAN-63-A anomaly-detect — is_anomalous', () => {
  test('normal value within 3σ → not anomalous', () => {
    // baseline mean=10, stddev=2 → 3σ band is [4, 16]. Current=11 is in.
    const [isA] = isAnomalous(11, 10, 2);
    expect(isA).toBe(false);
  });

  test('spike — current > mean + 3σ', () => {
    const [isA, kind] = isAnomalous(20, 10, 2);
    expect(isA).toBe(true);
    expect(kind).toBe('spike');
  });

  test('drop — current < mean - 3σ', () => {
    const [isA, kind] = isAnomalous(0, 10, 2);
    expect(isA).toBe(true);
    expect(kind).toBe('drop');
  });

  test('cold-start with zero baseline — single event is NOT anomalous', () => {
    // Baseline mean=0, stddev=0 (no historical data). Current=1 is the
    // very first event — definitely not an anomaly worth paging on.
    const [isA] = isAnomalous(1, 0, 0);
    expect(isA).toBe(false);
  });

  test('cold-start with zero baseline — many events ARE flagged as a spike', () => {
    // Baseline mean=0, stddev=0 but suddenly we have 100 events in
    // one window. This is the "bot wave starting up on a quiet table"
    // case — fire on it.
    const [isA, kind] = isAnomalous(100, 0, 0);
    expect(isA).toBe(true);
    expect(kind).toBe('spike');
  });

  test('stddev=0 with stable nonzero baseline — small variation does NOT fire', () => {
    // baseline mean=5, stddev=0 (every sample identical). current=6
    // is +20% but absolute change is small — fall-back rule allows it.
    const [isA] = isAnomalous(6, 5, 0);
    expect(isA).toBe(false);
  });

  test('stddev=0 with stable nonzero baseline — doubling DOES fire', () => {
    // baseline mean=5, stddev=0. current=15 is 3× the mean — the
    // ">2× mean" fallback rule fires.
    const [isA, kind] = isAnomalous(15, 5, 0);
    expect(isA).toBe(true);
    expect(kind).toBe('spike');
  });

  test('configurable sigma threshold — 2σ allows tighter alerting', () => {
    // mean=10, stddev=2, current=15 → z=2.5
    // At 3σ threshold: not anomalous (2.5 < 3)
    // At 2σ threshold: anomalous (2.5 > 2)
    expect(isAnomalous(15, 10, 2, 3.0)[0]).toBe(false);
    expect(isAnomalous(15, 10, 2, 2.0)[0]).toBe(true);
  });
});

describeIfPython('KAN-63-A anomaly-detect — compare_window_against_baseline', () => {
  test('all metrics normal → no findings', () => {
    const findings = compareWindow(
      { profile_signups: 11, profile_publishes: 8, profile_items_added: 50, reports_filed: 1 },
      {
        profile_signups: [10, 2],
        profile_publishes: [8, 2],
        profile_items_added: [50, 10],
        reports_filed: [1, 1],
      },
    );
    expect(findings).toEqual([]);
  });

  test('one metric spikes → exactly one finding with kind=spike', () => {
    const findings = compareWindow(
      { profile_signups: 100, profile_publishes: 8, profile_items_added: 50, reports_filed: 1 },
      {
        profile_signups: [10, 2],
        profile_publishes: [8, 2],
        profile_items_added: [50, 10],
        reports_filed: [1, 1],
      },
    );
    expect(findings.length).toBe(1);
    expect(findings[0].metric).toBe('profile_signups');
    expect(findings[0].kind).toBe('spike');
    expect(findings[0].current).toBe(100);
  });

  test('multiple metrics anomalous → multiple findings, one each', () => {
    const findings = compareWindow(
      { profile_signups: 100, profile_publishes: 50, profile_items_added: 50, reports_filed: 1 },
      {
        profile_signups: [10, 2],
        profile_publishes: [8, 2],
        profile_items_added: [50, 10],
        reports_filed: [1, 1],
      },
    );
    expect(findings.length).toBe(2);
    const metrics = findings.map((f) => f.metric).sort();
    expect(metrics).toEqual(['profile_publishes', 'profile_signups']);
  });

  test('drop in reports is flagged (a regression that broke /api/reports would look like this)', () => {
    const findings = compareWindow(
      { profile_signups: 10, profile_publishes: 8, profile_items_added: 50, reports_filed: 0 },
      {
        profile_signups: [10, 2],
        profile_publishes: [8, 2],
        profile_items_added: [50, 10],
        reports_filed: [10, 1],
      },
    );
    expect(findings.length).toBe(1);
    expect(findings[0].metric).toBe('reports_filed');
    expect(findings[0].kind).toBe('drop');
  });

  test('findings contain the audit fields for issue body assembly', () => {
    const findings = compareWindow(
      { profile_signups: 100, profile_publishes: 0, profile_items_added: 0, reports_filed: 0 },
      {
        profile_signups: [10, 2],
        profile_publishes: [0, 0],
        profile_items_added: [0, 0],
        reports_filed: [0, 0],
      },
    );
    expect(findings[0]).toMatchObject({
      metric: 'profile_signups',
      current: 100,
      mean: 10,
      stddev: 2,
      kind: 'spike',
    });
    expect(typeof findings[0].z).toBe('number');
  });
});
