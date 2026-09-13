/**
 * KAN-459 §2 — direct tests for the shared per-statement Supabase mock.
 *
 * The harness is consumed by suites that assert authorisation on writes, so a
 * bug in it silently weakens all of them at once. Coverage *through* a consumer
 * is not enough: a consumer only asserts positively, and a harness that became
 * more permissive would leave every consumer green. So the discriminating
 * property is asserted here directly and in the negative — the harness must
 * REFUSE a write whose filters were supplied by the pre-read.
 *
 * That refusal is the whole point of the module. The per-table pool it replaces
 * accepted exactly that case, which is how `updateSchoolAffiliation` could lose
 * either owner-scoping filter and leave its suite 27/27 green.
 */

import {
  createStatementMockBuilder,
  createStatementMockClient,
  expectUpdateScopedTo,
  onlyStatement,
  statementLog,
  type MockStatement,
  type StatementKind,
} from '../support/supabase-statement-mock';

const client = createStatementMockClient({
  getUserId: () => userId,
  single: (table) => (table === 'profiles' ? { id: 'profile-1' } : null),
  maybeSingle: (table) => (table === 'affiliations' ? { affiliation_type: 'school' } : null),
  onInsert: (table, data) => insertCapture(table, data),
  onUpdate: (table, data) => updateCapture(table, data),
});

let userId: string | null = 'user-1';
const insertCapture = jest.fn();
const updateCapture = jest.fn();

beforeEach(() => {
  statementLog.reset();
  insertCapture.mockClear();
  updateCapture.mockClear();
  userId = 'user-1';
});

/**
 * The read-then-write sequence that made the pooled mock vacuous: an ownership
 * pre-read carrying both filters, followed by an UPDATE carrying whichever
 * filters the caller asks for.
 */
async function readThenWrite(updateFilters: Array<[string, unknown]>): Promise<void> {
  await client
    .from('affiliations')
    .select()
    .eq('id', 'row-1')
    .eq('profile_id', 'profile-1')
    .maybeSingle();

  let write = client.from('affiliations').update({ description: 'Class of 2008' });
  for (const [col, val] of updateFilters) write = write.eq(col, val);
  await write;
}

describe('per-statement recording', () => {
  test('one .from() call opens one statement, in call order', async () => {
    await readThenWrite([['id', 'row-1']]);

    expect(statementLog.all).toHaveLength(2);
    expect(statementLog.all.map((s: MockStatement) => s.kind)).toEqual(['select', 'update']);
  });

  test("the pre-read's filters do NOT appear on the write statement", async () => {
    await readThenWrite([['id', 'row-1']]);

    const read = onlyStatement('affiliations', 'select');
    const write = onlyStatement('affiliations', 'update');

    expect(read.eq).toEqual([
      ['id', 'row-1'],
      ['profile_id', 'profile-1'],
    ]);
    // `profile_id` was never applied to the UPDATE, so it must be absent here.
    // A per-table pool would have shown both, and that is the entire defect.
    expect(write.eq).toEqual([['id', 'row-1']]);
  });

  test('reset() clears the log between tests', async () => {
    await readThenWrite([]);
    expect(statementLog.all.length).toBeGreaterThan(0);
    statementLog.reset();
    expect(statementLog.all).toHaveLength(0);
  });
});

describe('expectUpdateScopedTo refuses a read-satisfied write', () => {
  test('passes when the UPDATE itself carries both filters', async () => {
    await readThenWrite([
      ['id', 'row-1'],
      ['profile_id', 'profile-1'],
    ]);

    expect(() =>
      expectUpdateScopedTo('affiliations', [
        ['id', 'row-1'],
        ['profile_id', 'profile-1'],
      ]),
    ).not.toThrow();
  });

  // The two cases below are the ones a per-table pool passed. Each corresponds
  // to a real impact: `id` alone bulk-overwrites every row the owner has;
  // `profile_id` alone edits another member's row.
  test.each([
    ['profile_id missing from the UPDATE', [['id', 'row-1']] as Array<[string, unknown]>],
    ['id missing from the UPDATE', [['profile_id', 'profile-1']] as Array<[string, unknown]>],
    ['both missing from the UPDATE', [] as Array<[string, unknown]>],
  ])('throws when %s, even though the pre-read carried it', async (_label, updateFilters) => {
    await readThenWrite(updateFilters);

    expect(() =>
      expectUpdateScopedTo('affiliations', [
        ['id', 'row-1'],
        ['profile_id', 'profile-1'],
      ]),
    ).toThrow();
  });

  test('a per-TABLE pool of the same calls cannot tell those cases apart', async () => {
    // The counterfactual, so the per-statement split is demonstrably
    // load-bearing rather than a stylistic preference. Pooling every filter
    // seen against the table is what the replaced mocks did.
    await readThenWrite([]); // UPDATE carries NO filters at all

    const pooled = statementLog.all
      .filter((s: MockStatement) => s.table === 'affiliations')
      .flatMap((s: MockStatement) => s.eq);

    expect(pooled).toContainEqual(['id', 'row-1']);
    expect(pooled).toContainEqual(['profile_id', 'profile-1']);
    // Both assertions above pass while the UPDATE is completely unscoped.
    expect(onlyStatement('affiliations', 'update').eq).toEqual([]);
  });
});

