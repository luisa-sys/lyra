/**
 * Shared per-STATEMENT Supabase builder mock — KAN-459 §2 (route C4).
 *
 * ## The defect this exists to make impossible
 *
 * A hand-rolled Supabase mock usually records `.eq()` filters in one list per
 * TABLE. That list is then asserted against to prove a write is owner-scoped:
 *
 * ```ts
 * expect(eqCalls['school_affiliations']).toContainEqual(['profile_id', 'p-1'])
 * ```
 *
 * `updateSchoolAffiliation` reads the row before it writes it, and the pre-read
 * carries the same two filters. So the SELECT satisfied assertions that were
 * meant to be about the UPDATE: deleting `.eq('id', …)` OR `.eq('profile_id', …)`
 * from the UPDATE left the suite 27/27 GREEN, while the realised impact of that
 * class is editing another member's affiliation, or bulk-overwriting every row
 * the owner has. That is a tenancy/authorisation defect invisible to the suite
 * that claimed to cover it — the SEC-100 shape, where the check fires constantly
 * and answers a different question.
 *
 * **One `.from()` call is one statement.** Every statement keeps its own `eq`
 * log here, so a filter present on the read can never stand in for a filter
 * missing on the write. No detector can achieve that after the fact, which is
 * why the repo's defect-feedback loop prefers "impossible" over "detected".
 *
 * ## Using it
 *
 * `jest.mock()` factories are hoisted above imports, so the factory must
 * `require()` this module rather than close over an imported binding:
 *
 * ```ts
 * jest.mock('@/modules/platform/supabase-server', () => {
 *   const harness = require('../support/supabase-statement-mock');
 *   return {
 *     createClient: jest.fn().mockResolvedValue(
 *       harness.createStatementMockClient({
 *         getUserId: () => mockState.userId,
 *         single: (table) => (table === 'profiles' ? { id: 'profile-1' } : null),
 *       }),
 *     ),
 *   };
 * });
 *
 * import { statementLog, expectUpdateScopedTo } from '../support/supabase-statement-mock';
 *
 * beforeEach(() => statementLog.reset());
 * ```
 *
 * Jest's module registry hands the factory and the test body the same module
 * instance, so `statementLog` in the test observes what the factory recorded.
 *
 * `tests/support/**` is excluded from the F4 raw-literal ratchet precisely
 * because shared helpers belong here.
 */

export type StatementKind = 'select' | 'update' | 'insert' | 'upsert' | 'delete' | 'unknown';

export type MockStatement = {
  /** Table named in the `.from()` call that opened this statement. */
  table: string;
  /** Set by the first verb called on the builder; `unknown` if none was. */
  kind: StatementKind;
  /** `.eq()` filters applied to THIS statement only — never pooled. */
  eq: Array<[string, unknown]>;
  /** KAN-488: `.in()` filters applied to THIS statement, as `[column, values]`. */
  in: Array<[string, readonly unknown[]]>;
  /** KAN-488: `.order()` columns, in call order. */
  order: string[];
  /** KAN-488: the column list handed to `.select()`, or null if none was. */
  columns: string | null;
};

const statements: MockStatement[] = [];

/** Every `.from()` call since the last `reset()`, in order. */
export const statementLog = {
  get all(): readonly MockStatement[] {
    return statements;
  },
  reset(): void {
    statements.length = 0;
  },
  /** Statements of `kind` against `table`, in call order. */
  filter(table: string, kind: StatementKind): MockStatement[] {
    return statements.filter((s) => s.table === table && s.kind === kind);
  },
};

/**
 * The ONE statement of `kind` against `table`.
 *
 * Asserting there is exactly one is part of the point: "some statement
 * somewhere carried this filter" is the weak form that let a read stand in for
 * a write. Throws (via `expect`) when there is none, or more than one.
 */
export function onlyStatement(table: string, kind: StatementKind): MockStatement {
  const found = statementLog.filter(table, kind);
  expect(found).toHaveLength(1);
  return found[0];
}

/**
 * A write is safe only if the UPDATE statement ITSELF carries every filter.
 * For the profile-owned tables that means both: `id` alone would let it touch
 * another member's row, `profile_id` alone would bulk-overwrite every row the
 * owner has. Both must be independently load-bearing.
 */
export function expectUpdateScopedTo(
  table: string,
  filters: Array<[string, unknown]>,
): MockStatement {
  const update = onlyStatement(table, 'update');
  for (const filter of filters) {
    expect(update.eq).toContainEqual(filter);
  }
  return update;
}

/** Opens a new statement against `table` and returns its record. */
export function recordStatement(table: string): MockStatement {
  const statement: MockStatement = { table, kind: 'unknown', eq: [], in: [], order: [], columns: null };
  statements.push(statement);
  return statement;
}

