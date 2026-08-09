const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SRC } = require('../support/source-paths.json');

const REPO_ROOT = path.resolve(__dirname, '../../');
const SCRIPT = path.resolve(REPO_ROOT, SRC.checkExtractionDod);

// A PR body that answers every attestation. Individual tests override it.
const FULL_BODY = [
  '## Summary',
  'Move the age module.',
  '- [x] EXTRACTION-DOD-DESIGN-SYSTEM: n/a — no ui-kit path moved',
  '- [x] EXTRACTION-DOD-ROUTINE-PROMPTS: n/a — no prompt-named path moved',
  '- [x] EXTRACTION-DOD-COVERAGE: playwright project `authed`, soak clause C4',
].join('\n');

// Build a throwaway repo carrying a minimal version of the real estate:
// .github/, scripts/, docs/ (incl. the mirror manifest), modules.json, tests/.
// `estate` lets a test plant a stale reference in exactly one artefact.
// The sandbox fixture's pre-move path, in one place. Named rather than
// repeated seven times: it is a raw path literal under the KAN-414 F4 ratchet,
// and — more to the point — a fixture whose path is written out at every use is
// a fixture that drifts silently when one copy is edited.
const FIXTURE_FROM = 'src/lib/age/gate.ts';

function makeRepo({ estate = {}, extra = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extrdod-'));
  const write = (rel, content) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };
  const git = (args) => execSync(`git ${args}`, { cwd: dir, stdio: 'pipe' }).toString();

  git('init -q');
  git('config user.email test@example.com');
  git('config user.name tester');
  git('config commit.gpgsign false');

  // --- baseline estate on develop, all pointing at the pre-move path ---
  write(FIXTURE_FROM, 'export const gate = 1;\n');
  write(SRC.codeowners, '* @luisa\n/src/lib/age/gate.ts @luisa\n');
  write('scripts/some-guard.sh', '#!/usr/bin/env bash\ngrep -q x src/lib/age/gate.ts\n');
  write('docs/ARCHITECTURE.md', 'The age gate lives at `src/lib/age/gate.ts`.\n');
  write(
    'docs/DOC_SOURCE_OF_TRUTH.md',
    '<!-- doc-mirror-manifest:start -->\n| `src/lib/age/gate.ts` | wiki |\n<!-- doc-mirror-manifest:end -->\n'
  );
  write('modules.json', JSON.stringify({ modules: { age: { paths: [FIXTURE_FROM] } } }, null, 2));
  write('tests/unit/age-gate.test.js', "require('../../src/lib/age/gate.ts');\n");
  for (const [rel, content] of Object.entries(extra)) write(rel, content);
  git('add -A');
  git('commit -q -m "chore: baseline estate"');
  git('branch -M develop');

  return { dir, write, git };
}

