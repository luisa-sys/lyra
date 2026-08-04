/**
 * KAN-447 / KAN-448 — per-entry edit for links and affiliations.
 *
 * Both new actions are partial updates, so they carry two obligations the
 * existing add-paths don't:
 *
 *   1. **Only the fields the caller passes are written** — an omitted field
 *      must keep its stored value. This is the BUGS-74 contract; a whole-row
 *      write here would let an editor that renders a subset of the columns
 *      NULL the rest.
 *   2. **Every rule the add-path enforces still applies on edit** — sanitise,
 *      moderation, the http(s)-only URL check (KAN-219) and the KAN-404 school
 *      postcode requirement. An edit that skips them is a way around them.
 *
 * The tests drive the real server actions through a mocked Supabase client and
 * assert on the payload that reaches `.update()`, so deleting a check in
 * `actions.ts` turns them red. Filters are recorded PER STATEMENT — see the
 * `MockStatement` note below for why a per-table pool is not good enough.
 */

const mockInsertCapture = jest.fn();
const mockUpdateCapture = jest.fn();
const mockRevalidatePath = jest.fn();

/**
 * One `.from()` call === one statement, so each statement keeps its OWN `.eq()`
 * log rather than a pool shared per table.
 *
 * Pooling per table is what made the owner-scoping and row-id assertions
 * vacuous. `updateSchoolAffiliation` reads the row before it writes, and the
 * SELECT's `.eq('id', …)` / `.eq('profile_id', …)` satisfied assertions that
 * were meant to be about the UPDATE — so deleting either `.eq()` from the
 * UPDATE left all 27 tests green while an attacker could edit another member's
 * affiliation, or bulk-overwrite every affiliation the owner has. Read-satisfied
 * assertions about a write are the SEC-100 shape: the check fires constantly and
 * answers a different question.
 */
type MockStatement = {
  table: string;
  kind: 'select' | 'update' | 'insert' | 'unknown';
  eq: Array<[string, unknown]>;
};
const mockStatements: MockStatement[] = [];

const mockState: {
  userId: string | null;
  affiliationRow: { affiliation_type: string } | null;
} = {
  userId: 'kan447-user',
  affiliationRow: { affiliation_type: 'school' },
};

jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

jest.mock('@/lib/supabase-server', () => {
  type Builder = {
    select: () => Builder;
    update: (data: unknown) => Builder;
    insert: (data: unknown) => Promise<{ error: null }>;
    eq: (col: string, val: unknown) => Builder;
    single: () => Promise<{ data: unknown; error: null }>;
    maybeSingle: () => Promise<{ data: unknown; error: null }>;
    then: (
      resolve: (v: { error: null }) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise<unknown>;
  };

  const build = (table: string): Builder => {
    // Recorded per builder, i.e. per statement — never pooled across the
    // pre-read and the write (see the MockStatement note above).
    const statement: MockStatement = { table, kind: 'unknown', eq: [] };
    mockStatements.push(statement);

    const b: Builder = {
      select: () => {
        statement.kind = 'select';
        return b;
      },
      update: (data: unknown) => {
        statement.kind = 'update';
        mockUpdateCapture(table, data);
        return b;
      },
      insert: (data: unknown) => {
        statement.kind = 'insert';
        mockInsertCapture(table, data);
        return Promise.resolve({ error: null });
      },
      eq: (col: string, val: unknown) => {
        statement.eq.push([col, val]);
        return b;
      },
      single: () =>
        Promise.resolve(
          table === 'profiles'
            ? { data: { id: 'profile-1' }, error: null }
            : { data: null, error: null },
        ),
      maybeSingle: () =>
        Promise.resolve(
          table === 'school_affiliations'
            ? { data: mockState.affiliationRow, error: null }
            : { data: null, error: null },
        ),
      then: (resolve, reject) => Promise.resolve({ error: null }).then(resolve, reject),
    };
    return b;
  };

  return {
    createClient: jest.fn().mockResolvedValue({
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: mockState.userId ? { id: mockState.userId } : null },
          }),
      },
      from: (table: string) => build(table),
    }),
  };
});

