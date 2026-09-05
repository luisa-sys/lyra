/**
 * CTL-062 — tests for scripts/check-run-log-freshness.py (SEC-146).
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE
 * -----------------------------------
 * The subject reads four files off disk and a clock it accepts as an argument.
 * Both are fully exercisable here, so these tests drive the REAL script as a
 * subprocess — against synthetic trees for the behavioural contract, and against
 * the REAL documents for the half that no fixture can stand in for: that the
 * three run-log tables are still where the control looks for them.
 *
 * ⚠️ THE REAL-DOCUMENT CASES PIN THE CLOCK, NEVER THE VERDICT. Asserting "the
 * repo's run-logs are fresh today" would put a time-dependent failure into the
 * PR gate — which is exactly why CTL-062 is a scheduled workflow rather than a
 * pr-checks step. So those cases pin the clock far into the past and far into the
 * future, where the answer is knowable in advance, and assert only that all three
 * tables PARSED and all three budgets RESOLVED. A rename that silently
 * un-anchors the control turns them red; a routine legitimately going stale
 * tomorrow does not.
 *
 * ⚠️ THE FLOOR IS THE POINT. `--self-test` reports `N/M passed`, and a matcher
 * reading both numbers moves its denominator with its numerator — it detects a
 * fixture that FAILS and never one that is DELETED.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { SRC } = require('../support/source-paths.json');
const SCRIPT = path.join(ROOT, SRC.checkRunLogFreshness);

/** Committed MINIMUM number of self-test fixtures. May be raised, never lowered. */
const SELF_TEST_FLOOR = 28;

/**
 * The three run-logs and enough of each header row to identify its table.
 *
 * These are fixture inputs, not a second implementation: the script owns the
 * real list and this file never computes freshness. They are kept honest two
 * ways — a case below asserts each header appears EXACTLY ONCE in its real
 * document, and the real-document cases would exit 2 rather than 1 if the
 * script were anchoring on something else.
 *
 * The `docs/` paths are raw literals on purpose. The F4 raw-literal ratchet and
 * the SRC generator both harvest only src, supabase, scripts, public, design and
 * .github, so no `docs/` key can exist and none is counted here.
 */
const LOGS = [
  {
    routine: 'daily-security',
    doc: 'docs/DAILY_SECURITY_CHECK.md',
    header: '| Date | Runner | \u{1F534}',
  },
  {
    routine: 'staging-soak',
    doc: 'docs/STAGING_SOAK_ROUTINE.md',
    header: '| Date (UTC) | Runner | PASS/FAIL',
  },
  {
    routine: 'weekly-health',
    doc: 'docs/WEEKLY_HEALTH_REGRESSION_ROUTINE.md',
    header: '| Date | Runner | Suite result',
  },
];

const CONTROL_ROOM = 'docs/OPS_ROUTINES_CONTROL_ROOM.md';

/** The Control Room's watchdog registrations, in the published shape. */
const ROOM_FIXTURE = [
  '# fixture',
  '',
  '```bash',
  'bash scripts/routine-watchdog.sh \\',
  "  'daily-security|1800|2026-08-14T01:00:00Z|PASS' \\",
  "  'staging-soak|1740|2026-08-14T04:12:00Z|PASS' \\",
  "  'weekly-health|11520|2026-08-10T06:30:00Z|PASS'",
  '```',
  '',
].join('\n');

const sandboxes = [];

function run(root, extra = [], now = '2026-08-14T12:00:00Z') {
  return spawnSync('python3', [SCRIPT, '--root', root, '--now', now, ...extra], {
    encoding: 'utf-8',
    cwd: ROOT,
  });
}

function said(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

/** A tree with all three logs, each carrying the rows it is given. */
function makeTree({ rows = {}, room = ROOM_FIXTURE, omit = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl062-jest-'));
  sandboxes.push(dir);
  fs.mkdirSync(path.join(dir, 'docs'));
  if (room !== null) fs.writeFileSync(path.join(dir, CONTROL_ROOM), room);
  for (const log of LOGS) {
    if (omit.includes(log.routine)) continue;
    const body = [
      '# fixture',
      '',
      // Every real run-log is preceded by a different table, and in
      // DAILY_SECURITY_CHECK.md by four of them. A parser taking the first table
      // in the file reads a document authored in June as the newest evidence.
      '| Layer | Driven by | Covers |',
      '|---|---|---|',
      '| 2026-01-01 | decoy | never read |',
      '',
      '## Run log',
      '',
      `${log.header} | c | d | e |`,
      '|---|---|---|---|---|---|',
      ...(rows[log.routine] || ['| 2026-08-14 | runner | PASS | x | none | y |']),
      '',
      '## Self-update log',
      '',
      '- **2027-01-01** — a bullet, not a row',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, log.doc), body);
  }
  return dir;
}

/** A tree holding the REAL documents, so the real tables are what gets parsed. */
function makeRealDocsTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl062-real-'));
  sandboxes.push(dir);
  fs.mkdirSync(path.join(dir, 'docs'));
  for (const rel of [CONTROL_ROOM, ...LOGS.map((l) => l.doc)]) {
    fs.copyFileSync(path.join(ROOT, rel), path.join(dir, rel));
  }
  return dir;
}