// Perform the move on a feature branch. `estate` maps artefact path -> the
// content it should hold AFTER the move; anything omitted keeps its stale
// reference, which is exactly what the guard should catch.
function runMove({
  estate = {},
  body = FULL_BODY,
  commitMessage = 'refactor: extract age module',
  from = FIXTURE_FROM,
  to = 'modules/age/gate.ts',
  baseRef = 'develop',
  omitBody = false,
  deleteArtefact = null,
  noMove = false,
} = {}) {
  const { dir, write, git } = makeRepo();
  git('checkout -q -b feature');

  if (noMove) {
    write(FIXTURE_FROM, 'export const gate = 2;\n');
  } else {
    const absFrom = path.join(dir, from);
    const absTo = path.join(dir, to);
    fs.mkdirSync(path.dirname(absTo), { recursive: true });
    fs.renameSync(absFrom, absTo);
  }

  // Default: every artefact is updated to the new path (the passing case).
  const updated = {
    [SRC.codeowners]: `* @luisa\n/${to} @luisa\n`,
    'scripts/some-guard.sh': `#!/usr/bin/env bash\ngrep -q x ${to}\n`,
    'docs/ARCHITECTURE.md': `The age gate lives at \`${to}\`.\n`,
    'docs/DOC_SOURCE_OF_TRUTH.md': `<!-- doc-mirror-manifest:start -->\n| \`${to}\` | wiki |\n<!-- doc-mirror-manifest:end -->\n`,
    'modules.json': JSON.stringify({ modules: { age: { paths: [to] } } }, null, 2),
    'tests/unit/age-gate.test.js': `require('../../${to}');\n`,
    ...estate,
  };
  if (!noMove) for (const [rel, content] of Object.entries(updated)) write(rel, content);
  if (deleteArtefact) fs.rmSync(path.join(dir, deleteArtefact), { recursive: true, force: true });

  git('add -A');
  const msgFile = path.join(dir, '.msg');
  fs.writeFileSync(msgFile, commitMessage);
  git(`commit -q -F ${JSON.stringify(msgFile)}`);
  fs.rmSync(msgFile, { force: true });

  const env = { ...process.env, BASE_REF: baseRef, HEAD_REF: 'HEAD' };
  if (omitBody) {
    delete env.PR_BODY;
  } else {
    env.PR_BODY = body;
  }

  let status = 0;
  let output = '';
  try {
    output = execSync(`bash "${SCRIPT}"`, { cwd: dir, stdio: 'pipe', env }).toString();
  } catch (err) {
    status = err.status || 1;
    output = `${err.stdout || ''}${err.stderr || ''}`;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { status, output };
}

describe(SRC.checkExtractionDod, () => {
  let source = '';
  beforeAll(() => {
    source = fs.readFileSync(SCRIPT, 'utf8');
  });

  it('exists and is a bash script', () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
    expect(source.startsWith('#!/usr/bin/env bash')).toBe(true);
  });

  it('is syntactically valid (bash -n)', () => {
    expect(() => execSync(`bash -n "${SCRIPT}"`, { stdio: 'pipe' })).not.toThrow();
  });

  it('is hardened against unset vars and pipe failures', () => {
    expect(source).toMatch(/set -uo pipefail/);
  });

  it('carries no forbidden silent-skip pattern (KAN-167)', () => {
    expect(source).not.toMatch(/continue-on-error/);
    expect(source).not.toMatch(/\|\|\s*true\b/);
    expect(source).not.toMatch(/if:\s*env\./);
  });

  it('documents its three exit codes and the escape hatch', () => {
    expect(source).toMatch(/EXTRACTION-DOD-OK/);
    expect(source).toMatch(/exit 2/);
  });

  // ---------------------------------------------------------------- inert
  it('passes and does nothing when no src/ file was moved', () => {
    const { status, output } = runMove({ noMove: true });
    expect(status).toBe(0);
    expect(output).toMatch(/not an extraction PR/);
  });

  // ---------------------------------------------------------------- happy
  it('passes when every artefact was updated and the PR body attests', () => {
    const { status, output } = runMove();
    expect(status).toBe(0);
    expect(output).toMatch(/extraction Definition-of-Done satisfied/);
    expect(output).toMatch(/\[stale-refs\] clean/);
    expect(output).toMatch(/\[module-manifest\] clean/);
    expect(output).toMatch(/\[test-estate\] clean/);
  });

  // ------------------------------------------------------------ violations
  it('fails, naming file and line, when a stale reference remains in .github/', () => {
    const { status, output } = runMove({
      estate: { [SRC.codeowners]: '* @luisa\n/src/lib/age/gate.ts @luisa\n' },
    });
    expect(status).toBe(1);
    expect(output).toMatch(/\[stale-refs\] stale reference to moved path 'src\/lib\/age\/gate\.ts'/);
    expect(output).toMatch(/\.github\/CODEOWNERS:2:/);
  });

  it('fails when a stale reference remains in scripts/ or docs/', () => {
    const { status, output } = runMove({
      estate: { 'docs/ARCHITECTURE.md': 'The age gate lives at `src/lib/age/gate.ts`.\n' },
    });
    expect(status).toBe(1);
    expect(output).toMatch(/docs\/ARCHITECTURE\.md:1:/);
  });

  it('fails when the moved path is still named in DOC_SOURCE_OF_TRUTH.md', () => {
    const { status, output } = runMove({
      estate: {
        'docs/DOC_SOURCE_OF_TRUTH.md':
          '<!-- doc-mirror-manifest:start -->\n| `src/lib/age/gate.ts` | wiki |\n<!-- doc-mirror-manifest:end -->\n',
      },
    });
    expect(status).toBe(1);
    expect(output).toMatch(/\[doc-manifest\] stale reference/);
  });

  it("fails when the module's entry in modules.json did not move with it", () => {
    const { status, output } = runMove({
      estate: {
        'modules.json': JSON.stringify({ modules: { age: { paths: [FIXTURE_FROM] } } }, null, 2),
      },
    });
    expect(status).toBe(1);
    expect(output).toMatch(/\[module-manifest\] stale reference/);
  });

  it("fails when the module's tests did not move with it", () => {
    const { status, output } = runMove({
      estate: { 'tests/unit/age-gate.test.js': "require('../../src/lib/age/gate.ts');\n" },
    });
    expect(status).toBe(1);
    expect(output).toMatch(/\[test-estate\] stale reference/);
  });

  it('fails when an out-of-repo attestation line is absent from the PR body', () => {
    const { status, output } = runMove({
      body: '## Summary\n- [x] EXTRACTION-DOD-COVERAGE: playwright `authed`, C4\n',
    });
    expect(status).toBe(1);
    expect(output).toMatch(/\[out-of-repo\] the PR body has no 'EXTRACTION-DOD-DESIGN-SYSTEM' line/);
  });

  it('fails when an attestation line is present but unanswered', () => {
    const { status, output } = runMove({
      body: FULL_BODY.replace('EXTRACTION-DOD-DESIGN-SYSTEM: n/a — no ui-kit path moved', 'EXTRACTION-DOD-DESIGN-SYSTEM:'),
    });
    expect(status).toBe(1);
    expect(output).toMatch(/present but unanswered/);
  });

  it('fails when the template placeholder was never edited', () => {
    const { status, output } = runMove({
      body: FULL_BODY.replace(
        'EXTRACTION-DOD-ROUTINE-PROMPTS: n/a — no prompt-named path moved',
        'EXTRACTION-DOD-ROUTINE-PROMPTS: FILL-IN'
      ),
    });
    expect(status).toBe(1);
    expect(output).toMatch(/still carries the unedited template placeholder/);
  });

  it('fails when the coverage line names neither a project nor "no coverage"', () => {
    const { status, output } = runMove({
      body: FULL_BODY.split('\n').filter((l) => !l.includes('COVERAGE')).join('\n'),
    });
    expect(status).toBe(1);
    expect(output).toMatch(/\[coverage\] the PR body has no 'EXTRACTION-DOD-COVERAGE' line/);
  });

  it('accepts "no coverage" as an honest finding', () => {
    const { status } = runMove({
      body: FULL_BODY.replace(/EXTRACTION-DOD-COVERAGE:.*/, 'EXTRACTION-DOD-COVERAGE: no coverage'),
    });
    expect(status).toBe(0);
  });

  // ---------------------------------------------------- routine-prompt rule
  it('reports routine-prompts as not applicable when no coupled path moved', () => {
    const { status, output } = runMove();
    expect(status).toBe(0);
    expect(output).toMatch(/\[routine-prompts\] no moved path is named in a routine prompt/);
  });

  // --------------------------------------------------------- fail-closed
  it('exits 2 when the diff base cannot be resolved', () => {
    const { status, output } = runMove({ baseRef: 'origin/nope' });
    expect(status).toBe(2);
    expect(output).toMatch(/cannot compute the change range/);
  });

  it('exits 2 when an extraction PR has no readable body', () => {
    const { status, output } = runMove({ omitBody: true });
    expect(status).toBe(2);
    expect(output).toMatch(/PR body is empty or unavailable/);
  });

  it('exits 2 when an artefact it must sweep is missing', () => {
    const { status, output } = runMove({ deleteArtefact: 'modules.json' });
    expect(status).toBe(2);
    expect(output).toMatch(/check 'module-manifest'.*cannot be swept/s);
  });

  // -------------------------------------------------------- escape hatch
  it('suppresses exactly the named check and nothing else', () => {
    const { status, output } = runMove({
      estate: {
        [SRC.codeowners]: '* @luisa\n/src/lib/age/gate.ts @luisa\n',
        'modules.json': JSON.stringify({ modules: { age: { paths: [FIXTURE_FROM] } } }, null, 2),
      },
      commitMessage: 'refactor: extract age module\n\nEXTRACTION-DOD-OK: KAN-428 stale-refs\n',
    });
    expect(status).toBe(1);
    expect(output).toMatch(/\[stale-refs\] SKIPPED by an active exception/);
    expect(output).toMatch(/\[module-manifest\] stale reference/);
  });

  it('prints every active exception even on a passing run', () => {
    const { status, output } = runMove({
      commitMessage: 'refactor: extract age module\n\nEXTRACTION-DOD-OK: KAN-428 coverage\n',
    });
    expect(status).toBe(0);
    expect(output).toMatch(/ACTIVE EXCEPTION — check 'coverage' suppressed by KAN-428/);
    expect(output).toMatch(/1 active exception\(s\) this run: coverage/);
  });

  it('rejects an escape hatch with no Jira key', () => {
    const { status, output } = runMove({
      commitMessage: 'refactor: extract age module\n\nEXTRACTION-DOD-OK: stale-refs\n',
    });
    expect(status).toBe(1);
    expect(output).toMatch(/malformed escape hatch/);
  });

  it('rejects an escape hatch naming an unknown check', () => {
    const { status, output } = runMove({
      commitMessage: 'refactor: extract age module\n\nEXTRACTION-DOD-OK: KAN-428 everything\n',
    });
    expect(status).toBe(1);
    expect(output).toMatch(/unknown check 'everything'/);
  });

  /**
   * ARCHIVE_FILES — dated evidence is reported, never enforced (KAN-415).
   *
   * The risk of any exclusion is that it quietly becomes a suppression list, so
   * these three cases pin the two properties that stop it: it must still fail
   * for live files, and it must be PATH-EXACT rather than directory-wide.
   * Without the third case an `ARCHIVE_FILES` entry could be widened to a glob
   * and nothing would notice.
   */
  it('records — but does not fail on — a stale path inside dated evidence', () => {
    const { status, output } = runMove({
      estate: {
        'docs/WEEKLY_HEALTH_REGRESSION_ROUTINE.md':
          '| 2026-06-27 | ledger row naming src/lib/age/gate.ts as it was that day |\n',
      },
    });
    expect(status).toBe(0);
    // Reported, with the exact line — an exclusion nobody can see is the SEC-79
    // false-green this whole script exists to prevent.
    expect(output).toMatch(/also appears in dated evidence \(recorded, not failed\)/);
    expect(output).toMatch(/docs\/WEEKLY_HEALTH_REGRESSION_ROUTINE\.md:1/);
    expect(output).toMatch(/Rewriting them would falsify the record/);
  });

  it('still fails on the same stale path in a live artefact', () => {
    const { status, output } = runMove({
      estate: { 'docs/ARCHITECTURE.md': 'The age gate lives at `src/lib/age/gate.ts`.\n' },
    });
    expect(status).toBe(1);
    expect(output).toMatch(/\[stale-refs\] stale reference to moved path/);
    expect(output).toMatch(/docs\/ARCHITECTURE\.md/);
  });

  it('exempts archival files by exact path, not by directory', () => {
    // A sibling of a genuinely archival snapshot, in the same directory. If the
    // list were ever loosened to `docs/modularisation/data/**`, this goes green
    // and real drift starts hiding behind a folder name.
    const { status, output } = runMove({
      estate: {
        'docs/modularisation/data/not-archival.json':
          JSON.stringify({ path: FIXTURE_FROM }, null, 2),
      },
    });
    expect(status).toBe(1);
    expect(output).toMatch(/docs\/modularisation\/data\/not-archival\.json/);
  });
});

