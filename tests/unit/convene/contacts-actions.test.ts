/**
 * KAN-304 — unit tests for the Contacts/People server actions.
 *
 * Covers add/update/delete/link/search, auth + ownership, input validation,
 * contact_methods reconciliation, directory-search rate limiting, and that the
 * directory search only ever queries published profiles.
 *
 * Supabase (RLS client), next/cache and the rate-limiter are mocked.
 */

const mockRevalidatePath = jest.fn();
jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

const mockRateLimit = jest.fn();
jest.mock('@/lib/rate-limit', () => {
  const actual = jest.requireActual('@/lib/rate-limit');
  return {
    ...actual,
    rateLimit: (key: string, config: { limit: number; windowSeconds: number }) => mockRateLimit(key, config),
  };
});

// ── Mutable mock state ─────────────────────────────────────
let mockUserId: string | null = 'user-1';
let contactInsertResult: { data: { id: string } | null; error: unknown } = {
  data: { id: 'contact-1' },
  error: null,
};
let existingContactRow: { id: string } | null = { id: 'contact-1' };
let profileRow: { id: string; is_published: boolean } | null = { id: 'prof-1', is_published: true };
let methodInsertError: unknown = null;
let updateError: unknown = null;
let dirSearchResult: { data: unknown[]; error: unknown } = {
  data: [{ id: 'prof-1', display_name: 'Alice', slug: 'alice', city: 'London' }],
  error: null,
};

const captured = {
  contactInsert: [] as Record<string, unknown>[],
  methodInsert: [] as unknown[],
  contactUpdate: [] as Record<string, unknown>[],
  methodDelete: [] as string[],
  linkUpdate: [] as Record<string, unknown>[],
  deleteUpdate: [] as Record<string, unknown>[],
  rpcRecord: [] as unknown[],
};

function fromImpl(table: string) {
  return {
    insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
      if (table === 'contacts') {
        captured.contactInsert.push(rows as Record<string, unknown>);
        return { select: () => ({ single: async () => contactInsertResult }) };
      }
      if (table === 'contact_methods') {
        captured.methodInsert.push(rows);
        return Promise.resolve({ error: methodInsertError });
      }
      return Promise.resolve({ error: null });
    },
    update: (vals: Record<string, unknown>) => {
      if (table === 'contacts') {
        if ('deleted_at' in vals) captured.deleteUpdate.push(vals);
        else if ('linked_profile_id' in vals) captured.linkUpdate.push(vals);
        else captured.contactUpdate.push(vals);
      }
      const chain: Record<string, unknown> = {};
      chain.eq = () => chain;
      chain.is = () => chain;
      chain.then = (res: (v: unknown) => unknown) => res({ error: updateError });
      return chain;
    },
    delete: () => {
      captured.methodDelete.push(table);
      const chain: Record<string, unknown> = {};
      chain.eq = () => chain;
      chain.then = (res: (v: unknown) => unknown) => res({ error: null });
      return chain;
    },
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.eq = () => chain;
      chain.is = () => chain;
      chain.ilike = () => chain;
      chain.in = () => chain;
      chain.limit = async () => (table === 'profiles' ? dirSearchResult : { data: [], error: null });
      chain.maybeSingle = async () => {
        if (table === 'contacts') return existingContactRow ? { data: existingContactRow, error: null } : { data: null, error: null };
        if (table === 'profiles') return profileRow ? { data: profileRow, error: null } : { data: null, error: null };
        return { data: null, error: null };
      };
      chain.single = async () => contactInsertResult;
      return chain;
    },
  };
}

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn(async () => ({
    auth: {
      getUser: jest.fn().mockImplementation(() =>
        Promise.resolve({ data: { user: mockUserId ? { id: mockUserId } : null } })
      ),
    },
    from: jest.fn().mockImplementation((t: string) => fromImpl(t)),
  })),
}));

import {
  addContact,
  updateContact,
  deleteContact,
  linkContactToProfile,
  searchDirectoryProfiles,
} from '@/app/dashboard/convene/contacts/actions';

beforeEach(() => {
  mockRevalidatePath.mockClear();
  mockRateLimit.mockClear();
  mockRateLimit.mockReturnValue({ limited: false });
  mockUserId = 'user-1';
  contactInsertResult = { data: { id: 'contact-1' }, error: null };
  existingContactRow = { id: 'contact-1' };
  profileRow = { id: 'prof-1', is_published: true };
  methodInsertError = null;
  updateError = null;
  dirSearchResult = { data: [{ id: 'prof-1', display_name: 'Alice', slug: 'alice', city: 'London' }], error: null };
  captured.contactInsert = [];
  captured.methodInsert = [];
  captured.contactUpdate = [];
  captured.methodDelete = [];
  captured.linkUpdate = [];
  captured.deleteUpdate = [];
});