describe('onlyStatement', () => {
  test('throws when no statement of that kind was issued', async () => {
    await client.from('affiliations').select().eq('id', 'row-1').maybeSingle();
    expect(() => onlyStatement('affiliations', 'update')).toThrow();
  });

  test('throws when the same table was written twice', async () => {
    await client.from('affiliations').update({ a: 1 }).eq('id', 'row-1');
    await client.from('affiliations').update({ b: 2 }).eq('id', 'row-2');
    expect(() => onlyStatement('affiliations', 'update')).toThrow();
  });

  test('does not confuse statements against different tables', async () => {
    await client.from('affiliations').update({ a: 1 }).eq('id', 'row-1');
    await client.from('links').update({ b: 2 }).eq('id', 'link-1');

    expect(onlyStatement('affiliations', 'update').eq).toEqual([['id', 'row-1']]);
    expect(onlyStatement('links', 'update').eq).toEqual([['id', 'link-1']]);
  });
});

describe('builder surface', () => {
  const verbs: Array<[StatementKind, (t: string) => unknown]> = [
    ['select', (t) => createStatementMockBuilder(t, { getUserId: () => null }).select()],
    ['update', (t) => createStatementMockBuilder(t, { getUserId: () => null }).update({})],
    ['insert', (t) => createStatementMockBuilder(t, { getUserId: () => null }).insert({})],
    ['upsert', (t) => createStatementMockBuilder(t, { getUserId: () => null }).upsert({})],
    ['delete', (t) => createStatementMockBuilder(t, { getUserId: () => null }).delete()],
  ];

  test('the verb corpus is non-empty', () => {
    expect(verbs.length).toBeGreaterThan(4);
  });

  test.each(verbs)('%s sets the statement kind', async (kind, run) => {
    await run('t');
    expect(statementLog.filter('t', kind)).toHaveLength(1);
  });

  test('a .from() with no verb stays `unknown` rather than guessing', () => {
    createStatementMockBuilder('t', { getUserId: () => null });
    expect(statementLog.filter('t', 'unknown')).toHaveLength(1);
  });

  test('insert and update payloads reach the supplied callbacks', async () => {
    await client.from('links').insert({ title: 'a' });
    await client.from('links').update({ title: 'b' }).eq('id', 'link-1');

    expect(insertCapture).toHaveBeenCalledWith('links', { title: 'a' });
    expect(updateCapture).toHaveBeenCalledWith('links', { title: 'b' });
  });

  test('single/maybeSingle return the configured row, and null elsewhere', async () => {
    await expect(client.from('profiles').select().single()).resolves.toEqual({
      data: { id: 'profile-1' },
      error: null,
    });
    await expect(client.from('links').select().single()).resolves.toEqual({
      data: null,
      error: null,
    });
    await expect(client.from('affiliations').select().maybeSingle()).resolves.toEqual({
      data: { affiliation_type: 'school' },
      error: null,
    });
  });

  test('single/maybeSingle default to null when no resolver is supplied', async () => {
    const bare = createStatementMockClient({ getUserId: () => null });
    await expect(bare.from('anything').select().single()).resolves.toEqual({
      data: null,
      error: null,
    });
    await expect(bare.from('anything').select().maybeSingle()).resolves.toEqual({
      data: null,
      error: null,
    });
  });
});

describe('auth', () => {
  test('returns the current subject', async () => {
    await expect(client.auth.getUser()).resolves.toEqual({ data: { user: { id: 'user-1' } } });
  });

  test('returns a null user when unauthenticated, read at call time', async () => {
    userId = null;
    await expect(client.auth.getUser()).resolves.toEqual({ data: { user: null } });
  });
});