import {
  addExternalLink,
  updateExternalLink,
  updateSchoolAffiliation,
} from '@/app/dashboard/profile/actions';

// Each test gets its own user id so the in-memory per-user write rate limit
// (KAN-231, 30/min) can never make a later test fail for an earlier test's
// reason.
let userCounter = 0;

beforeEach(() => {
  mockInsertCapture.mockClear();
  mockUpdateCapture.mockClear();
  mockRevalidatePath.mockClear();
  mockStatements.length = 0;
  userCounter += 1;
  mockState.userId = `kan447-user-${userCounter}`;
  mockState.affiliationRow = { affiliation_type: 'school' };
});

function statementsFor(table: string, kind: MockStatement['kind']): MockStatement[] {
  return mockStatements.filter((s) => s.table === table && s.kind === kind);
}

/**
 * The one statement of `kind` against `table`. Asserting there is exactly one
 * is part of the point: "some statement somewhere carried this filter" is the
 * weak form that let a read stand in for a write.
 */
function onlyStatement(table: string, kind: MockStatement['kind']): MockStatement {
  const found = statementsFor(table, kind);
  expect(found).toHaveLength(1);
  return found[0];
}

/**
 * A write is safe only if the UPDATE statement ITSELF carries both filters:
 * `id` alone would let it touch another member's row, `profile_id` alone would
 * bulk-overwrite every row the owner has.
 */
function expectUpdateScopedTo(table: string, rowId: string): void {
  const update = onlyStatement(table, 'update');
  expect(update.eq).toContainEqual(['id', rowId]);
  expect(update.eq).toContainEqual(['profile_id', 'profile-1']);
}

// ───────────── KAN-447: addExternalLink description ─────────────

describe('KAN-447: addExternalLink writes the description column', () => {
  test('a supplied description is sanitised and inserted', async () => {
    const result = await addExternalLink({
      title: 'My birthday wishlist',
      url: 'https://example.com/my-wishlist',
      description: 'Things <b>I have</b> had my eye on',
    });
    expect(result).toEqual({ success: true });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      'external_links',
      expect.objectContaining({ description: 'Things I have had my eye on' }),
    );
  });

  test('no description → NULL rather than an empty string', async () => {
    await addExternalLink({
      title: 'My birthday wishlist',
      url: 'https://example.com/my-wishlist',
    });
    expect(mockInsertCapture).toHaveBeenCalledWith(
      'external_links',
      expect.objectContaining({ description: null }),
    );
  });

  test('profane description → blocked, no write to external_links', async () => {
    const result = await addExternalLink({
      title: 'My birthday wishlist',
      url: 'https://example.com/my-wishlist',
      description: 'fuck this list',
    });
    expect(result.success).toBe(false);
    expect(mockInsertCapture).not.toHaveBeenCalledWith('external_links', expect.anything());
  });
});

// ───────────── KAN-447: updateExternalLink ─────────────

