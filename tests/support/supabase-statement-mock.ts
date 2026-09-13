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
  const statement: MockStatement = { table, kind: 'unknown', eq: [] };
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
};

export type StatementMockBuilder = {
  select: () => StatementMockBuilder;
  update: (data: unknown) => StatementMockBuilder;
  insert: (data: unknown) => Promise<{ error: null }>;
  upsert: (data: unknown) => Promise<{ error: null }>;
  delete: () => StatementMockBuilder;
  eq: (col: string, val: unknown) => StatementMockBuilder;
  single: () => Promise<{ data: unknown; error: null }>;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  then: (
    resolve: (v: { error: null }) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise<unknown>;
};

/** Builder for a single statement. Exported for tests that drive it directly. */
export function createStatementMockBuilder(
  table: string,
  options: StatementMockOptions,
): StatementMockBuilder {
  const statement = recordStatement(table);

  const b: StatementMockBuilder = {
    select: () => {
      statement.kind = 'select';
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
    single: () =>
      Promise.resolve({ data: options.single ? (options.single(table) ?? null) : null, error: null }),
    maybeSingle: () =>
      Promise.resolve({
        data: options.maybeSingle ? (options.maybeSingle(table) ?? null) : null,
        error: null,
      }),
    then: (resolve, reject) => Promise.resolve({ error: null }).then(resolve, reject),
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
