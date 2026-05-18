/**
 * KAN-244 — moderateAndAudit wrapper tests.
 *
 * Pure-policy behaviour is covered by `moderation-policy.test.ts`. This
 * file verifies the audit-row branch:
 *   - clean text → no insert
 *   - warn text → insert with severity='warn'
 *   - block text → insert with severity='block'
 *   - insert failure → still returns the same CheckResult to caller
 *   - snippet is truncated to 200 chars
 */

import { moderateAndAudit } from '@/lib/moderation-audit';

type InsertedRow = {
  profile_id: string | null;
  field: string;
  severity: 'warn' | 'block';
  flags: string[];
  content_snippet: string;
  source: string;
};

function makeStubSupabase(opts: { insertError?: string } = {}) {
  const inserted: InsertedRow[] = [];
  const stub = {
    from: jest.fn((_table: string) => ({
      insert: jest.fn(async (row: InsertedRow) => {
        if (opts.insertError) {
          return { error: { message: opts.insertError } };
        }
        inserted.push(row);
        return { error: null };
      }),
    })),
  };
  return { stub, inserted };
}

describe('KAN-244: moderateAndAudit', () => {
  test('clean text returns ok=true and writes no audit row', async () => {
    const { stub, inserted } = makeStubSupabase();
    const result = await moderateAndAudit(stub as never, {
      text: 'Hello world, I love cycling.',
      fieldType: 'public',
      field: 'profiles.bio_short',
      profileId: 'profile-1',
      source: 'web_app',
    });
    expect(result).toEqual({ ok: true });
    expect(inserted.length).toBe(0);
  });

  test('null/empty text passes silently — no insert', async () => {
    const { stub, inserted } = makeStubSupabase();
    await moderateAndAudit(stub as never, {
      text: null,
      field: 'profiles.bio_short',
      profileId: 'profile-1',
      source: 'web_app',
    });
    await moderateAndAudit(stub as never, {
      text: '',
      field: 'profiles.bio_short',
      profileId: 'profile-1',
      source: 'web_app',
    });
    expect(inserted.length).toBe(0);
  });

  test('public profanity blocks AND writes severity=block row', async () => {
    const { stub, inserted } = makeStubSupabase();
    const result = await moderateAndAudit(stub as never, {
      text: 'fuck this',
      fieldType: 'public',
      field: 'profiles.bio_short',
      profileId: 'profile-1',
      source: 'web_app',
    });
    expect(result.ok).toBe(false);
    expect(inserted.length).toBe(1);
    expect(inserted[0].severity).toBe('block');
    expect(inserted[0].field).toBe('profiles.bio_short');
    expect(inserted[0].profile_id).toBe('profile-1');
    expect(inserted[0].source).toBe('web_app');
    expect(inserted[0].flags.some((f) => f.startsWith('profanity:'))).toBe(true);
  });

  test('private profanity warns AND writes severity=warn row (does not block)', async () => {
    const { stub, inserted } = makeStubSupabase();
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await moderateAndAudit(stub as never, {
        text: 'fuck this',
        fieldType: 'private',
        field: 'manual_of_me.notes',
        profileId: 'profile-2',
        source: 'web_app',
      });
      expect(result).toEqual({ ok: true });
      expect(inserted.length).toBe(1);
      expect(inserted[0].severity).toBe('warn');
      expect(inserted[0].field).toBe('manual_of_me.notes');
    } finally {
      spy.mockRestore();
    }
  });

  test('snippet is capped at 200 chars (defence-in-depth — DB also enforces)', async () => {
    const { stub, inserted } = makeStubSupabase();
    const longProfanity = 'fuck ' + 'a'.repeat(500);
    await moderateAndAudit(stub as never, {
      text: longProfanity,
      fieldType: 'public',
      field: 'profiles.bio_short',
      profileId: 'profile-3',
      source: 'web_app',
    });
    expect(inserted.length).toBe(1);
    expect(inserted[0].content_snippet.length).toBeLessThanOrEqual(200);
  });

  test('source = "mcp_server" round-trips into the row', async () => {
    const { stub, inserted } = makeStubSupabase();
    await moderateAndAudit(stub as never, {
      text: 'fuck this',
      fieldType: 'public',
      field: 'profiles.bio_short',
      profileId: 'profile-4',
      source: 'mcp_server',
    });
    expect(inserted[0].source).toBe('mcp_server');
  });

  test('insert error does NOT propagate — wrapper returns same CheckResult', async () => {
    // Audit is side-effect, never blocks the user save. The insert
    // failing should produce a console.warn but the CheckResult shape
    // must match what checkModeration returned.
    const { stub } = makeStubSupabase({ insertError: 'table does not exist' });
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await moderateAndAudit(stub as never, {
        text: 'fuck this',
        fieldType: 'public',
        field: 'profiles.bio_short',
        profileId: 'profile-5',
        source: 'web_app',
      });
      // The block was detected — caller gets the same shape.
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/inappropriate language/i);
      }
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test('null profileId is permitted (pre-profile creation flows)', async () => {
    const { stub, inserted } = makeStubSupabase();
    await moderateAndAudit(stub as never, {
      text: 'fuck this',
      fieldType: 'public',
      field: 'profiles.bio_short',
      profileId: null,
      source: 'web_app',
    });
    expect(inserted[0].profile_id).toBeNull();
  });
});
