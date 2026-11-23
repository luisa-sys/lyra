/**
 * KAN-487 — v0.8 profile editor server actions (spec v0.8 §1 "Save all
 * sections together atomically", §3; plan §B "Server action flow", §F).
 *
 * Drives the real `editor-actions.ts` → real `save-profile.ts`,
 * `photo-staging.ts`, `validate-save-payload.ts`, `db-error-copy.ts`, through
 * a mocked Supabase client (rpc / from / storage). `publishProfile` is mocked
 * so the service-role write never runs. Expected values are spec / approved
 * copy literals.
 */

const USER_PREFIX = 'kan487-act-user';

const mockRpc = jest.fn();
const mockPublishProfile = jest.fn();
const mockRevalidatePath = jest.fn();
const mockUpload = jest.fn();
const mockList = jest.fn();
const mockRemove = jest.fn();
const mockModerationInsert = jest.fn();
const mockRateLimit = jest.fn();

const mockState: {
  userId: string | null;
  /** Rows returned by successive `profiles` snapshot reads (last one repeats). */
  profileRows: Array<Record<string, unknown> | null>;
  profileReads: number;
} = { userId: null, profileRows: [], profileReads: 0 };

jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

jest.mock('@/modules/guards/profile-rate-limit', () => ({
  checkProfileWriteRateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

jest.mock('@/app/dashboard/profile/actions', () => ({
  publishProfile: (...args: unknown[]) => mockPublishProfile(...args),
}));

jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: jest.fn().mockImplementation(() =>
    Promise.resolve({
      auth: {
        getUser: () =>
          Promise.resolve({ data: { user: mockState.userId ? { id: mockState.userId } : null } }),
      },
      rpc: (...args: unknown[]) => mockRpc(...args),
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => {
                  const rows = mockState.profileRows;
                  const row = rows[Math.min(mockState.profileReads, rows.length - 1)] ?? null;
                  mockState.profileReads += 1;
                  return Promise.resolve({ data: row, error: null });
                },
              }),
            }),
          };
        }
        if (table === 'conversation_starter_prompts') {
          return {
            select: () => ({
              in: () => Promise.resolve({ data: [{ id: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', answer_max: 1000 }], error: null }),
            }),
          };
        }
        if (table === 'content_moderation_flags') {
          return {
            insert: (row: unknown) => {
              mockModerationInsert(row);
              return Promise.resolve({ error: null });
            },
          };
        }
        throw new Error(`Unexpected table in mock: ${table}`);
      },
      storage: {
        from: (bucket: string) => {
          if (bucket !== 'profile-photos') throw new Error(`Unexpected bucket: ${bucket}`);
          return {
            upload: (...args: unknown[]) => mockUpload(...args),
            list: (...args: unknown[]) => mockList(...args),
            remove: (...args: unknown[]) => mockRemove(...args),
            getPublicUrl: (path: string) => ({
              data: { publicUrl: `https://cdn.example.test/profile-photos/${path}` },
            }),
          };
        },
      },
    }),
  ),
}));

import {
  publishProfileFromEditor,
  saveProfileChanges,
  saveProfileDraft,
  stageProfilePhoto,
} from '@/app/dashboard/profile/editor-actions';
import type { EditorState, SavePayload } from '@/modules/profile/editor/editor-state';

let n = 0;
let uid = '';

const BASE = '2026-11-23T10:00:00.000Z';
const SAVED_AT = '2026-11-23T10:05:00.000Z';
/** updated_at / first_published_at after publishProfile() wrote the row. */
const PUBLISHED_AT = '2026-11-23T10:05:01.250Z';

const PRESET_ID = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';

/** The stored identity a draft save returns (save_profile's jsonb, KAN-487 review M4). */
const DRAFT_IDENTITY = {
  slug: 'user_ab12cd',
  slugConfirmed: false,
  avatarUrl: null,
  isPublished: false,
  firstPublishedAt: null,
} as const;

function draftRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'profile-1',
    updated_at: BASE,
    slug: 'user_ab12cd',
    slug_confirmed: false,
    display_name: '',
    avatar_url: null,
    is_published: false,
    first_published_at: null,
    ...over,
  };
}

function readyRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return draftRow({
    slug: 'ada_l',
    slug_confirmed: true,
    display_name: 'Ada Lovelace',
    avatar_url: 'https://cdn.example.test/profile-photos/x/avatar-1.jpg?v=1',
    ...over,
  });
}

function rpcOk(over: Record<string, unknown> = {}) {
  return {
    data: {
      updated_at: SAVED_AT,
      ids: {},
      warnings: {},
      slug: 'user_ab12cd',
      slug_confirmed: false,
      avatar_url: null,
      is_published: false,
      first_published_at: null,
      ...over,
    },
    error: null,
  };
}

beforeEach(() => {
  n += 1;
  uid = `${USER_PREFIX}-${n}`;
  mockState.userId = uid;
  mockState.profileRows = [draftRow()];
  mockState.profileReads = 0;
  for (const m of [mockRpc, mockPublishProfile, mockRevalidatePath, mockUpload, mockList, mockRemove, mockModerationInsert, mockRateLimit]) {
    m.mockReset();
  }
  mockRateLimit.mockResolvedValue({ allowed: true });
  mockRpc.mockResolvedValue(rpcOk());
  mockPublishProfile.mockResolvedValue({ success: true });
  mockUpload.mockResolvedValue({ data: {}, error: null });
  mockList.mockResolvedValue({ data: [], error: null });
  mockRemove.mockResolvedValue({ data: [], error: null });
});

function rpcPayload(call = 0): SavePayload {
  const [fn, args] = mockRpc.mock.calls[call] as [string, { p_payload: SavePayload; p_mode: string }];
  expect(fn).toBe('save_profile');
  return args.p_payload;
}

function rpcMode(call = 0): string {
  return (mockRpc.mock.calls[call][1] as { p_mode: string }).p_mode;
}

// ── auth + validation ───────────────────────────────────────────────────

