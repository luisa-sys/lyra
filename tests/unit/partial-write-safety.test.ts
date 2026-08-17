/**
 * BUGS-74 (generalised) — "partial read, whole-row write" must stay impossible.
 *
 * WHAT HAPPENED
 * -------------
 * The profile editor selected 4 of the 6 `profile_manual_of_me` columns. The
 * two it never loaded (`good_to_know`, `boundaries`) were seeded as '' in the
 * form, came back through the autosave as `undefined`, were coerced to null,
 * and were written over real members' saved text — on develop, staging, beta
 * AND production. BUGS-70 and BUGS-73 are the same family.
 *
 * THE TWO INDEPENDENT FAILURES
 * ----------------------------
 * A loader drifted from the field allowlist  ... AND
 * the write path treated "not provided" as "clear this".
 *
 * Either one alone is harmless. The WRITE-path defect is the load-bearing one:
 * fix it and a drifted loader is a display bug, not data loss. So this file
 * asserts both, write path first.
 *
 * WHY THIS FILE EXISTS ALONGSIDE THE BUGS-74 FILES
 * ------------------------------------------------
 * `bugs74-manual-of-me-partial-save.test.ts` and
 * `bugs74-manual-of-me-field-coverage.test.ts` pin the specific incident. They
 * are deliberately narrow, and one of them carries the same weakness that
 * caused the incident to be half-fixed the first time: a HARDCODED list of
 * loader files. The legacy editor was missed precisely because nobody added it
 * to such a list.
 *
 * This file is the general control:
 *   - loaders are DISCOVERED by scanning src/, never enumerated by hand
 *   - the allowlist is checked against the ACTUAL migration columns, so a new
 *     column that no one wires into the editor fails CI
 *   - the write-path contract is asserted for the `profiles` table too
 *
 * Static sibling: `scripts/check-partial-write-safety.py` (wired into
 * pr-checks.yml) fails any NEW allowlist-driven write action that lacks the
 * `undefined` guard.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

import { MANUAL_OF_ME_FIELDS } from '@/modules/profile/manual-of-me-fields';
import { ALLOWED_PROFILE_FIELDS } from '@/modules/profile/profile-fields';
import { SRC } from '../support/source-paths';

const REPO_ROOT = resolve(__dirname, '../..');
const SRC_ROOT = join(REPO_ROOT, 'src');
const MIGRATIONS_ROOT = join(REPO_ROOT, SRC.migrations);

// ---------------------------------------------------------------------------
// Registry — 1-1 "form-backed" tables whose allowlist IS the complete set of
// user-editable columns. Adding a table here buys it every check below.
//
// `profiles` is deliberately NOT here: its allowlist is a legitimate SUBSET of
// the table (id, user_id, slug, age_status … are system-managed), so the
// column-parity check does not apply. Its WRITE contract is asserted
// separately at the bottom of this file.
// ---------------------------------------------------------------------------
interface FormBackedTable {
  table: string;
  label: string;
  allowlist: readonly string[];
  allowlistRef: string;
  /** Columns that exist in the DB but are never user-editable. */
  systemColumns: readonly string[];
  ticket: string;
}