describe('KAN-447: updateExternalLink', () => {
  test('writes sanitised title/description/url, owner-scoped', async () => {
    const result = await updateExternalLink('link-1', {
      title: 'My <b>birthday</b> wishlist',
      description: 'Updated note',
      url: 'https://example.com/new-list',
    });
    expect(result).toEqual({ success: true });
    expect(mockUpdateCapture).toHaveBeenCalledWith('external_links', {
      title: 'My birthday wishlist',
      description: 'Updated note',
      url: 'https://example.com/new-list',
    });
    expectUpdateScopedTo('external_links', 'link-1');
    // `updateExternalLink` has no pre-read, so today nothing else COULD have
    // supplied those filters. Pinned so that a pre-read added later cannot
    // quietly start satisfying the assertion above on the UPDATE's behalf —
    // which is exactly how the sibling affiliations assertion went vacuous.
    expect(statementsFor('external_links', 'select')).toHaveLength(0);
  });

  test('omitted fields are not written at all (BUGS-74 partial-write contract)', async () => {
    await updateExternalLink('link-1', { title: 'Only the title' });
    expect(mockUpdateCapture).toHaveBeenCalledWith('external_links', { title: 'Only the title' });
  });

  test('empty description clears it to null', async () => {
    await updateExternalLink('link-1', { description: '' });
    expect(mockUpdateCapture).toHaveBeenCalledWith('external_links', { description: null });
  });

  test('empty title is rejected — a link needs a name', async () => {
    const result = await updateExternalLink('link-1', { title: '   ' });
    expect(result).toEqual({ success: false, error: 'Title cannot be empty' });
    expect(mockUpdateCapture).not.toHaveBeenCalledWith('external_links', expect.anything());
  });

  test('a non-http(s) url is rejected rather than silently dropped', async () => {
    const result = await updateExternalLink('link-1', { url: 'javascript:alert(1)' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/http:\/\/ or https:\/\//i);
    }
    expect(mockUpdateCapture).not.toHaveBeenCalledWith('external_links', expect.anything());
  });

  test('an empty url is rejected — a link cannot lose its url by being edited', async () => {
    const result = await updateExternalLink('link-1', { url: '' });
    expect(result.success).toBe(false);
    expect(mockUpdateCapture).not.toHaveBeenCalledWith('external_links', expect.anything());
  });

  test('profane title → blocked, no update', async () => {
    const result = await updateExternalLink('link-1', { title: 'fuck this list' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/inappropriate language/i);
    }
    expect(mockUpdateCapture).not.toHaveBeenCalledWith('external_links', expect.anything());
  });

  test('PII in the description → blocked, no update', async () => {
    const result = await updateExternalLink('link-1', {
      description: 'Call me on +44 7700 900123',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/personal information/i);
    }
    expect(mockUpdateCapture).not.toHaveBeenCalledWith('external_links', expect.anything());
  });

  test('an empty patch is a no-op success, not an UPDATE with an empty SET', async () => {
    const result = await updateExternalLink('link-1', {});
    expect(result).toEqual({ success: true });
    expect(mockUpdateCapture).not.toHaveBeenCalledWith('external_links', expect.anything());
  });

  test('not authenticated → no write attempted', async () => {
    mockState.userId = null;
    const result = await updateExternalLink('link-1', { title: 'Hi' });
    expect(result).toEqual({ success: false, error: 'Not authenticated' });
    expect(mockUpdateCapture).not.toHaveBeenCalled();
  });
});

// ───────────── KAN-448: updateSchoolAffiliation ─────────────

describe('KAN-448: updateSchoolAffiliation', () => {
  const POSTCODE_ERROR =
    'Schools need a postcode (full or partial) so people can tell schools with the same name apart.';

  test('writes sanitised name/location/description, owner-scoped', async () => {
    const result = await updateSchoolAffiliation('aff-1', {
      school_name: 'Greenfield <b>Primary</b>',
      school_location: 'SW1A 1AA',
      description: 'Class of 2008',
    });
    expect(result).toEqual({ success: true });
    expect(mockUpdateCapture).toHaveBeenCalledWith('school_affiliations', {
      school_name: 'Greenfield Primary',
      school_location: 'SW1A 1AA',
      description: 'Class of 2008',
    });
    // Asserted on the UPDATE statement specifically: the pre-read carries the
    // same two filters, so a pooled-per-table assertion passes here even when
    // the UPDATE itself carries neither.
    expectUpdateScopedTo('school_affiliations', 'aff-1');
  });

  test('the UPDATE carries the row id AND the owner scope, not just the pre-read', async () => {
    await updateSchoolAffiliation('aff-1', { description: 'Class of 2008' });

    const update = onlyStatement('school_affiliations', 'update');
    // Dropping `.eq('id', …)` from the UPDATE would bulk-overwrite every
    // affiliation this owner has; dropping `.eq('profile_id', …)` would let a
    // caller edit someone else's row. Both must be on the write.
    expect(update.eq).toContainEqual(['id', 'aff-1']);
    expect(update.eq).toContainEqual(['profile_id', 'profile-1']);
  });

  test('omitted fields are not written at all (BUGS-74 partial-write contract)', async () => {
    await updateSchoolAffiliation('aff-1', { description: 'Class of 2008' });
    expect(mockUpdateCapture).toHaveBeenCalledWith('school_affiliations', {
      description: 'Class of 2008',
    });
  });

  test('KAN-404: a school cannot lose its postcode by being edited', async () => {
    const result = await updateSchoolAffiliation('aff-1', { school_location: '' });
    expect(result).toEqual({ success: false, error: POSTCODE_ERROR });
    expect(mockUpdateCapture).not.toHaveBeenCalledWith('school_affiliations', expect.anything());
  });

  test('KAN-404: a location with no digit is rejected for a school', async () => {
    const result = await updateSchoolAffiliation('aff-1', { school_location: 'London' });
    expect(result).toEqual({ success: false, error: POSTCODE_ERROR });
    expect(mockUpdateCapture).not.toHaveBeenCalledWith('school_affiliations', expect.anything());
  });

  test('the postcode rule follows the STORED type, not a caller-supplied one', async () => {
    mockState.affiliationRow = { affiliation_type: 'organisation' };
    const result = await updateSchoolAffiliation('aff-1', { school_location: 'London' });
    expect(result).toEqual({ success: true });
    expect(mockUpdateCapture).toHaveBeenCalledWith('school_affiliations', {
      school_location: 'London',
    });
  });

  test('an organisation can clear its location to null', async () => {
    mockState.affiliationRow = { affiliation_type: 'organisation' };
    await updateSchoolAffiliation('aff-1', { school_location: '' });
    expect(mockUpdateCapture).toHaveBeenCalledWith('school_affiliations', {
      school_location: null,
    });
  });

  test('empty description clears it to null', async () => {
    await updateSchoolAffiliation('aff-1', { description: '' });
    expect(mockUpdateCapture).toHaveBeenCalledWith('school_affiliations', { description: null });
  });

  test('empty name is rejected', async () => {
    const result = await updateSchoolAffiliation('aff-1', { school_name: '  ' });
    expect(result).toEqual({ success: false, error: 'Name cannot be empty' });
    expect(mockUpdateCapture).not.toHaveBeenCalledWith('school_affiliations', expect.anything());
  });

  test('profane name → blocked, no update', async () => {
    const result = await updateSchoolAffiliation('aff-1', { school_name: 'fuck primary' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/inappropriate language/i);
    }
    expect(mockUpdateCapture).not.toHaveBeenCalledWith('school_affiliations', expect.anything());
  });

  test('profane description → blocked, no update', async () => {
    const result = await updateSchoolAffiliation('aff-1', { description: 'fuck that place' });
    expect(result.success).toBe(false);
    expect(mockUpdateCapture).not.toHaveBeenCalledWith('school_affiliations', expect.anything());
  });

  test('a row the caller does not own is not found → no update', async () => {
    mockState.affiliationRow = null;
    const result = await updateSchoolAffiliation('aff-someone-else', { description: 'Hi' });
    expect(result).toEqual({ success: false, error: 'Affiliation not found' });
    expect(mockUpdateCapture).not.toHaveBeenCalledWith('school_affiliations', expect.anything());
  });

  test('the ownership lookup itself is scoped to the caller profile', async () => {
    await updateSchoolAffiliation('aff-1', { description: 'Class of 2008' });

    const read = onlyStatement('school_affiliations', 'select');
    expect(read.eq).toContainEqual(['id', 'aff-1']);
    expect(read.eq).toContainEqual(['profile_id', 'profile-1']);
  });

  test('an empty patch is a no-op success', async () => {
    const result = await updateSchoolAffiliation('aff-1', {});
    expect(result).toEqual({ success: true });
    expect(mockUpdateCapture).not.toHaveBeenCalledWith('school_affiliations', expect.anything());
  });

  test('not authenticated → no read and no write attempted', async () => {
    mockState.userId = null;
    const result = await updateSchoolAffiliation('aff-1', { description: 'Hi' });
    expect(result).toEqual({ success: false, error: 'Not authenticated' });
    expect(mockUpdateCapture).not.toHaveBeenCalled();
    expect(mockStatements.filter((s) => s.table === 'school_affiliations')).toHaveLength(0);
  });
});