describe('KAN-487 editor actions: auth and validation before any write', () => {
  test('not authenticated → refused, no RPC', async () => {
    mockState.userId = null;
    await expect(saveProfileDraft({ base_updated_at: BASE, profile: { display_name: 'Ada' } })).resolves.toEqual({
      ok: false,
      error: 'Not authenticated',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('the profile write rate limit is checked once per save; when hit, no RPC', async () => {
    await saveProfileDraft({ base_updated_at: BASE, profile: { display_name: 'Ada' } });
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(mockRateLimit).toHaveBeenCalledWith(uid);

    mockRpc.mockClear();
    mockRateLimit.mockResolvedValue({
      allowed: false,
      reason: 'user',
      retryAfter: 12,
      result: { success: false, error: 'You are saving too quickly. Please wait 12s and try again.' },
    });
    await expect(saveProfileDraft({ base_updated_at: BASE, profile: { display_name: 'Ada' } })).resolves.toEqual({
      ok: false,
      error: 'You are saving too quickly. Please wait 12s and try again.',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('a validation failure returns fieldErrors and never calls the RPC', async () => {
    const res = await saveProfileDraft({ base_updated_at: BASE, profile: { display_name: 'A'.repeat(61) } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('We couldn’t save your changes. Your edits are still here.');
    expect(Object.keys(res.fieldErrors ?? {})).toEqual(['profile.display_name']);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('a non-object payload is refused without an RPC', async () => {
    const res = await saveProfileDraft(null as unknown as SavePayload);
    expect(res.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('blocked text (moderation) is refused before the RPC, keyed to the field', async () => {
    const res = await saveProfileDraft({ base_updated_at: BASE, profile: { headline: 'I really fucking love this' } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(Object.keys(res.fieldErrors ?? {})).toEqual(['profile.headline']);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('a preset answer within that preset’s own answer_max (1000) is accepted', async () => {
    const answer = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    expect(answer.length).toBeGreaterThan(500); // over the 500 default, under this preset's 1000
    expect(answer.length).toBeLessThanOrEqual(1000);
    const res = await saveProfileDraft({
      base_updated_at: BASE,
      questions: { upsert: [{ client_key: 'new:q1', prompt_id: PRESET_ID, answer }], delete: [] },
    });
    expect(res.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});

// ── draft ───────────────────────────────────────────────────────────────

describe('KAN-487 editor actions: Save Draft', () => {
  test('calls save_profile once in draft mode and returns ids, updatedAt, warnings', async () => {
    mockRpc.mockResolvedValue(rpcOk({ ids: { 'new:a': 'uuid-a' } }));
    const payload: SavePayload = { base_updated_at: BASE, profile: { display_name: 'Ada' } };
    await expect(saveProfileDraft(payload)).resolves.toEqual({
      ok: true,
      idMap: { 'new:a': 'uuid-a' },
      updatedAt: SAVED_AT,
      warnings: {},
      ...DRAFT_IDENTITY,
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(rpcMode()).toBe('draft');
    expect(rpcPayload()).toEqual(payload);
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/profile');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard');
    expect(mockPublishProfile).not.toHaveBeenCalled();
  });

  test('an invalid CheckLyra ID in a draft is dropped with a warning; the rest still saves', async () => {
    const res = await saveProfileDraft({ base_updated_at: BASE, profile: { display_name: 'Ada', slug: 'ab' } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.warnings.lyra_id).toBe('Your CheckLyra ID needs at least 3 characters.');
    expect(rpcPayload().profile).toEqual({ display_name: 'Ada' });
  });

  test('the RPC’s draft warning (taken ID) is passed through', async () => {
    mockRpc.mockResolvedValue(rpcOk({ warnings: { lyra_id: 'taken' } }));
    const res = await saveProfileDraft({ base_updated_at: BASE, profile: { slug: 'ada_l' } });
    expect(res).toEqual({ ok: true, idMap: {}, updatedAt: SAVED_AT, warnings: { lyra_id: 'taken' }, ...DRAFT_IDENTITY });
  });
});

// ── photo ───────────────────────────────────────────────────────────────

describe('KAN-487 editor actions: photo resolution', () => {
  test('a staged path from another user is rejected before the RPC', async () => {
    const res = await saveProfileDraft({
      base_updated_at: BASE,
      photo: { action: 'set', staged_path: `someone-else/avatar-11111111-1111-4111-8111-111111111111.jpg` },
    });
    expect(res).toEqual({
      ok: false,
      error: 'That photo is no longer available. Please upload it again.',
      fieldErrors: { photo: 'That photo is no longer available. Please upload it again.' },
    });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });

  test('a client-supplied avatar_url without a staged path is rejected', async () => {
    const res = await saveProfileDraft({
      base_updated_at: BASE,
      photo: { action: 'set', avatar_url: 'https://evil.example/x.jpg' },
    });
    expect(res.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('an own staged path becomes a server-built avatar_url; old avatars are cleaned up', async () => {
    const name = 'avatar-22222222-2222-4222-8222-222222222222.jpg';
    mockList.mockResolvedValue({ data: [{ name }, { name: 'avatar.jpg' }, { name: 'cv.pdf' }], error: null });
    const res = await saveProfileDraft({ base_updated_at: BASE, photo: { action: 'set', staged_path: `${uid}/${name}` } });
    expect(res.ok).toBe(true);

    const photo = rpcPayload().photo as { action: string; avatar_url?: string; staged_path?: string };
    expect(photo.action).toBe('set');
    expect(photo.staged_path).toBeUndefined();
    expect(photo.avatar_url).toMatch(
      new RegExp(`^https://cdn\\.example\\.test/profile-photos/${uid}/${name.replace(/\./g, '\\.')}\\?v=\\d+$`),
    );
    expect(mockRemove).toHaveBeenCalledWith([`${uid}/avatar.jpg`]);
  });

  test('a published save that removes the photo is rejected before the RPC', async () => {
    mockState.profileRows = [readyRow({ is_published: true })];
    const res = await saveProfileChanges({ base_updated_at: BASE, photo: { action: 'remove' } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('Add a new photo to save your changes — a published profile needs a photo.');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('a draft may remove the photo: avatar cleared and every avatar file removed', async () => {
    mockList.mockResolvedValue({ data: [{ name: 'avatar.jpg' }, { name: 'avatar-3.jpg' }], error: null });
    const res = await saveProfileDraft({ base_updated_at: BASE, photo: { action: 'remove' } });
    expect(res.ok).toBe(true);
    expect(rpcPayload().photo).toEqual({ action: 'remove' });
    expect(mockRemove).toHaveBeenCalledWith([`${uid}/avatar.jpg`, `${uid}/avatar-3.jpg`]);
  });
});

// ── RPC error mapping ───────────────────────────────────────────────────

describe('KAN-487 editor actions: RPC errors', () => {
  test('DETAIL client_key + trigger message → `<clientKey>.<field>`', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'title is longer than 80 characters',
        code: 'P0001',
        details: '{"section": "items", "client_key": "new:abc"}',
      },
    });
    const res = await saveProfileDraft({
      base_updated_at: BASE,
      items: {
        upsert: [{ client_key: 'new:abc', category: 'gift_ideas', title: 'Kite', description: null, url: null, group_label: null }],
        delete: [],
      },
    });
    expect(res).toEqual({
      ok: false,
      error: 'That title is too long. Please shorten it.',
      fieldErrors: { 'new:abc.title': 'That title is too long. Please shorten it.' },
    });
  });

  test('23505 on profiles_slug_lower_key → "That CheckLyra ID is already taken."', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'duplicate key value violates unique constraint "profiles_slug_lower_key"',
        code: '23505',
        details: '{"section": "slug", "client_key": null}',
      },
    });
    const res = await publishProfileFromEditor({ base_updated_at: BASE, profile: { slug: 'ada_l' } });
    expect(res).toEqual({
      ok: false,
      error: 'That CheckLyra ID is already taken.',
      fieldErrors: { 'profile.lyra_id': 'That CheckLyra ID is already taken.' },
    });
    expect(mockPublishProfile).not.toHaveBeenCalled();
  });

  test('a concurrent save elsewhere → the reload copy; client state is the client’s to keep', async () => {
    mockState.profileRows = [readyRow({ is_published: true })];
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'Your profile was saved somewhere else. Reload to see the latest version.',
        code: 'P0001',
        details: '{"section": "profile", "client_key": null}',
      },
    });
    const res = await saveProfileChanges({ base_updated_at: BASE, profile: { headline: 'Hi' } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('Your profile was saved somewhere else. Reload to see the latest version.');
    expect(rpcMode()).toBe('published');
  });
});

// ── publish ─────────────────────────────────────────────────────────────

describe('KAN-487 editor actions: Publish', () => {
  test('saves with mode "publish", re-reads the profile, THEN calls publishProfile', async () => {
    mockState.profileRows = [draftRow(), readyRow(), readyRow({ is_published: true, updated_at: PUBLISHED_AT, first_published_at: PUBLISHED_AT })];
    const res = await publishProfileFromEditor({ base_updated_at: BASE, profile: { display_name: 'Ada Lovelace' } });
    expect(res.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(rpcMode()).toBe('publish');
    expect(mockPublishProfile).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.invocationCallOrder[0]).toBeLessThan(mockPublishProfile.mock.invocationCallOrder[0]);
    expect(mockRevalidatePath).toHaveBeenCalledWith('/ada_l');
  });

  test('the DB identity decides: a stored profile with no photo is not published, whatever the client says', async () => {
    mockState.profileRows = [draftRow(), readyRow({ avatar_url: null })];
    const clientClaims = {
      photo: { kind: 'stored', url: 'https://cdn.example.test/x.jpg' },
      fields: { display_name: 'Ada Lovelace' },
      lyraId: 'ada_l',
    } as unknown as EditorState;
    const res = await publishProfileFromEditor({ base_updated_at: BASE, profile: { display_name: 'Ada' } }, clientClaims);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('Before you can publish: Add a profile photo.');
    expect(res.fieldErrors).toEqual({ photo: 'Add a profile photo' });
    expect('saved' in res && res.saved).toEqual({ ok: true, idMap: {}, updatedAt: SAVED_AT, warnings: {}, ...DRAFT_IDENTITY });
    expect(mockPublishProfile).not.toHaveBeenCalled();
  });

  test('all three blockers are reported together from the DB row', async () => {
    mockState.profileRows = [draftRow(), draftRow()];
    const res = await publishProfileFromEditor({ base_updated_at: BASE, profile: { headline: 'Hello' } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.fieldErrors).toEqual({
      photo: 'Add a profile photo',
      'profile.display_name': 'Add a display name',
      'profile.lyra_id': 'Choose a CheckLyra ID',
    });
    expect(mockPublishProfile).not.toHaveBeenCalled();
  });

  test('an unconfirmed placeholder ID (user_<hex>) does not count as chosen', async () => {
    mockState.profileRows = [draftRow(), readyRow({ slug: 'user_ab12cd', slug_confirmed: false })];
    const res = await publishProfileFromEditor({ base_updated_at: BASE, profile: { headline: 'Hello' } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.fieldErrors).toEqual({ 'profile.lyra_id': 'Choose a CheckLyra ID' });
    expect(mockPublishProfile).not.toHaveBeenCalled();
  });

  test('an invalid CheckLyra ID blocks a publish (it is not dropped as in a draft)', async () => {
    const res = await publishProfileFromEditor({ base_updated_at: BASE, profile: { slug: 'ab' } });
    expect(res).toEqual({
      ok: false,
      error: 'We couldn’t save your changes. Your edits are still here.',
      fieldErrors: { 'profile.lyra_id': 'Your CheckLyra ID needs at least 3 characters.' },
    });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockPublishProfile).not.toHaveBeenCalled();
  });

  test('a client snapshot missing items stops the publish before any write', async () => {
    const incomplete = { photo: { kind: 'none' }, fields: { display_name: '' }, lyraId: '' } as unknown as EditorState;
    const res = await publishProfileFromEditor({ base_updated_at: BASE }, incomplete);
    expect(res.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockPublishProfile).not.toHaveBeenCalled();
  });

  test('publishProfile failing (e.g. age gate) still returns the saved ids so the client can rebase', async () => {
    mockState.profileRows = [draftRow(), readyRow()];
    mockRpc.mockResolvedValue(rpcOk({ ids: { 'new:g': 'uuid-g' } }));
    mockPublishProfile.mockResolvedValue({ success: false, error: 'Age check needed' });
    const res = await publishProfileFromEditor({ base_updated_at: BASE, profile: { headline: 'Hello' } });
    expect(res).toEqual({
      ok: false,
      error: 'Age check needed',
      saved: { ok: true, idMap: { 'new:g': 'uuid-g' }, updatedAt: SAVED_AT, warnings: {}, ...DRAFT_IDENTITY },
    });
  });
});

// ── Save Changes ────────────────────────────────────────────────────────

describe('KAN-487 editor actions: Save Changes', () => {
  test('calls save_profile in "published" mode and revalidates the public page', async () => {
    mockState.profileRows = [readyRow({ is_published: true })];
    const res = await saveProfileChanges({ base_updated_at: BASE, profile: { headline: 'Hello' } });
    expect(res.ok).toBe(true);
    expect(rpcMode()).toBe('published');
    expect(mockRevalidatePath).toHaveBeenCalledWith('/ada_l');
    expect(mockPublishProfile).not.toHaveBeenCalled();
  });

  test('a CheckLyra ID change after publishing is refused before the RPC', async () => {
    mockState.profileRows = [readyRow({ is_published: true })];
    const res = await saveProfileChanges({ base_updated_at: BASE, profile: { slug: 'new_id' } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.fieldErrors).toEqual({ 'profile.lyra_id': 'Your CheckLyra ID can’t be changed after publishing.' });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// ── stageProfilePhoto action ────────────────────────────────────────────

describe('KAN-487 editor actions: stageProfilePhoto', () => {
  test('not authenticated → refused, nothing uploaded', async () => {
    mockState.userId = null;
    const fd = new FormData();
    await expect(stageProfilePhoto(fd)).resolves.toEqual({ ok: false, error: 'Not authenticated' });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('no file → "No file provided", nothing uploaded', async () => {
    await expect(stageProfilePhoto(new FormData())).resolves.toEqual({ ok: false, error: 'No file provided' });
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

// ── KAN-487 review fixes ────────────────────────────────────────────────

describe('KAN-487 review M1: the RPC receives the CLEANED payload, never raw client text', () => {
  test('HTML is stripped from a title, whitespace collapsed, empty text becomes null', async () => {
    const res = await saveProfileDraft({
      base_updated_at: BASE,
      items: {
        upsert: [
          {
            client_key: 'new:i1',
            category: 'gift_ideas',
            title: '<img src=x onerror=alert(1)>Nice   kite',
            description: '   ',
            url: null,
            group_label: null,
          },
        ],
        delete: [],
      },
    });
    expect(res.ok).toBe(true);
    expect(rpcPayload().items).toEqual({
      upsert: [
        { client_key: 'new:i1', category: 'gift_ideas', title: 'Nice kite', description: null, url: null, group_label: null },
      ],
      delete: [],
    });
  });

  test('a long group_label that only fits once stripped is stored stripped (60-character limit)', async () => {
    const label = `<b>${'L'.repeat(58)}</b>`;
    expect(label.length).toBeGreaterThan(60);
    const res = await saveProfileDraft({
      base_updated_at: BASE,
      items: {
        upsert: [
          { client_key: 'new:i2', category: 'favourite_custom', title: 'Thing', description: null, url: null, group_label: label },
        ],
        delete: [],
      },
    });
    expect(res.ok).toBe(true);
    expect(rpcPayload().items?.upsert[0].group_label).toBe('L'.repeat(58));
  });

  test('profile, manual_of_me, affiliation and question text is sent cleaned', async () => {
    const res = await saveProfileDraft({
      base_updated_at: BASE,
      profile: { display_name: '  Ada   <i>Lovelace</i> ', headline: '<b>  </b>' },
      manual_of_me: {
        good_to_know: '<b>Slow</b>  texter',
        boundaries: '',
        communication_style: null,
        working_preferences: null,
        energises_me: null,
        drains_me: null,
      },
      affiliations: {
        upsert: [
          {
            client_key: 'new:a1',
            affiliation_type: 'organisation',
            school_name: '<u>Acme</u>  Ltd',
            school_location: ' ',
            description: null,
            show_on_profile: true,
          },
        ],
        delete: [],
      },
      questions: {
        upsert: [{ client_key: 'new:q1', custom_prompt: '<em>Why</em>  not?', answer: 'Because <b>yes</b>' }],
        delete: [],
      },
    });
    expect(res.ok).toBe(true);
    const sent = rpcPayload();
    expect(sent.profile).toEqual({ display_name: 'Ada Lovelace', headline: null });
    expect(sent.manual_of_me).toEqual({
      good_to_know: 'Slow texter',
      boundaries: null,
      communication_style: null,
      working_preferences: null,
      energises_me: null,
      drains_me: null,
    });
    expect(sent.affiliations?.upsert).toEqual([
      {
        client_key: 'new:a1',
        affiliation_type: 'organisation',
        school_name: 'Acme Ltd',
        school_location: null,
        description: null,
        show_on_profile: true,
      },
    ]);
    expect(sent.questions?.upsert).toEqual([{ client_key: 'new:q1', custom_prompt: 'Why not?', answer: 'Because yes' }]);
  });

  test('a link is sent as the parsed URL', async () => {
    const res = await saveProfileDraft({
      base_updated_at: BASE,
      items: {
        upsert: [
          { client_key: 'new:i3', category: 'gift_ideas', title: 'Tea', description: null, url: '  https://tea.example/x  ', group_label: null },
        ],
        delete: [],
      },
    });
    expect(res.ok).toBe(true);
    expect(rpcPayload().items?.upsert[0].url).toBe('https://tea.example/x');
  });
});

describe('KAN-487 review M2: publish returns the row as it is AFTER publishProfile()', () => {
  test('updatedAt, firstPublishedAt, isPublished, slug and avatar come from a re-read after publishing', async () => {
    mockState.profileRows = [
      draftRow(),
      readyRow({ updated_at: SAVED_AT }),
      readyRow({ is_published: true, updated_at: PUBLISHED_AT, first_published_at: PUBLISHED_AT }),
    ];
    mockRpc.mockResolvedValue(rpcOk({ ids: { 'new:g': 'uuid-g' } }));
    const res = await publishProfileFromEditor({ base_updated_at: BASE, profile: { headline: 'Hello' } });
    expect(res).toEqual({
      ok: true,
      idMap: { 'new:g': 'uuid-g' },
      updatedAt: '2026-11-23T10:05:01.250Z',
      warnings: {},
      slug: 'ada_l',
      slugConfirmed: true,
      avatarUrl: 'https://cdn.example.test/profile-photos/x/avatar-1.jpg?v=1',
      isPublished: true,
      firstPublishedAt: '2026-11-23T10:05:01.250Z',
    });
    expect(mockState.profileReads).toBe(3);
    expect(mockPublishProfile.mock.invocationCallOrder[0]).toBeGreaterThan(0);
  });

  test('if the row cannot be re-read after publishing, the client is told to reload (never a stale updatedAt)', async () => {
    mockState.profileRows = [draftRow(), readyRow(), null];
    const res = await publishProfileFromEditor({ base_updated_at: BASE, profile: { headline: 'Hello' } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('Editor is out of date. Reload to continue.');
    expect(mockPublishProfile).toHaveBeenCalledTimes(1);
  });
});

describe('KAN-487 review M3: a published profile cannot be saved without a display name', () => {
  test('Save Changes with a blank display_name → "Add a display name", no RPC', async () => {
    mockState.profileRows = [readyRow({ is_published: true })];
    const res = await saveProfileChanges({ base_updated_at: BASE, profile: { display_name: '   ' } });
    expect(res).toEqual({
      ok: false,
      error: 'We couldn’t save your changes. Your edits are still here.',
      fieldErrors: { 'profile.display_name': 'Add a display name' },
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('the SQL guard’s error maps to the display-name field with the same copy', async () => {
    mockState.profileRows = [readyRow({ is_published: true })];
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Add a display name', code: 'P0001', details: '{"section": "profile", "client_key": null}' },
    });
    const res = await saveProfileChanges({ base_updated_at: BASE, profile: { headline: 'Hi' } });
    expect(res).toEqual({
      ok: false,
      error: 'Add a display name',
      fieldErrors: { 'profile.display_name': 'Add a display name' },
    });
  });
});

describe('KAN-487 review M4: the save result carries the STORED identity', () => {
  test('a taken ID in a draft: the result names the stored slug, not the refused one', async () => {
    mockRpc.mockResolvedValue(rpcOk({ warnings: { lyra_id: 'taken' }, slug: 'alice1', slug_confirmed: true }));
    const res = await saveProfileDraft({ base_updated_at: BASE, profile: { slug: 'bob' } });
    expect(res).toEqual({
      ok: true,
      idMap: {},
      updatedAt: SAVED_AT,
      warnings: { lyra_id: 'taken' },
      slug: 'alice1',
      slugConfirmed: true,
      avatarUrl: null,
      isPublished: false,
      firstPublishedAt: null,
    });
  });

  test('an RPC result without the stored identity is treated as an unexpected shape', async () => {
    mockRpc.mockResolvedValue({ data: { updated_at: SAVED_AT, ids: {}, warnings: {} }, error: null });
    const res = await saveProfileDraft({ base_updated_at: BASE, profile: { headline: 'Hi' } });
    expect(res.ok).toBe(false);
  });
});

describe('KAN-487 review minor 5: photo trigger errors point at the photo field', () => {
  test('section "photo" → field key "photo"', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message: 'A published profile needs a profile photo',
        code: 'P0001',
        details: '{"section": "photo", "client_key": null}',
      },
    });
    const name = 'avatar-55555555-5555-4555-8555-555555555555.jpg';
    mockList.mockResolvedValue({ data: [{ name }], error: null });
    const res = await saveProfileDraft({ base_updated_at: BASE, photo: { action: 'set', staged_path: `${uid}/${name}` } });
    expect(res).toEqual({
      ok: false,
      error: 'A published profile needs a photo. Add a new photo before removing this one.',
      fieldErrors: { photo: 'A published profile needs a photo. Add a new photo before removing this one.' },
    });
  });
});

describe('KAN-487 review minor 6: malformed payloads get a clean error, never a throw or a DB error', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const malformed: Array<[string, unknown]> = [
    ['items.upsert as an object', { base_updated_at: BASE, items: { upsert: { a: 1 }, delete: [] } }],
    ['items.delete missing', { base_updated_at: BASE, items: { upsert: [] } }],
    ['a non-UUID item id', { base_updated_at: BASE, items: { upsert: [{ id: 'abc', client_key: 'k', category: 'gift_ideas', title: 'T', description: null, url: null, group_label: null }], delete: [] } }],
    ['a non-UUID delete id', { base_updated_at: BASE, affiliations: { upsert: [], delete: ['nope'] } }],
    ['a numeric title', { base_updated_at: BASE, items: { upsert: [{ client_key: 'k', category: 'gift_ideas', title: 7, description: null, url: null, group_label: null }], delete: [] } }],
    ['a missing client_key', { base_updated_at: BASE, items: { upsert: [{ category: 'gift_ideas', title: 'T', description: null, url: null, group_label: null }], delete: [] } }],
    ['ai_gifts.approve with a non-UUID', { base_updated_at: BASE, ai_gifts: { approve: ['x'], delete: [] } }],
    ['a non-UUID prompt_id', { base_updated_at: BASE, questions: { upsert: [{ client_key: 'k', prompt_id: 'preset-1', answer: 'A' }], delete: [] } }],
    ['a numeric answer', { base_updated_at: BASE, questions: { upsert: [{ id: ID, client_key: 'k', answer: 5 }], delete: [] } }],
    ['show_on_profile as a string', { base_updated_at: BASE, affiliations: { upsert: [{ client_key: 'k', affiliation_type: 'school', school_name: 'S', school_location: 'SW1A 1AA', description: null, show_on_profile: 'yes' }], delete: [] } }],
    ['profile as an array', { base_updated_at: BASE, profile: ['Ada'] }],
    ['a numeric display_name', { base_updated_at: BASE, profile: { display_name: 5 } }],
    ['an unknown profile key', { base_updated_at: BASE, profile: { is_published: true } }],
    ['photo with an unknown action', { base_updated_at: BASE, photo: { action: 'steal' } }],
    ['manual_of_me with a number', { base_updated_at: BASE, manual_of_me: { good_to_know: 1 } }],
    ['base_updated_at as a number', { base_updated_at: 5 }],
  ];

  test('the malformed corpus is non-empty', () => {
    expect(malformed.length).toBeGreaterThan(0);
  });

  test.each(malformed)('%s → "This entry can’t be saved here. Reload to continue.", no RPC', async (_label, payload) => {
    await expect(saveProfileDraft(payload as SavePayload)).resolves.toEqual({
      ok: false,
      error: 'This entry can’t be saved here. Reload to continue.',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
