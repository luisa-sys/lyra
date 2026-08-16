const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SRC } = require('../support/source-paths.json');

const REPO_ROOT = path.resolve(__dirname, '../../');
const SCRIPT = path.join(REPO_ROOT, SRC.checkDocsUpdated);

/**
 * CTL-047 — the Documentation Definition-of-Done gate.
 *
 * CLAUDE.md has said "Docs are part of 'done', not a follow-up ticket" since
 * KAN-359 and nothing enforced it. A 60-agent audit on 2026-08-10 then found
 * dozens of confirmed-stale statements, three of which would have made a fresh
 * session do the WRONG thing — most starkly, the modularisation plan still
 * reading "No file moves into src/modules/" with 44 files already moved on main.
 *
 * These tests pin the two halves that matter and are easy to get backwards:
 *
 *   1. it FIRES on the structural changes it claims to cover, and
 *   2. it stays SILENT otherwise.
 *
 * (2) is not politeness. A gate that fires on every PR is one people learn to
 * wave through, and that reflex generalises to every other gate in the repo. The
 * narrowness of the trigger set is a load-bearing design property, so it is
 * asserted rather than assumed.
 *
 * Driven as a subprocess (the tests/scripts convention, CTL-038 / gotcha #29)
 * rather than reimplementing the predicates — a private copy of TRIGGERS here
 * would report green against a script that had been deleted.
 */

/**
 * Synthetic paths, assembled from segments rather than written as single-quoted
 * repo-path literals. That is a statement about them, not a way around the F4
 * ratchet: every one of these names a file that MUST NOT exist (they are inputs
 * that exercise the predicates), so none of them can ever be a `SRC` manifest
 * entry — the manifest only carries paths that resolve.
 */
const j = (...seg) => seg.join('/');
// Real files this test READS. No SRC key exists for either, and seeding one for
// a test fixture would put repo-config paths in a manifest meant for src/.
const REGISTRY_REL = j('controls', 'registry.json');
const DEPCRUISE_CFG = j('.dependency-cruiser.cjs');
const FIXTURE = {
  module: j('src', 'modules', 'age', '__no_such_module__.ts'),
  workflow: j('.github', 'workflows', '__no_such_workflow__.yml'),
  control: j('scripts', 'check-__no_such_control__.py'),
  migration: j('supabase', 'migrations', '20260810000000___no_such__.sql'),
  ordinaryPage: j('src', 'app', 'dashboard', '__no_such_page__.tsx'),
  ordinaryLib: j('src', 'lib', 'convene', 'invites', '__no_such_lib__.ts'),
  test: j('tests', 'unit', '__no_such_test__.test.ts'),
  doc: j('docs', 'ARCHITECTURE.md'),
};

const SATISFIED = 0;
const UNSATISFIED = 1;
const CANNOT_VERIFY = 2;

/** Run the gate over an explicit file list, with optional commit messages. */
function run(changedFiles, messages = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-gate-'));
  const listPath = path.join(dir, 'changed.txt');
  fs.writeFileSync(listPath, `${changedFiles.join('\n')}\n`);
  try {
    const out = execFileSync('python3', [SCRIPT, '--files', listPath], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      env: { ...process.env, DOCS_GATE_MESSAGES: messages },
    }).toString();
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('the script is registered and self-consistent', () => {
  test('its own --self-test passes', () => {
    const out = execFileSync('python3', [SCRIPT, '--self-test'], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    }).toString();
    expect(out).toMatch(/self-test: (\d+)\/\1 passed/);
    expect(out).not.toMatch(/FAIL/);
  });

  test('it is registered as CTL-047 and wired into pr-checks', () => {
    const registry = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, REGISTRY_REL), 'utf8'),
    );
    const ctl = registry.controls.find((c) => c.id === 'CTL-047');
    expect(ctl).toBeDefined();
    expect(ctl.implementation).toBe(SRC.checkDocsUpdated);
    // A control the registry knows about but no workflow runs is the SEC-79
    // failure mode — registered, green, and switched off.
    const wf = fs.readFileSync(path.join(REPO_ROOT, SRC.prChecks), 'utf8');
    expect(wf).toContain(SRC.checkDocsUpdated);
  });
});