afterAll(() => {
  for (const dir of sandboxes) fs.rmSync(dir, { recursive: true, force: true });
});

describe('CTL-062 — routine run-logs carry fresh evidence', () => {
  test('the self-test passes, and runs at least its committed floor', () => {
    const r = spawnSync('python3', [SCRIPT, '--self-test'], {
      encoding: 'utf-8',
      cwd: ROOT,
    });
    expect(r.status).toBe(0);
    const m = /run-log-freshness self-test: (\d+)\/(\d+) passed/.exec(r.stdout);
    expect(`self-test line present: ${Boolean(m)}`).toBe('self-test line present: true');
    const [, passed, total] = m.map(Number);
    expect(`${passed}/${total}`).toBe(`${total}/${total}`);
    expect(total).toBeGreaterThanOrEqual(SELF_TEST_FLOOR);
  });

  test('⚠️ a run-log past its cadence budget FAILS — the defect SEC-146 ships', () => {
    // The load-bearing case. All three logs were in this state for ten days,
    // while every "did the routine run?" control stayed correct and green.
    const r = run(makeTree({ rows: { 'daily-security': ['| 2026-07-01 | r | PASS | x | none | y |'] } }));
    expect(r.status).toBe(1);
    expect(said(r)).toMatch(/daily-security run-log is STALE/);
  });

  test('a fresh corpus passes — the gate is not always-fire', () => {
    // Without this, "a stale log fails" would also be satisfied by a checker
    // that fails unconditionally, and the suite would prove nothing.
    const r = run(makeTree());
    expect(r.status).toBe(0);
    expect(said(r)).toMatch(/All 3 routine run-logs carry evidence/);
  });

  test('⚠️ FAILS CLOSED: a missing run-log exits 2, it does not report clean', () => {
    // Gotcha #30 — a guard that infers "the file was read" from the absence of
    // an exception reports a clean scan having read nothing.
    const r = run(makeTree({ omit: ['staging-soak'] }));
    expect(r.status).toBe(2);
    expect(said(r)).toMatch(/NOT MEASURED for staging-soak/);
  });

  test('⚠️ "could not check" and "is stale" never borrow each other\'s words', () => {
    // CTL-059's lesson: a finding must describe the failure it actually had.
    // These are different claims about the world and a reader acts on them
    // differently — one means go and look at the routine, the other means the
    // control itself is broken.
    const stale = said(run(makeTree({ rows: { 'weekly-health': ['| 2026-01-01 | r | PASS | x | none | y |'] } })));
    const unreadable = said(run(makeTree({ omit: ['weekly-health'] })));

    expect(stale).toMatch(/is STALE/);
    expect(stale).not.toMatch(/NOT MEASURED/);
    expect(unreadable).toMatch(/NOT MEASURED/);
    expect(unreadable).not.toMatch(/is STALE/);
  });

  test('a routine with no cadence registration is reported, never guessed', () => {
    // The budgets are the estate's numbers, published for routine-watchdog.sh.
    // Substituting a default would make this control and the watchdog disagree
    // about the same routine while both looked healthy.
    const room = ROOM_FIXTURE.replace(/.*staging-soak.*\n/, '');
    const r = run(makeTree({ room }));
    expect(r.status).toBe(2);
    expect(said(r)).toMatch(/cadence budget is unknown/);
  });

  test('⚠️ a blank line inside the table does not truncate the scan', () => {
    // WEEKLY_HEALTH_REGRESSION_ROUTINE.md really contains one. Per CommonMark it
    // ENDS the table, so a markdown-AST parser sees only the rows above it and
    // reports a perfectly fresh log as eight days stale.
    const r = run(makeTree({
      rows: {
        'weekly-health': [
          '| 2026-08-01 | r | PASS | x | none | y |',
          '',
          '| 2026-08-14 | r | PASS | x | none | y |',
        ],
      },
    }));
    expect(r.status).toBe(0);
  });

  test('⚠️ the newest row is found by date, not by position', () => {
    // DAILY_SECURITY_CHECK.md's tail is genuinely out of order (07-25, 07-28,
    // 07-27) and STAGING_SOAK prepends while the other two append. Re-sorting a
    // log so a positional parser works would be editing dated measurements while
    // claiming to tidy them — an earlier backfill did that and was discarded.
    const r = run(makeTree({
      rows: {
        'daily-security': [
          '| 2026-08-14 | r | PASS | x | none | y |',
          '| 2026-07-28 | r | PASS | x | none | y |',
          '| 2026-07-27 | r | PASS | x | none | y |',
        ],
      },
    }));
    expect(r.status).toBe(0);
  });

  test('⚠️ REAL DOCS: all three tables parse and all three budgets resolve', () => {
    // The half no fixture can stand in for. With the clock pinned before every
    // row, the expected answer is knowable without knowing today's state: each
    // log's newest row is "ahead of today". Reaching that verdict at all proves
    // the table was located, a date was read out of it, and the budget was found
    // in the real Control Room. A renamed header or a moved table gives 2.
    const r = run(makeRealDocsTree(), [], '2020-01-01T00:00:00Z');
    expect(r.status).toBe(1);
    for (const log of LOGS) {
      expect(`${log.routine}: ${said(r).includes(`${log.routine} run-log`)}`).toBe(
        `${log.routine}: true`,
      );
    }
    expect(said(r)).not.toMatch(/NOT MEASURED/);
  });

  test('⚠️ REAL DOCS: with the clock far ahead, every log reads STALE', () => {
    // The other end of the same proof, and it exercises the arithmetic rather
    // than the future short-circuit. Still time-independent: no row added
    // tomorrow moves a 2030 clock.
    const r = run(makeRealDocsTree(), [], '2030-01-01T00:00:00Z');
    expect(r.status).toBe(1);
    expect(said(r).match(/run-log is STALE/g)).toHaveLength(LOGS.length);
  });

  test('each run-log header appears EXACTLY ONCE in its real document', () => {
    // What keeps this file's fixtures honest, and a drift guard in its own
    // right: a second table opening the same way makes the run log ambiguous,
    // and zero occurrences means the control is anchored to nothing.
    expect(LOGS.length).toBe(3);
    for (const log of LOGS) {
      const text = fs.readFileSync(path.join(ROOT, log.doc), 'utf-8');
      const hits = text.split('\n').filter((l) => l.startsWith(log.header)).length;
      expect(`${log.doc}: ${hits}`).toBe(`${log.doc}: 1`);
    }
  });

  test('the Control Room registers a cadence budget for all three routines', () => {
    // The budget source. If a registration is dropped, CTL-062 reports that
    // routine unmeasurable — correct, but the cause is here, not in the checker.
    const text = fs.readFileSync(path.join(ROOT, CONTROL_ROOM), 'utf-8');
    for (const log of LOGS) {
      const found = new RegExp(`'${log.routine}\\|(\\d+)\\|`).exec(text);
      expect(`${log.routine} registered: ${Boolean(found)}`).toBe(
        `${log.routine} registered: true`,
      );
      expect(Number(found[1])).toBeGreaterThan(0);
    }
  });

  test('it is registered as a control and wired into a workflow that invokes it', () => {
    // CTL-041's lesson: a control the registry does not know about is one nobody
    // maintains, and a registered control nothing invokes is a claim.
    const registry = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'controls/registry.json'), 'utf-8'),
    );
    const entry = registry.controls.find((c) => c.id === 'CTL-062');
    expect(entry).toBeDefined();
    expect(entry.implementation).toBe(SRC.checkRunLogFreshness);
    expect(entry.prevents).toContain('SEC-146');
    expect(entry.wired_in.length).toBeGreaterThan(0);
    for (const wf of entry.wired_in) {
      const yml = fs.readFileSync(path.join(ROOT, wf), 'utf-8');
      expect(`${wf} invokes it: ${yml.includes(entry.implementation)}`).toBe(
        `${wf} invokes it: true`,
      );
    }
  });

  test('⚠️ the workflow is scheduled, self-tests first, and is NOT in the PR gate', () => {
    // This control goes red with the passage of TIME rather than the contents of
    // a diff. In pr-checks it would fail every unrelated PR the moment a routine
    // missed a day — the shape that froze the pipeline for ~11 days under SEC-88
    // (gotcha #23), and the shape of a gate someone eventually switches off.
    const yml = fs.readFileSync(path.join(ROOT, SRC.routineEvidence), 'utf-8');
    expect(yml).toMatch(/schedule:/);
    expect(yml).toMatch(/workflow_dispatch:/);
    expect(yml).toMatch(new RegExp(`${SRC.checkRunLogFreshness} --self-test`));

    const prChecks = fs.readFileSync(path.join(ROOT, SRC.prChecks), 'utf-8');
    expect(`pr-checks runs it: ${prChecks.includes(SRC.checkRunLogFreshness)}`).toBe(
      'pr-checks runs it: false',
    );
  });
});