// The routine-prompt rule needs a move of a path the prompts actually name.
describe('scripts/check-extraction-dod.sh — routine-prompt coupling', () => {
  function runCoupledMove({ body }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extrdod-rc-'));
    const write = (rel, content) => {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    };
    const git = (args) => execSync(`git ${args}`, { cwd: dir, stdio: 'pipe' }).toString();
    git('init -q');
    git('config user.email test@example.com');
    git('config user.name tester');
    git('config commit.gpgsign false');
    write('src/components/Card.tsx', 'export const Card = () => null;\n');
    write(SRC.codeowners, '* @luisa\n');
    write('scripts/keep.sh', '#!/usr/bin/env bash\ntrue\n');
    write('docs/ARCHITECTURE.md', 'docs\n');
    write('docs/DOC_SOURCE_OF_TRUTH.md', '<!-- doc-mirror-manifest:start -->\n<!-- doc-mirror-manifest:end -->\n');
    write('modules.json', '{"modules":{}}\n');
    write('tests/unit/keep.test.js', 'test("x", () => {});\n');
    git('add -A');
    git('commit -q -m "chore: baseline"');
    git('branch -M develop');
    git('checkout -q -b feature');
    fs.mkdirSync(path.join(dir, 'modules/ui-kit'), { recursive: true });
    fs.renameSync(path.join(dir, 'src/components/Card.tsx'), path.join(dir, 'modules/ui-kit/Card.tsx'));
    git('add -A');
    git('commit -q -m "refactor: extract ui-kit"');

    let status = 0;
    let output = '';
    try {
      output = execSync(`bash "${SCRIPT}"`, {
        cwd: dir,
        stdio: 'pipe',
        env: { ...process.env, BASE_REF: 'develop', HEAD_REF: 'HEAD', PR_BODY: body },
      }).toString();
    } catch (err) {
      status = err.status || 1;
      output = `${err.stdout || ''}${err.stderr || ''}`;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    return { status, output };
  }

  it('fails when a prompt-named path moves and the PR body names no trigger ID', () => {
    const { status, output } = runCoupledMove({ body: FULL_BODY });
    expect(status).toBe(1);
    expect(output).toMatch(/\[routine-prompts\].*names no routine trigger ID/);
  });

  it('passes once the PR body names the affected routine by trigger ID', () => {
    const { status, output } = runCoupledMove({
      body: `${FULL_BODY}\nAffected routine: Backlog Autopilot trig_01HniS6vXfGEFR4gvJaLNTM9\n`,
    });
    expect(status).toBe(0);
    expect(output).toMatch(/\[routine-prompts\] PR body names a routine trigger ID/);
  });
});