describe('it FIRES on structural change with no doc and no declaration', () => {
  const structural = [
    ['a module file', FIXTURE.module],
    ['a workflow', FIXTURE.workflow],
    ['a control script', FIXTURE.control],
    ['a migration', FIXTURE.migration],
    ['the signup-surface manifest', SRC.signupSurface],
    ['the dependency-cruiser config', DEPCRUISE_CFG],
  ];

  test.each(structural)('%s trips the gate', (_label, file) => {
    const { code, out } = run([file], 'feat: a change with no documentation');
    expect(code).toBe(UNSATISFIED);
    expect(out).toContain('no documentation was updated');
  });

  test('the failure names WHICH doc to look at, not just "update the docs"', () => {
    // An instruction nobody can act on in ten seconds is an instruction that
    // gets an escape hatch on reflex instead of a fix.
    const { out } = run([FIXTURE.module], 'feat: x');
    expect(out).toContain('-> look at:');
    expect(out).toContain(FIXTURE.doc);
  });
});

describe('it stays SILENT when it should — the load-bearing half', () => {
  test('an ordinary code change does not trip it', () => {
    const { code, out } = run(
      [FIXTURE.ordinaryPage, FIXTURE.ordinaryLib],
      'fix: a normal change',
    );
    expect(code).toBe(SATISFIED);
    expect(out).toContain('not implicated');
  });

  test('a test-only change does not trip it', () => {
    expect(run([FIXTURE.test], 'test: more cover').code).toBe(SATISFIED);
  });

  test('structural change WITH a doc update is satisfied', () => {
    const { code, out } = run(
      [FIXTURE.module, FIXTURE.doc],
      'feat: x',
    );
    expect(code).toBe(SATISFIED);
    expect(out).toContain('documentation was updated in the same PR');
  });

  test('CLAUDE.md counts as documentation', () => {
    // It is the file a fresh session actually reads. A change documented only
    // under docs/ that contradicts CLAUDE.md is still drift.
    expect(run([FIXTURE.module, 'CLAUDE.md'], 'feat: x').code).toBe(SATISFIED);
  });
});

describe('the declaration trailer', () => {
  test('Docs-Updated with a key and a reason satisfies', () => {
    const { code, out } = run(
      [FIXTURE.module],
      'feat: x\n\nDocs-Updated: KAN-415 added the module to the ARCHITECTURE code-layout table',
    );
    expect(code).toBe(SATISFIED);
    expect(out).toContain('KAN-415');
  });

  test('Docs-N/A is a legitimate answer, not a loophole', () => {
    expect(
      run(
        [FIXTURE.module],
        'feat: x\n\nDocs-N/A: KAN-415 a private helper no document describes',
      ).code,
    ).toBe(SATISFIED);
  });

  test('a trailer with NO Jira key does not satisfy', () => {
    // The same rule as the KAN-411 UI trailer: a bare assertion is not a record.
    expect(run([FIXTURE.module], 'feat: x\n\nDocs-N/A: because').code).toBe(
      UNSATISFIED,
    );
  });

  test('a trailer with a key but NO reason does not satisfy', () => {
    // "Docs-N/A: KAN-415" is the shape this gate would decay into if a reason
    // were optional — a ticket number pasted to make a red go away.
    expect(run([FIXTURE.module], 'feat: x\n\nDocs-N/A: KAN-415').code).toBe(
      UNSATISFIED,
    );
  });
});

