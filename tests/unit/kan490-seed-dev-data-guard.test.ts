/**
 * KAN-490 — scripts/seed-dev-data.sql must never write into a real account
 * (spec v0.8 §3: "Do not seed illustrative sample content into real
 * accounts"; founder answer 2026-11-23 "approved, go ahead").
 *
 * WHAT THIS CAN AND CANNOT PROVE.
 * The script only ever runs by hand in the dev SQL editor; CI has no Postgres
 * (no tests/integration harness, BUGS-51), so nothing here executes it. Two
 * kinds of assertion:
 *
 *   1. BEHAVIOURAL on the guard's regex. The reserved-email pattern is read
 *      out of the script and run against a LITERAL table of addresses with
 *      LITERAL expected verdicts (never derived from the script — catalogue
 *      failure mode 10). The pattern is a plain POSIX ERE that means the same
 *      in JS and in Postgres `~` (no classes, flags or lookarounds), and the
 *      script lower-cases emails before matching, as these inputs are.
 *   2. STRUCTURAL on comment-STRIPPED SQL (CTL-039 / gotcha #29): the header
 *      discusses guards, UUIDs and the old targets at length, so an
 *      unstripped scan would be satisfied by the prose.
 *
 * STATED GAP: whether the script parses and runs on Postgres is not proven
 * here — it was not executed against any database (the task forbids SQL
 * writes). Run it once on dev after creating the seed accounts.
 */

import fs from 'fs';
import path from 'path';
import { stripComments } from '../support/strip-comments';

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'seed-dev-data.sql');

/** Comment-stripped SQL, whitespace collapsed, lower-cased. */
function sql(): string {
  return stripComments(fs.readFileSync(SCRIPT, 'utf8'), '.sql').replace(/\s+/g, ' ').toLowerCase();
}

/** The reserved pattern exactly as the script declares it. */
function reservedPattern(): RegExp {
  const m = sql().match(/c_pattern constant text := '([^']+)'/);
  expect(m).not.toBeNull();
  return new RegExp((m as RegExpMatchArray)[1]);
}

