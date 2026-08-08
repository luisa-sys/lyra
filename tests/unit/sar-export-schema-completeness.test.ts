/**
 * SEC-117 — the SAR export must cover every person-keyed table the deletion
 * cascade erases, and the check must derive that set from the SCHEMA.
 *
 * WHY THIS EXISTS ALONGSIDE sar-export-completeness.test.js
 * ---------------------------------------------------------
 * That file comments "Every table the deletion cascade removes must also be
 * exported" and then hard-codes an 18-entry list copied from the export itself.
 * It is a regression lock, not a completeness check: it detects a table being
 * REMOVED from the export, and is structurally incapable of detecting one that
 * was never added. Mutation-proven both directions — adding `from('tribes')` to
 * the export left it 24/24 green; renaming `from('contacts')` turned 1 red.
 *
 * It is not deleted here. Its assertions are still true and still useful; what
 * it cannot do is answer the question its own comment asks. This file answers
 * that question, by reading the committed schema.
 *
 * THE DEFECT IT WOULD HAVE CAUGHT
 * -------------------------------
 * 14 person-keyed tables existed in the schema and were absent from the export
 * — including `consent_log` (the record of the lawful basis itself),
 * `feature_entitlements`, `tribes` and `relationship_signals`. Because nothing
 * errored, `export_incomplete_errors` was absent too, so an incomplete Art.15
 * response was indistinguishable from a complete one.
 *
 * `tribes`, `tribe_members` and `consent_log` ship in the 2026-05-16 migrations
 * and `feature_entitlements` in 2026-06-22 — all predating SEC-71 (2026-07-22).
 * The guard was born narrower than its own header claim; this is not drift.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PERSON_KEYED_TABLES,
  JOIN_KEYED_TABLES,
  DELIBERATELY_EXCLUDED,
} from '@/lib/gdpr/person-keyed-tables';
import { SRC } from '../support/source-paths';

const ROOT = resolve(__dirname, '../..');

/**
 * Columns that key a row to a person. Derived from the committed prod schema
 * rather than listed by hand — a hand-listed set would reproduce exactly the
 * defect this file exists to prevent.
 */
const PERSON_COLUMNS = [
  'user_id',
  'profile_id',
  'owner_user_id',
  'actor_user_id',
  'host_user_id',
  'reporter_user_id',
  'subject_user_id',
];

function personKeyedTablesFromSchema(): Map<string, string[]> {
  const schema = readFileSync(resolve(ROOT, SRC.prod), 'utf-8');
  const out = new Map<string, string[]>();
  const table = /\n {6}(\w+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/g;
  let m: RegExpExecArray | null;
  while ((m = table.exec(schema))) {
    const [, name, body] = m;
    const keys = PERSON_COLUMNS.filter((c) =>
      new RegExp(`^\\s*${c}:`, 'm').test(body),
    );
    if (keys.length) out.set(name, keys);
  }
  return out;
}

const exportSource = () =>
  readFileSync(resolve(ROOT, SRC.settingsActions), 'utf-8');

describe('SEC-117: SAR export completeness, derived from the schema', () => {
  it('finds a non-trivial number of person-keyed tables (the check is not vacuous)', () => {
    // If the schema regex silently stopped matching, every assertion below
    // would pass over an empty set. Pin a floor so the check cannot evaporate.
    expect(personKeyedTablesFromSchema().size).toBeGreaterThan(20);
  });

  it('every person-keyed table has an explicit SAR decision', () => {
    const decided = new Set([
      ...Object.keys(PERSON_KEYED_TABLES),
      ...Object.keys(JOIN_KEYED_TABLES),
      ...Object.keys(DELIBERATELY_EXCLUDED),
    ]);

    const undecided = [...personKeyedTablesFromSchema().keys()]
      .filter((t) => !decided.has(t))
      .sort();

    // Adding a person-keyed table to a migration without deciding whether a
    // subject access request returns it is the defect. It must be a red build,
    // not a silent omission.
    expect(undecided).toEqual([]);
  });

  it('every directly-keyed table is actually queried by the export', () => {
    const src = exportSource();

    const notQueried = Object.keys(PERSON_KEYED_TABLES)
      .filter((t) => !src.includes(`.from('${t}')`))
      .sort();

    expect(notQueried).toEqual([]);
  });

  it('every join-keyed table is actually queried by the export', () => {
    const src = exportSource();

    const notQueried = Object.keys(JOIN_KEYED_TABLES)
      .filter((t) => !src.includes(`.from('${t}')`))
      .sort();

    expect(notQueried).toEqual([]);
  });

  it('each manifest key column exists on its table in the schema', () => {
    // A manifest naming a column the table does not have would filter on
    // nothing and silently return no rows — the same silent-incompleteness
    // failure one layer down. This caught a real error while writing it:
    // `oauth_connections` is keyed by `owner_user_id`, not `user_id`.
    const schema = personKeyedTablesFromSchema();
    const wrong: string[] = [];
    for (const [table, key] of Object.entries(PERSON_KEYED_TABLES)) {
      const keys = schema.get(table);
      if (keys && !keys.includes(key)) wrong.push(`${table}.${key}`);
    }

    expect(wrong).toEqual([]);
  });

  it('excluded tables carry a stated reason, not a bare listing', () => {
    for (const [table, reason] of Object.entries(DELIBERATELY_EXCLUDED)) {
      // "Excluded because someone excluded it" is how a decision becomes an
      // oversight a year later.
      expect(reason.length).toBeGreaterThan(20);
      expect(reason).toMatch(/SEC-\d+|Art\.\d+/);
      expect(table).not.toBe('');
    }
  });

  it('no table is in two lists at once', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const t of [
      ...Object.keys(PERSON_KEYED_TABLES),
      ...Object.keys(JOIN_KEYED_TABLES),
      ...Object.keys(DELIBERATELY_EXCLUDED),
    ]) {
      if (seen.has(t)) dupes.push(t);
      seen.add(t);
    }

    // A table both exported and excluded means the reader cannot tell which
    // decision is live.
    expect(dupes).toEqual([]);
  });
});