describe('it fails CLOSED when it cannot verify (KAN-167, gotcha #30)', () => {
  test('an unreadable --files list is exit 2, never a pass', () => {
    let code = 0;
    let out = '';
    try {
      out = execFileSync('python3', [SCRIPT, '--files', '/nonexistent/changed.txt'], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      }).toString();
    } catch (err) {
      code = err.status;
      out = `${err.stdout || ''}${err.stderr || ''}`;
    }
    expect(code).toBe(CANNOT_VERIFY);
    expect(out).not.toContain('not implicated');
  });

  test('an unresolvable diff base is exit 2, never a pass', () => {
    // The SEC-79 shape: a guard that cannot run must not report clean. A shallow
    // CI checkout is the realistic cause, and it would otherwise look identical
    // to "this PR changed nothing structural".
    let code = 0;
    let out = '';
    try {
      out = execFileSync('python3', [SCRIPT, 'no-such-ref-aaa', 'no-such-ref-bbb'], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      }).toString();
    } catch (err) {
      code = err.status;
      out = `${err.stdout || ''}${err.stderr || ''}`;
    }
    expect(code).toBe(CANNOT_VERIFY);
    expect(out).toContain('Failing closed');
    expect(out).not.toContain('not implicated');
  });
});

/**
 * SEC-155 — the action-version-pin exemption.
 *
 * These cases MUST drive the script against a real git history, not the
 * `--files` mode used above: the exemption is decided from `git diff` content,
 * so a path-list harness cannot reach it at all. Building a throwaway repo is
 * the only way to observe `pin_only_workflow_paths` doing its job — and the
 * `--files` cases above deliberately keep firing on every workflow path, which
 * is the conservative answer when no diff is available.
 *
 * The defect: the `workflow` trigger described itself as "added or removed" and
 * fired on every EDIT. Dependabot's github-actions group PR (#661) sat red for
 * 15 days carrying seven action bumps, three of them CodeQL, with no way out —
 * a robot cannot write a `Docs-N/A:` trailer and no doc here records an action
 * version. A documentation control was holding a supply-chain control shut.
 *
 * What must NOT regress is the strictness: the exemption is per file and
 * demands that EVERY changed line in that file be a `uses:` pin. Half of these
 * cases exist to prove a substantive change cannot ride along with a bump.
 */