const FORM_BACKED_TABLES: FormBackedTable[] = [
  {
    table: 'profile_manual_of_me',
    label: 'Manual of Me',
    allowlist: MANUAL_OF_ME_FIELDS,
    allowlistRef: 'MANUAL_OF_ME_FIELDS',
    systemColumns: ['profile_id', 'created_at', 'updated_at'],
    ticket: 'BUGS-74',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function walkSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walkSourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** A discovered `.from('<table>').select(...)` read site. */
interface ReadSite {
  file: string;
  line: number;
  selectArg: string;
}

/**
 * Discover every read of `table` across src/ — no hardcoded file list.
 *
 * For each `.from('<table>')` we look at the chained calls that follow. A
 * `.select(` reached before any mutating call is a READ; a `.upsert(` /
 * `.insert(` / `.update(` / `.delete(` reached first means it is a write site
 * and carries no column expectation.
 */
function discoverReadSites(table: string): ReadSite[] {
  const sites: ReadSite[] = [];
  const fromPattern = new RegExp(`\\.from\\(\\s*['"\`]${table}['"\`]\\s*\\)`, 'g');

  for (const file of walkSourceFiles(SRC_ROOT)) {
    const source = readFileSync(file, 'utf-8');
    if (!source.includes(table)) continue;

    for (const match of source.matchAll(fromPattern)) {
      const tail = source.slice(match.index! + match[0].length);
      const selectIdx = tail.search(/\.select\s*\(/);
      const mutateIdx = tail.search(/\.(upsert|insert|update|delete)\s*\(/);

      if (selectIdx === -1) continue;
      if (mutateIdx !== -1 && mutateIdx < selectIdx) continue; // write site

      // Capture the select() argument (balanced enough for the single-string
      // and template-literal forms this codebase uses).
      const afterSelect = tail.slice(selectIdx);
      const argMatch = afterSelect.match(/\.select\s*\(\s*([\s\S]*?)\s*\)/);
      if (!argMatch) continue;

      sites.push({
        file: file.replace(`${REPO_ROOT}/`, ''),
        line: source.slice(0, match.index!).split('\n').length,
        selectArg: argMatch[1],
      });
    }
  }
  return sites;
}

/**
 * A select is safe when it either derives its column list from the shared
 * allowlist constant (drift-proof by construction) or names every field.
 */
function missingFields(selectArg: string, entry: FormBackedTable): string[] {
  if (selectArg.includes(entry.allowlistRef)) return []; // derived — cannot drift
  if (/^\s*['"`]\s*\*\s*['"`]\s*$/.test(selectArg)) return []; // select('*')
  return entry.allowlist.filter((f) => !selectArg.includes(f));
}

/** Derive a table's live column set by replaying its migrations in order. */
function columnsFromMigrations(table: string): string[] {
  const columns = new Set<string>();
  const files = readdirSync(MIGRATIONS_ROOT).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_ROOT, file), 'utf-8');
    if (!sql.includes(table)) continue;

    // Strip line comments so rollback hints in headers are never parsed as DDL.
    const body = sql
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');

    // CREATE TABLE <table> ( ... );
    const create = body.match(
      new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${table}\\s*\\(([\\s\\S]*?)\\n\\s*\\)\\s*;`, 'i'),
    );
    if (create) {
      for (const rawLine of create[1].split('\n')) {
        const line = rawLine.trim().replace(/,$/, '');
        if (!line) continue;
        if (/^(primary|foreign|unique|check|constraint)\b/i.test(line)) continue;
        const col = line.match(/^([a-z_][a-z0-9_]*)\s+/i);
        if (col) columns.add(col[1].toLowerCase());
      }
    }

    // ALTER TABLE <table> ADD COLUMN [IF NOT EXISTS] <col>
    const alterRe = new RegExp(
      `alter\\s+table\\s+(?:only\\s+)?(?:public\\.)?${table}\\b([\\s\\S]*?);`,
      'gi',
    );
    for (const alter of body.matchAll(alterRe)) {
      for (const add of alter[1].matchAll(
        /add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
      )) {
        columns.add(add[1].toLowerCase());
      }
      for (const drop of alter[1].matchAll(
        /drop\s+column\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
      )) {
        columns.delete(drop[1].toLowerCase());
      }
    }
  }
  return [...columns].sort();
}

// ===========================================================================
// 1. Allowlist ≡ actual DB columns
//    Catches: a migration adds a column, nobody wires it into the editor, and
//    the field is invisible + unsaveable forever (the pre-condition for the
//    BUGS-74 drift).
// ===========================================================================
describe('form-backed tables: allowlist matches the migrated columns', () => {
  test.each(FORM_BACKED_TABLES)(
    '$label ($table) — $allowlistRef covers every non-system column',
    (entry) => {
      const migrated = columnsFromMigrations(entry.table);

      // Non-vacuity: if the parser finds nothing, the migration idiom changed
      // and this assertion would silently pass on an empty set.
      expect(migrated.length).toBeGreaterThan(entry.systemColumns.length);

      const editable = migrated.filter((c) => !entry.systemColumns.includes(c));
      const declared = [...entry.allowlist].sort();

      expect(editable.sort()).toEqual(declared);
    },
  );
});

// ===========================================================================
// 2. Every DISCOVERED reader loads the full allowlist
//    Generalises bugs74-manual-of-me-field-coverage.test.ts, whose hardcoded
//    LOADERS array is the very weakness that let the legacy editor stay broken
//    after the first fix.
// ===========================================================================
describe('form-backed tables: every reader loads the full field set', () => {
  test.each(FORM_BACKED_TABLES)(
    '$label ($table) — all discovered read sites cover $allowlistRef',
    (entry) => {
      const sites = discoverReadSites(entry.table);

      // Non-vacuity: the editor and the public profile both read this table.
      // Zero discovered sites means the scanner has drifted, not that the code
      // is clean.
      expect(sites.length).toBeGreaterThanOrEqual(2);

      const offenders = sites
        .map((s) => ({ ...s, missing: missingFields(s.selectArg, entry) }))
        .filter((s) => s.missing.length > 0);

      expect(
        offenders.map((o) => `${o.file}:${o.line} is missing [${o.missing.join(', ')}]`),
      ).toEqual([]);
    },
  );

  test('the scanner finds the loaders we already know about', () => {
    const files = discoverReadSites('profile_manual_of_me').map((s) => s.file);
    // These three were the BUGS-74 blast radius. If the scanner stops seeing
    // them, coverage above is meaningless.
    expect(files).toEqual(
      expect.arrayContaining([
        SRC.profilePage,
        SRC.slugPage,
        SRC.legacyPage,
      ]),
    );
  });
});

// ===========================================================================
// 3. Negative controls — prove the checks above are not vacuous
// ===========================================================================
describe('the guards themselves reject the shapes that caused BUGS-74', () => {
  const entry = FORM_BACKED_TABLES[0];

  test('rejects the pre-fix four-column select', () => {
    expect(
      missingFields(
        "'communication_style, working_preferences, energises_me, drains_me'",
        entry,
      ),
    ).toEqual(['good_to_know', 'boundaries']);
  });

  test('accepts a select derived from the allowlist constant', () => {
    expect(missingFields('MANUAL_OF_ME_FIELDS.join(\', \')', entry)).toEqual([]);
  });

  test('accepts a literal select that names every field', () => {
    expect(missingFields(`'${entry.allowlist.join(', ')}'`, entry)).toEqual([]);
  });

  test('the migration parser actually parses (not an empty set)', () => {
    const cols = columnsFromMigrations('profile_manual_of_me');
    expect(cols).toEqual(
      expect.arrayContaining([
        'profile_id',
        'communication_style',
        'working_preferences',
        'energises_me',
        'drains_me',
        'good_to_know',
        'boundaries',
      ]),
    );
  });
});

// ===========================================================================
// 4. Write-path contract for `profiles`
//    The Manual-of-Me write contract is pinned in
//    bugs74-manual-of-me-partial-save.test.ts. `updateProfileFields` writes the
//    much larger `profiles` table and was only ACCIDENTALLY safe: `undefined`
//    was copied into the payload and merely happened to be dropped by JSON
//    serialisation on the way to PostgREST. One `?? null` would have re-created
//    BUGS-74 on the primary profile table. Pin the contract so it cannot.
// ===========================================================================
const mockRevalidatePath = jest.fn();
jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

const mockUpdateCapture = jest.fn();
const mockEqResolve = jest.fn().mockResolvedValue({ error: null });

jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } } }),
    },
    from: jest.fn().mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: jest
            .fn()
            .mockResolvedValue({ data: { id: 'test-profile-id' }, error: null }),
          maybeSingle: jest
            .fn()
            .mockResolvedValue({ data: { age_status: 'passed' }, error: null }),
        }),
      }),
      update: (data: unknown) => {
        mockUpdateCapture(data);
        return { eq: mockEqResolve };
      },
      insert: jest.fn().mockResolvedValue({ error: null }),
    })),
  }),
}));

// jest.mock calls above are hoisted, so this import resolves against the mocks.
import { updateProfileFields } from '@/app/dashboard/profile/actions';

describe('updateProfileFields — "not provided" never destroys a stored value', () => {
  beforeEach(() => {
    mockUpdateCapture.mockClear();
    mockRevalidatePath.mockClear();
    mockEqResolve.mockClear();
    mockEqResolve.mockResolvedValue({ error: null });
  });

  test('an undefined field is omitted from the UPDATE payload entirely', async () => {
    // The exact shape a partially-loaded editor sends.
    await updateProfileFields({
      display_name: 'Alice',
      headline: undefined as unknown as string,
      bio_short: undefined as unknown as string,
    });

    const payload = mockUpdateCapture.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('headline');
    expect(payload).not.toHaveProperty('bio_short');
    expect(payload).toEqual({ display_name: 'Alice' });
  });

  test('an explicit null still clears the column (the fix must not overshoot)', async () => {
    await updateProfileFields({ headline: null });
    expect(mockUpdateCapture.mock.calls[0][0]).toEqual({ headline: null });
  });

  test('clearing one field while omitting another clears only the one', async () => {
    await updateProfileFields({
      headline: null,
      bio_short: undefined as unknown as string,
    });

    const payload = mockUpdateCapture.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toEqual({ headline: null });
    expect(payload).not.toHaveProperty('bio_short');
  });

  test('an all-undefined payload never fires a write', async () => {
    const result = await updateProfileFields({
      display_name: undefined as unknown as string,
      headline: undefined as unknown as string,
    });

    expect(result).toEqual({ success: true });
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });

  test('the allowlist is non-trivial (guards above are not vacuous)', () => {
    expect(ALLOWED_PROFILE_FIELDS.length).toBeGreaterThanOrEqual(8);
    expect(ALLOWED_PROFILE_FIELDS).toContain('display_name');
  });
});
