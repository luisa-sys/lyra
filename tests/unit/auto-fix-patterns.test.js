/**
 * KAN-63 Tier 4: regression tests for the auto-fix pattern catalogue.
 *
 * The Python self-test (`scripts/auto-fix-known-failures.py --self-test`)
 * is the authoritative regression guard and runs in pr-checks.yml. These
 * JS tests are belt-and-braces:
 *
 *   - JSON schema validation (every pattern has the required shape)
 *   - Regex validity in JavaScript (so if you ever port the matcher to
 *     a JS-based tool, the patterns still work)
 *   - Each pattern matches its anchor fixture
 *   - No cross-contamination between patterns sharing a workflow
 *
 * Patterns use stdlib-friendly regex features only, so JS and Python
 * regex parse the same strings the same way for our use.
 */

const fs = require('fs');
const path = require('path');

const PATTERNS_PATH = path.resolve(__dirname, '../../scripts/auto-fix-patterns.json');
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/auto-fix-logs');

// Same mapping the Python self-test uses; keep them in sync.
const FIXTURE_EXPECTATIONS = {
  'anomaly-detect.log': { workflow: 'anomaly-detect', patternId: 'anomaly-missing-github-label' },
  'beta-gate-smoke.log': { workflow: 'beta-gate-smoke', patternId: 'vercel-automation-bypass-rotated' },
  'staging-tests.log': { workflow: 'staging-tests', patternId: 'lighthouse-seo-on-noindex-target' },
  'affiliate-link-smoke.log': { workflow: 'affiliate-link-smoke', patternId: 'affiliate-smoke-locale-mismatch' },
  'auto-promote-to-staging.log': { workflow: 'auto-promote-to-staging', patternId: 'lyra-release-pat-insufficient-scopes' },
};

const KNOWN_REMEDIATION_KINDS = new Set([
  'create_label',
  'alert_secret_rotation',
  'pr_pending',
]);