describe('SEC-155 — action-version pin bumps are doc-neutral, everything else is not', () => {
  const WF = j('.github', 'workflows');
  let sandbox;

  const git = (...args) =>
    execFileSync('git', args, { cwd: sandbox, stdio: 'pipe' }).toString();

  const write = (rel, body) => {
    const abs = path.join(sandbox, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };

  /** Run the gate over a real base...head diff inside the sandbox. */
  const runDiff = (base, head) => {
    try {
      const out = execFileSync('python3', [SCRIPT, base, head], {
        cwd: sandbox,
        stdio: 'pipe',
      }).toString();
      return { code: 0, out };
    } catch (err) {
      return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
    }
  };

  const SCHEDULED = [
    'name: A',
    'on:',
    '  schedule:',
    "    - cron: '0 7 * * 1'",
    'jobs:',
    '  go:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v7.0.0',
    '      - uses: actions/setup-node@v6.4.0',
    '',
  ].join('\n');

  const PUSHED = [
    'name: B',
    'on: push',
    'jobs:',
    '  go:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v7.0.0',
    '',
  ].join('\n');

  beforeAll(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-gate-git-'));
    git('init', '-q', '.');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'test');
    write(j(WF, 'a.yml'), SCHEDULED);
    write(j(WF, 'b.yml'), PUSHED);
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('branch', '-q', 'basebr');
  });

  afterAll(() => {
    if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
  });

  /** Cut a fresh branch off basebr, apply `mutate`, commit, and evaluate. */
  const scenario = (branch, mutate, message = 'ci: change') => {
    git('checkout', '-q', '-B', branch, 'basebr');
    mutate();
    git('add', '-A');
    git('commit', '-qm', message);
    return runDiff('basebr', 'HEAD');
  };

  test('the sandbox really is a git repo with the fixture workflows', () => {
    // Guard against the whole suite passing because nothing was ever set up —
    // an empty or non-git sandbox would make every runDiff exit 2, and a test
    // asserting only "not 0" would read that as success.
    expect(git('ls-files').trim().split('\n').sort()).toEqual([
      j(WF, 'a.yml'),
      j(WF, 'b.yml'),
    ]);
  });

  test('a pin-only change to one workflow does not fire', () => {
    const r = scenario('pin-one', () => {
      write(j(WF, 'b.yml'), PUSHED.replace('checkout@v7.0.0', 'checkout@v7.0.1'));
    });
    expect(r.code).toBe(SATISFIED);
    expect(r.out).toContain('action-version pins');
  });

  test('the PR #661 shape — every changed workflow is a pin bump — does not fire', () => {
    const r = scenario('pin-many', () => {
      write(
        j(WF, 'a.yml'),
        SCHEDULED.replace('checkout@v7.0.0', 'checkout@v7.0.1').replace(
          'setup-node@v6.4.0',
          'setup-node@v7.0.0',
        ),
      );
      write(j(WF, 'b.yml'), PUSHED.replace('checkout@v7.0.0', 'checkout@v7.0.1'));
    }, 'ci: bump the github-actions group across 1 directory with 7 updates');
    expect(r.code).toBe(SATISFIED);
  });

  test('a cron change in the SAME file as a pin bump still fires', () => {
    // The smuggling case. If this ever goes green, the exemption has become a
    // way to edit a schedule with nobody looking.
    const r = scenario('cron-plus-pin', () => {
      write(
        j(WF, 'a.yml'),
        SCHEDULED.replace('checkout@v7.0.0', 'checkout@v7.0.1').replace(
          "cron: '0 7 * * 1'",
          "cron: '0 3 * * 1'",
        ),
      );
    });
    expect(r.code).toBe(UNSATISFIED);
  });

  test('a pin bump in one file does not excuse a substantive change in another', () => {
    const r = scenario('split', () => {
      write(j(WF, 'b.yml'), PUSHED.replace('checkout@v7.0.0', 'checkout@v7.0.1'));
      write(j(WF, 'a.yml'), SCHEDULED.replace("cron: '0 7 * * 1'", "cron: '0 3 * * 1'"));
    });
    expect(r.code).toBe(UNSATISFIED);
    // Both halves observable: one excused, one fired.
    expect(r.out).toContain('action-version pins');
    expect(r.out).toContain('[workflow]');
  });

  test('an ADDED workflow fires even when every line is a pin', () => {
    // Its existence is the documented fact, not its contents. `--diff-filter=M`
    // is what keeps added files away from the classifier.
    const r = scenario('added', () => {
      write(j(WF, 'new.yml'), '- uses: actions/checkout@v7.0.1\n');
    });
    expect(r.code).toBe(UNSATISFIED);
  });

  test('a RENAMED workflow fires even with identical contents', () => {
    const r = scenario('renamed', () => {
      git('mv', j(WF, 'b.yml'), j(WF, 'b2.yml'));
    });
    expect(r.code).toBe(UNSATISFIED);
  });

  test('a pin bump alongside a migration still fires — the exemption is trigger-scoped', () => {
    const r = scenario('pin-plus-migration', () => {
      write(j(WF, 'b.yml'), PUSHED.replace('checkout@v7.0.0', 'checkout@v7.0.1'));
      write(j('supabase', 'migrations', '20260816000000_x.sql'), 'select 1;\n');
    });
    expect(r.code).toBe(UNSATISFIED);
    expect(r.out).toContain('[migration]');
  });

  test('a pin-only PR that ALSO touches a doc is still satisfied', () => {
    const r = scenario('pin-plus-doc', () => {
      write(j(WF, 'b.yml'), PUSHED.replace('checkout@v7.0.0', 'checkout@v7.0.1'));
      write(j('docs', 'RUNBOOK.md'), '# runbook\n');
    });
    expect(r.code).toBe(SATISFIED);
  });

  test('a non-pin edit with no doc and no trailer fires, and the trailer still rescues it', () => {
    const bare = scenario('bare-run-change', () => {
      write(j(WF, 'b.yml'), PUSHED.replace('runs-on: ubuntu-latest', 'runs-on: ubuntu-24.04'));
    });
    expect(bare.code).toBe(UNSATISFIED);

    const declared = scenario(
      'run-change-declared',
      () => {
        write(j(WF, 'b.yml'), PUSHED.replace('runs-on: ubuntu-latest', 'runs-on: ubuntu-24.04'));
      },
      'ci: pin the runner\n\nDocs-N/A: SEC-155 no doc records the runner image',
    );
    expect(declared.code).toBe(SATISFIED);
  });
});