export type StatementMockOptions = {
  /** Current `auth.getUser()` subject; `null` for an unauthenticated caller. */
  getUserId: () => string | null;
  /** Row returned by `.single()` for a given table. Defaults to `null`. */
  single?: (table: string) => unknown;
  /** Row returned by `.maybeSingle()` for a given table. Defaults to `null`. */
  maybeSingle?: (table: string) => unknown;
  /** Called with the payload handed to `.insert()`. */
  onInsert?: (table: string, data: unknown) => void;
  /** Called with the payload handed to `.update()`. */
  onUpdate?: (table: string, data: unknown) => void;
  /**
   * KAN-488: fixture rows for a table. When given, an awaited statement and
   * `.maybeSingle()` / `.single()` (without their own option) resolve to the
   * rows that pass THIS statement's recorded `.eq()` / `.in()` filters — so a
   * filter the code under test forgets really lets the row through.
   * Return `undefined` for a table with no fixture.
   */
  rows?: (table: string) => ReadonlyArray<Record<string, unknown>> | undefined;
  /** KAN-488: a read error for a table (simulates a failed statement). */
  error?: (table: string) => unknown;
};

export type StatementMockBuilder = {
  select: (columns?: string) => StatementMockBuilder;
  update: (data: unknown) => StatementMockBuilder;
  insert: (data: unknown) => Promise<{ error: null }>;
  upsert: (data: unknown) => Promise<{ error: null }>;
  delete: () => StatementMockBuilder;
  eq: (col: string, val: unknown) => StatementMockBuilder;
  in: (col: string, values: readonly unknown[]) => StatementMockBuilder;
  order: (col: string, opts?: unknown) => StatementMockBuilder;
  single: () => Promise<{ data: unknown; error: unknown }>;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  then: (
    resolve: (v: { data?: unknown; error: unknown }) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise<unknown>;
};

/** Builder for a single statement. Exported for tests that drive it directly. */
export function createStatementMockBuilder(
  table: string,
  options: StatementMockOptions,
): StatementMockBuilder {
  const statement = recordStatement(table);

  // KAN-488: fixture rows that pass this statement's own filters.
  const fixture = (): Array<Record<string, unknown>> | undefined => {
    const all = options.rows?.(table);
    if (all === undefined) return undefined;
    return all.filter(
      (row) =>
        statement.eq.every(([col, val]) => row[col] === val) &&
        statement.in.every(([col, values]) => values.includes(row[col])),
    );
  };
  const readError = (): unknown => (options.error ? (options.error(table) ?? null) : null);
  const oneRow = (explicit: ((t: string) => unknown) | undefined): unknown => {
    if (explicit) return explicit(table) ?? null;
    const rows = fixture();
    return rows === undefined ? null : (rows[0] ?? null);
  };

  const b: StatementMockBuilder = {
    select: (columns?: string) => {
      statement.kind = 'select';
      statement.columns = columns ?? null;
      return b;
    },
    update: (data: unknown) => {
      statement.kind = 'update';
      options.onUpdate?.(table, data);
      return b;
    },
    insert: (data: unknown) => {
      statement.kind = 'insert';
      options.onInsert?.(table, data);
      return Promise.resolve({ error: null });
    },
    upsert: (data: unknown) => {
      statement.kind = 'upsert';
      options.onInsert?.(table, data);
      return Promise.resolve({ error: null });
    },
    delete: () => {
      statement.kind = 'delete';
      return b;
    },
    eq: (col: string, val: unknown) => {
      statement.eq.push([col, val]);
      return b;
    },
    in: (col: string, values: readonly unknown[]) => {
      statement.in.push([col, [...values]]);
      return b;
    },
    order: (col: string) => {
      statement.order.push(col);
      return b;
    },
    single: () => Promise.resolve({ data: oneRow(options.single), error: readError() }),
    maybeSingle: () => Promise.resolve({ data: oneRow(options.maybeSingle), error: readError() }),
    then: (resolve, reject) => {
      const rows = fixture();
      const err = readError();
      const value =
        rows === undefined && err === null
          ? { error: null }
          : { data: err === null ? (rows ?? []) : null, error: err };
      return Promise.resolve(value).then(resolve, reject);
    },
  };
  return b;
}

/**
 * A Supabase client stand-in whose `.from()` opens a fresh statement each call.
 * Hand the result to whatever `createClient` mock the suite needs.
 */
export function createStatementMockClient(options: StatementMockOptions): {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: (table: string) => StatementMockBuilder;
} {
  return {
    auth: {
      getUser: () => {
        const id = options.getUserId();
        return Promise.resolve({ data: { user: id ? { id } : null } });
      },
    },
    from: (table: string) => createStatementMockBuilder(table, options),
  };
}