/** Split on `;` outside single-quoted SQL strings (sample text contains `;`). */
function statementsOf(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (const ch of s) {
    if (ch === "'") inQuote = !inQuote; // '' escapes toggle twice, so they net out
    if (ch === ';' && !inQuote) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

/** Index of the first statement that writes to a real (non-temp) table. */
function firstRealWrite(s: string): number {
  const idx = [
    s.indexOf('update public.profiles'),
    s.indexOf('insert into public.profile_items'),
    s.indexOf('insert into public.profile_manual_of_me'),
    s.indexOf('insert into public.school_affiliations'),
  ];
  expect(idx.every((i) => i > 0)).toBe(true);
  return Math.min(...idx);
}

describe('KAN-490 seed-dev-data — the reserved-account guard (behavioural, on its regex)', () => {
  const cases: Array<[email: string, allowed: boolean, why: string]> = [
    ['seed.dev.alex@seed.checklyra.com', true, 'the dedicated seed account'],
    ['seed.dev.sam@seed.checklyra.com', true, 'the dedicated seed account'],
    ['seed.dev.new_one-2@seed.checklyra.com', true, 'a future seed.dev account'],
    ['person@example.com', false, 'an ordinary member address'],
    ['someone@gmail.com', false, 'an ordinary member address'],
    ['maria.demo@seed.checklyra.com', false, 'homepage-example style address on the demo domain'],
    ['seed.e2e.empty@seed.checklyra.com', false, 'an E2E user (recreated every run)'],
    ['seed.dev.alex@seed.checklyra.com.attacker.test', false, 'suffix look-alike'],
    ['seed.dev.alex@notseed.checklyra.com', false, 'domain look-alike'],
    ['seed.dev.alex@seedxchecklyra.com', false, 'the dots must be literal'],
    ['xseed.dev.alex@seed.checklyra.com', false, 'prefix look-alike'],
    ['seed.dev.@seed.checklyra.com', false, 'empty name part'],
  ];

  test('the corpus covers both verdicts', () => {
    expect(cases.filter((c) => c[1]).length).toBeGreaterThan(1);
    expect(cases.filter((c) => !c[1]).length).toBeGreaterThan(5);
  });

  test.each(cases)('%s → allowed=%s (%s)', (email, allowed) => {
    expect(reservedPattern().test(email)).toBe(allowed);
  });

  test('every address in the target list is a reserved seed.dev address', () => {
    const s = sql();
    const start = s.indexOf('insert into _seed_targets');
    expect(start).toBeGreaterThan(0);
    const block = s.slice(start);
    const emails = Array.from(
      block.slice(0, block.indexOf(';')).matchAll(/\(\s*'[a-z0-9_-]+'\s*,\s*'([^']+)'\s*\)/g),
      (m) => m[1],
    );
    expect(emails).toEqual(['seed.dev.alex@seed.checklyra.com', 'seed.dev.sam@seed.checklyra.com']);
  });
});

describe('KAN-490 seed-dev-data — structure (comment-stripped)', () => {
  test('no profile UUID literal anywhere: targets are found only by reserved email', () => {
    expect(sql()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    // Positive control: the UUID pattern does match a UUID.
    expect('00000000-0000-4000-8000-000000000000').toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    );
  });

  test('the whole script is one DO block, so the guards cannot be skipped by running part of it', () => {
    const s = sql().trim();
    expect(s.startsWith('do $seed$')).toBe(true);
    expect(s.endsWith('end $seed$;')).toBe(true);
    expect(s.split('$seed$').length).toBe(3); // exactly one open + one close
  });

  test('all four guards RAISE before the first write to a real table', () => {
    const s = sql();
    const write = firstRealWrite(s);
    const before = s.slice(0, write);
    expect((before.match(/raise exception/g) || []).length).toBe(4);
    // Guard 1 refuses any listed email OUTSIDE the pattern (`!~`, not `~`:
    // flipping it would refuse exactly the reserved accounts and nothing else).
    expect(before).toMatch(
      /from _seed_targets where lower\(email\) !~ c_pattern; if v_bad is not null then raise exception/,
    );
    // Guard 2 (defence in depth) re-checks the resolved profile against its
    // owner in auth.users, so a future change to how targets are resolved
    // (e.g. by slug) still cannot reach an account outside the pattern.
    expect(before).toMatch(/join auth\.users u on u\.id = p\.user_id where lower\(coalesce\(u\.email, ''\)\) !~ c_pattern/);
    // Guard 3 refuses homepage examples.
    expect(before).toMatch(/where p\.is_homepage_example; if v_bad is not null then raise exception/);
    // Targets that did not resolve are removed before any write.
    expect(before).toContain('delete from _seed_targets where profile_id is null');
  });

  test('every write to a real table is scoped through _seed_targets', () => {
    const statements = statementsOf(sql()).filter((x) => /^(update public\.|insert into public\.)/.test(x));
    expect(statements).toHaveLength(4);
    for (const st of statements) {
      expect(st).toContain('join _seed_targets t on t.seed_key = v.seed_key');
    }
  });

  test('the profile UPDATE is constrained to the target row (p.id = t.profile_id)', () => {
    // Without this predicate, UPDATE ... FROM (VALUES) JOIN _seed_targets is a
    // cross join with every profile on the database: it would fill empty
    // fields on real members' accounts — the exact spec §3 violation.
    const upd = statementsOf(sql()).filter((x) => x.startsWith('update public.profiles'));
    expect(upd).toHaveLength(1);
    expect(upd[0]).toMatch(/ where p\.id = t\.profile_id$/);
    // Exactly one top-level WHERE, so no OR / extra clause can widen it.
    expect(upd[0].split(' where ').length).toBe(2);
    expect(upd[0]).not.toMatch(/ where [^']* or /);
  });

  test('every INSERT writes the resolved seed profile id, never another id', () => {
    const inserts = statementsOf(sql()).filter((x) => x.startsWith('insert into public.'));
    expect(inserts).toHaveLength(3);
    for (const st of inserts) {
      expect(st).toMatch(/^insert into public\.[a-z_]+ \(profile_id, [^)]*\) select t\.profile_id, /);
    }
  });

  test('it never publishes a profile or flags a homepage example', () => {
    const s = sql();
    expect(s).not.toContain('is_published');
    expect(s).not.toMatch(/is_homepage_example\s*=/);
  });
});