function stripAnsi(text) {
  // Same characters the Python ANSI_RE strips: ESC[...m and ESC[...K.
  return text.replace(/\x1b\[[0-9;]*[mK]/g, '');
}

function workflowMatches(pattern, workflowName) {
  const norm = workflowName.trim().toLowerCase();
  return pattern.workflows.some((w) => w.trim().toLowerCase() === norm);
}

let catalogue;
let patterns;

beforeAll(() => {
  catalogue = JSON.parse(fs.readFileSync(PATTERNS_PATH, 'utf8'));
  patterns = catalogue.patterns;
});

describe('KAN-63 Tier 4: auto-fix-patterns.json shape', () => {
  test('catalogue declares version 1', () => {
    expect(catalogue.version).toBe(1);
  });

  test('every pattern has id, title, workflows[], regex, remediation.kind', () => {
    for (const p of patterns) {
      expect(typeof p.id).toBe('string');
      expect(p.id.length).toBeGreaterThan(0);
      expect(typeof p.title).toBe('string');
      expect(Array.isArray(p.workflows)).toBe(true);
      expect(p.workflows.length).toBeGreaterThan(0);
      expect(typeof p.regex).toBe('string');
      expect(p.regex.length).toBeGreaterThan(0);
      expect(p.remediation).toBeDefined();
      expect(typeof p.remediation.kind).toBe('string');
    }
  });

  test('every pattern id is unique', () => {
    const ids = patterns.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every pattern uses a known remediation kind', () => {
    for (const p of patterns) {
      expect(KNOWN_REMEDIATION_KINDS.has(p.remediation.kind)).toBe(true);
    }
  });

  test('every pattern regex compiles in JS', () => {
    for (const p of patterns) {
      expect(() => new RegExp(p.regex, 'i')).not.toThrow();
    }
  });

  test('create_label patterns have a capture group for the label name', () => {
    // The Python handler reads match.group(1). If a label-create pattern
    // has no capture group, it'll error at remediation time. Catch here.
    for (const p of patterns) {
      if (p.remediation.kind !== 'create_label') continue;
      // Look for an unescaped `(` not preceded by `\` and not part of `(?:`.
      const hasGroup = /(?:^|[^\\])\((?!\?[!:=<])/.test(p.regex);
      expect(hasGroup).toBe(true);
    }
  });

  test('alert_secret_rotation patterns name the secret', () => {
    for (const p of patterns) {
      if (p.remediation.kind !== 'alert_secret_rotation') continue;
      expect(typeof p.remediation.secret_name).toBe('string');
      expect(p.remediation.secret_name.length).toBeGreaterThan(0);
      expect(Array.isArray(p.remediation.steps)).toBe(true);
      expect(p.remediation.steps.length).toBeGreaterThan(0);
    }
  });

  test('pr_pending patterns name a branch hint', () => {
    for (const p of patterns) {
      if (p.remediation.kind !== 'pr_pending') continue;
      expect(typeof p.remediation.pr_branch_hint).toBe('string');
      expect(p.remediation.pr_branch_hint.length).toBeGreaterThan(0);
    }
  });
});

describe('KAN-63 Tier 4: pattern ↔ fixture mapping', () => {
  test('every expected fixture exists on disk', () => {
    for (const fixture of Object.keys(FIXTURE_EXPECTATIONS)) {
      expect(fs.existsSync(path.join(FIXTURES_DIR, fixture))).toBe(true);
    }
  });

  test('every catalogued pattern has a fixture in FIXTURE_EXPECTATIONS', () => {
    const expectedIds = new Set(Object.values(FIXTURE_EXPECTATIONS).map((e) => e.patternId));
    for (const p of patterns) {
      expect(expectedIds.has(p.id)).toBe(true);
    }
  });

  test.each(Object.entries(FIXTURE_EXPECTATIONS))(
    'fixture %s classifies as the expected pattern',
    (fixtureName, expected) => {
      const text = stripAnsi(fs.readFileSync(path.join(FIXTURES_DIR, fixtureName), 'utf8'));
      const matching = patterns
        .filter((p) => workflowMatches(p, expected.workflow))
        .find((p) => new RegExp(p.regex, 'i').test(text));
      expect(matching).toBeDefined();
      expect(matching.id).toBe(expected.patternId);
    },
  );

  test('no pattern false-positives on a sibling fixture sharing its workflow', () => {
    // For each fixture, ensure that ONLY the expected pattern (within
    // that fixture's workflow scope) fires. Patterns from other workflows
    // are out of scope here — the workflow gate protects them.
    for (const [fixtureName, expected] of Object.entries(FIXTURE_EXPECTATIONS)) {
      const text = stripAnsi(fs.readFileSync(path.join(FIXTURES_DIR, fixtureName), 'utf8'));
      const inScope = patterns.filter((p) => workflowMatches(p, expected.workflow));
      const matching = inScope.filter((p) => new RegExp(p.regex, 'i').test(text));
      expect(matching.length).toBe(1);
      expect(matching[0].id).toBe(expected.patternId);
    }
  });
});

describe('KAN-63 Tier 4: workflow trigger file references the right names', () => {
  // The workflow trigger file (.github/workflows/auto-fix-known-failures.yml)
  // lists workflow display names to react to. Those names must match at
  // least one workflow listing in the pattern catalogue, or the trigger
  // is wired to a workflow no pattern handles.
  test('every workflow_run trigger name has at least one pattern that lists it', () => {
    const wfPath = path.resolve(
      __dirname,
      '../../.github/workflows/auto-fix-known-failures.yml',
    );
    const wfYaml = fs.readFileSync(wfPath, 'utf8');
    // Cheap parse: look for quoted strings under the workflows: section.
    // The block is short — match every "Foo bar"-style string between
    // `workflows:` and the closing `types:` line.
    const block = wfYaml.match(/workflows:\s*([\s\S]*?)\n\s*types:/);
    expect(block).toBeTruthy();
    const names = [...block[1].matchAll(/-\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    const allListed = new Set();
    for (const p of patterns) {
      for (const w of p.workflows) allListed.add(w.trim().toLowerCase());
    }
    for (const n of names) {
      expect(allListed.has(n.trim().toLowerCase())).toBe(true);
    }
  });
});
