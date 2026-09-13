/**
 * SEC-103 — the migration that inverts the Supabase default function grant.
 *
 * WHAT THIS SUITE IS ACTUALLY FOR.
 * Not "does the migration exist". The migration contains one statement whose
 * correctness is invisible to every other check in the estate:
 *
 *   alter default privileges for role postgres
 *     revoke execute on functions from public;
 *
 * The built-in EXECUTE-to-PUBLIC default is GLOBAL, not per-schema. Adding
 * `in schema public` to that line — the obvious "tidy-up", and consistent with
 * every neighbouring statement — makes it a SILENT NO-OP that still returns
 * success (supabase/supabase#43884). Nothing goes red. The migration still
 * applies. `pg_default_acl` still gains a row. And every function created
 * afterwards is PUBLIC-executable again, which is half of the ten-ticket defect
 * class this migration exists to end.
 *
 * So the assertions below are about the SHAPE of two statements that must
 * differ from each other, in a file where the natural instinct is to make them
 * match. That is the SEC-152 shape: two places that must agree (or here,
 * deliberately disagree) with nothing comparing them.
 *
 * ⚠️ WHAT IT CAN AND CANNOT PROVE.
 * It pins the migration's CONTENT — a source-text scan, the weak instrument
 * gotcha #29 / CTL-039 keep catching this repo with. Every assertion therefore
 * matches on comment-STRIPPED SQL via the shared `tests/support/strip-comments`
 * helper (imported, never reimplemented — CTL-038). That matters more here than
 * usual: the migration's prose discusses `in schema public` at length precisely
 * to warn about this trap, so an unstripped scan would be satisfied by the
 * warning long after the statement it warns about had been broken.
 *
 * It cannot prove any database's defaults are actually inverted. Migrations
 * reach a database through the Supabase MCP without passing through a pull
 * request (gotcha #9) — the SEC-42 shape — and there is no `tests/integration/`
 * harness (BUGS-51). The behavioural half was proven by hand: a negative
 * control on dev BEFORE applying (a fresh SECURITY DEFINER function was born
 * `{=X/postgres,...,anon=X/postgres,authenticated=X/postgres,...}`, with
 * `has_function_privilege` true for both roles) and the identical probe after
 * applying returning `{postgres=X/postgres,service_role=X/postgres}` with both
 * false. Repeated on staging. Evidence is on SEC-103.
 *
 * STATED GAP: nothing re-checks the live default posture on a schedule.
 * `security_invariants_report()` is the natural home and is named on the ticket
 * rather than left implicit here — and note that the live backstop that would
 * carry it, `db-invariants.yml`, is itself red (SEC-164).
 */

import fs from 'fs';
import path from 'path';
import { stripComments } from '../support/strip-comments';

const MIGRATION = path.join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260820090000_sec103_invert_default_function_grant.sql'
);

/** Comment-stripped, whitespace-collapsed SQL — statements only. */
function sql(): string {
  const raw = fs.readFileSync(MIGRATION, 'utf8');
  return stripComments(raw, '.sql').replace(/\s+/g, ' ').toLowerCase();
}

/** The `alter default privileges ...;` statements, in file order. */
function alterStatements(): string[] {
  return sql()
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('alter default privileges'));
}

describe('SEC-103 — invert the default function grant (migration content)', () => {
  it('the migration file exists', () => {
    expect(fs.existsSync(MIGRATION)).toBe(true);
  });

  it('strips its own prose — the warning about the trap cannot satisfy an assertion', () => {
    const raw = fs.readFileSync(MIGRATION, 'utf8');
    // The file discusses this phrase repeatedly in comments. If stripping ever
    // silently degrades to a pass-through, this suite's central assertion
    // becomes comment-satisfiable, so prove the stripper is doing something.
    expect(raw).toMatch(/--.*in schema public/i);
    const stripped = stripComments(raw, '.sql');
    expect(stripped).not.toMatch(/--\s*GLOBAL form/i);
  });

  it('has exactly the two ALTER DEFAULT PRIVILEGES statements it needs', () => {
    const alters = alterStatements();
    // Assert the corpus before reasoning over it (catalogue failure mode 4):
    // an empty list would make every per-statement expectation below vacuous.
    expect(alters).toHaveLength(2);
  });

  it('revokes the anon/authenticated default WITH `in schema public`', () => {
    const perSchema = alterStatements().filter((s) => s.includes('in schema public'));
    expect(perSchema).toHaveLength(1);

    const stmt = perSchema[0];
    expect(stmt).toContain('for role postgres');
    expect(stmt).toMatch(/revoke execute on functions from .*\banon\b/);
    expect(stmt).toMatch(/revoke execute on functions from .*\bauthenticated\b/);
  });

  it('revokes the built-in PUBLIC default WITHOUT `in schema public` — the silent no-op trap', () => {
    const global = alterStatements().filter((s) => !s.includes('in schema'));
    expect(global).toHaveLength(1);

    const stmt = global[0];
    expect(stmt).toContain('for role postgres');
    expect(stmt).toMatch(/revoke execute on functions from\s+public\b/);

    // The whole point, stated as its own assertion so a failure names the
    // reason rather than an arity mismatch: qualifying THIS statement with a
    // schema is what makes it do nothing.
    expect(stmt).not.toContain('in schema');
  });

  it('the two revokes are not interchangeable — exactly one is schema-qualified', () => {
    const alters = alterStatements();
    const qualified = alters.filter((s) => s.includes('in schema public')).length;
    expect(qualified).toBe(1);
    expect(alters.length - qualified).toBe(1);
  });

  it('re-asserts an explicit grant for each RPC the app calls as `authenticated`', () => {
    const body = sql();
    for (const fn of [
      'admin_list_users',
      'admin_filter_profile_ids',
      'search_by_contact_hash',
    ]) {
      expect(body).toMatch(
        new RegExp(`grant execute on function\\s+public\\.${fn}\\s*\\([^)]*\\)\\s*to authenticated`)
      );
    }
  });

  it('does NOT grant get_metrics_for_window to authenticated (F-14 / SEC-07)', () => {
    const body = sql();

    // A negative assertion is worth nothing unless the thing it names could
    // actually appear (catalogue failure mode 3). Two separate proofs, because
    // the obvious single one is wrong and this suite caught itself on it:
    //
    //  (a) the identifier is REAL and spelled as the file spells it. It must be
    //      read from the RAW source — after stripping, `get_metrics_for_window`
    //      is absent from this migration by design, since the only place it
    //      appears is the comment explaining why it is not granted. Asserting
    //      `toContain` against the stripped body looked like a corpus check and
    //      was in fact an assertion that could only ever fail.
    const raw = fs.readFileSync(MIGRATION, 'utf8');
    expect(raw).toContain('get_metrics_for_window');

    //  (b) the pattern below can match SOMETHING in this file, so a match
    //      failing means "not granted" rather than "grants aren't written this
    //      way any more".
    expect(body).toMatch(/grant execute on function\s+public\.[a-z_]+\s*\([^)]*\)\s*to authenticated/);

    expect(body).not.toMatch(/grant execute on function\s+public\.get_metrics_for_window/);
    expect(body).not.toMatch(/get_metrics_for_window[^;]*to authenticated/);
  });

  it('grants nothing to anon', () => {
    expect(sql()).not.toMatch(/grant execute on function[^;]*\banon\b/);
  });
});