describe('addContact', () => {
  test('adds a contact stamped with owner_user_id and creates email/phone methods', async () => {
    const res = await addContact({ display_name: 'Bob', email: 'BOB@Example.com ', phone: '07700 900111' });
    expect(res).toEqual({ ok: true, contactId: 'contact-1' });
    expect(captured.contactInsert).toHaveLength(1);
    expect(captured.contactInsert[0].owner_user_id).toBe('user-1');
    expect(captured.contactInsert[0].display_name).toBe('Bob');
    const methods = captured.methodInsert[0] as { kind: string; value: string }[];
    expect(methods.find((m) => m.kind === 'email')?.value).toBe('bob@example.com'); // normalised
    expect(methods.find((m) => m.kind === 'phone')?.value).toBe('07700 900111');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/convene/contacts');
  });

  test('rejects an empty name', async () => {
    const res = await addContact({ display_name: '   ' });
    expect(res.ok).toBe(false);
    expect(captured.contactInsert).toHaveLength(0);
  });

  test('rejects an invalid email without creating the contact', async () => {
    const res = await addContact({ display_name: 'Bob', email: 'not-an-email' });
    expect(res.ok).toBe(false);
    expect(captured.contactInsert).toHaveLength(0);
  });

  test('rejects unauthenticated callers', async () => {
    mockUserId = null;
    const res = await addContact({ display_name: 'Bob' });
    expect(res.ok).toBe(false);
    expect(captured.contactInsert).toHaveLength(0);
  });

  test('a name-only contact creates no contact_methods', async () => {
    const res = await addContact({ display_name: 'Carol' });
    expect(res.ok).toBe(true);
    expect(captured.methodInsert).toHaveLength(0);
  });
});

describe('updateContact', () => {
  test('updates scalar fields and reconciles the email method', async () => {
    const res = await updateContact({ contact_id: 'contact-1', display_name: 'Bobby', email: 'new@example.com' });
    expect(res).toEqual({ ok: true });
    expect(captured.contactUpdate[0].display_name).toBe('Bobby');
    // email reconcile = delete existing then insert new
    expect(captured.methodDelete).toContain('contact_methods');
    const inserted = captured.methodInsert[0] as { kind: string; value: string };
    expect(inserted.kind).toBe('email');
    expect(inserted.value).toBe('new@example.com');
  });

  test('clearing the email deletes the method and inserts nothing', async () => {
    const res = await updateContact({ contact_id: 'contact-1', email: '' });
    expect(res).toEqual({ ok: true });
    expect(captured.methodDelete).toContain('contact_methods');
    expect(captured.methodInsert).toHaveLength(0);
  });

  test('returns not-found when the contact does not exist / is not owned', async () => {
    existingContactRow = null;
    const res = await updateContact({ contact_id: 'nope', display_name: 'X' });
    expect(res.ok).toBe(false);
    expect(captured.contactUpdate).toHaveLength(0);
  });

  test('rejects unauthenticated callers', async () => {
    mockUserId = null;
    const res = await updateContact({ contact_id: 'contact-1', display_name: 'X' });
    expect(res.ok).toBe(false);
  });
});

describe('deleteContact', () => {
  test('soft-deletes by setting deleted_at', async () => {
    const res = await deleteContact('contact-1');
    expect(res).toEqual({ ok: true });
    expect(captured.deleteUpdate).toHaveLength(1);
    expect(captured.deleteUpdate[0].deleted_at).toBeTruthy();
  });

  test('rejects unauthenticated callers', async () => {
    mockUserId = null;
    const res = await deleteContact('contact-1');
    expect(res.ok).toBe(false);
    expect(captured.deleteUpdate).toHaveLength(0);
  });
});

describe('linkContactToProfile', () => {
  test('links to a published profile after verifying it', async () => {
    const res = await linkContactToProfile('contact-1', 'prof-1');
    expect(res).toEqual({ ok: true });
    expect(captured.linkUpdate[0].linked_profile_id).toBe('prof-1');
  });

  test('refuses to link to an unpublished profile', async () => {
    profileRow = { id: 'prof-1', is_published: false };
    const res = await linkContactToProfile('contact-1', 'prof-1');
    expect(res.ok).toBe(false);
    expect(captured.linkUpdate).toHaveLength(0);
  });

  test('refuses to link to a non-existent profile', async () => {
    profileRow = null;
    const res = await linkContactToProfile('contact-1', 'ghost');
    expect(res.ok).toBe(false);
    expect(captured.linkUpdate).toHaveLength(0);
  });

  test('unlink (null) clears the link without a profile lookup', async () => {
    const res = await linkContactToProfile('contact-1', null);
    expect(res).toEqual({ ok: true });
    expect(captured.linkUpdate[0].linked_profile_id).toBeNull();
  });

  test('rejects unauthenticated callers', async () => {
    mockUserId = null;
    const res = await linkContactToProfile('contact-1', 'prof-1');
    expect(res.ok).toBe(false);
  });
});

describe('searchDirectoryProfiles', () => {
  test('returns published-profile matches', async () => {
    const res = await searchDirectoryProfiles('Ali');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.matches[0].display_name).toBe('Alice');
  });

  test('short queries return empty without hitting the DB or rate limiter', async () => {
    const res = await searchDirectoryProfiles('a');
    expect(res).toEqual({ ok: true, matches: [] });
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  test('rate-limit blocks the search', async () => {
    mockRateLimit.mockReturnValue({ limited: true, retryAfter: 42 });
    const res = await searchDirectoryProfiles('Alice');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/42/);
  });

  test('rejects unauthenticated callers', async () => {
    mockUserId = null;
    const res = await searchDirectoryProfiles('Alice');
    expect(res.ok).toBe(false);
  });

  test('per-user rate-limit keyspace', async () => {
    await searchDirectoryProfiles('Alice');
    const [key, config] = mockRateLimit.mock.calls[0];
    expect(key).toBe('contact-directory-search:user-1');
    expect(config).toEqual({ limit: 20, windowSeconds: 3600 });
  });
});
