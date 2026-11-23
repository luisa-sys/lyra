/**
 * KAN-487 — staged profile photos (spec v0.8 §01 "Strip EXIF/location
 * metadata; verify actual file type on server", §1 "edits remain private
 * until … Save Changes"; plan §B "Photo").
 *
 * Drives the real `photo-staging.ts` (and, through it, the real sharp-based
 * `processProfilePhoto`) against a fake storage bucket. Images are generated
 * with sharp so EXIF stripping is observed on real bytes.
 */

import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  cleanupOldPhotos,
  isOwnStagedPhotoPath,
  resolveStagedPhoto,
  stageProfilePhoto,
  stagedPhotoPath,
} from '@/modules/profile/photo-staging';

const UID = '0b0e6c1e-6f4b-4c39-9a51-0d2f0b6f3e11';
const UUID_JPG = /^avatar-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

interface FakeBucket {
  client: SupabaseClient;
  upload: jest.Mock;
  list: jest.Mock;
  remove: jest.Mock;
  buckets: string[];
}

function fakeStorage(): FakeBucket {
  const upload = jest.fn().mockResolvedValue({ data: {}, error: null });
  const list = jest.fn().mockResolvedValue({ data: [], error: null });
  const remove = jest.fn().mockResolvedValue({ data: [], error: null });
  const buckets: string[] = [];
  const client = {
    storage: {
      from: (bucket: string) => {
        buckets.push(bucket);
        return {
          upload,
          list,
          remove,
          getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn.example.test/${bucket}/${p}` } }),
        };
      },
    },
  } as unknown as SupabaseClient;
  return { client, upload, list, remove, buckets };
}

async function jpegWithExif(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .withMetadata({ exif: { IFD0: { Copyright: 'KAN487-SECRET', Artist: 'Location Leak' } } })
    .jpeg()
    .toBuffer();
}

function fileOf(buf: Buffer, type = 'image/jpeg', name = 'photo.jpg'): File {
  return new File([new Uint8Array(buf)], name, { type });
}

// ── path rules ──────────────────────────────────────────────────────────

describe('KAN-487 photo staging: path rules', () => {
  test('a staged path is <uid>/avatar-<uuid>.jpg and unique per call', () => {
    const a = stagedPhotoPath(UID);
    const b = stagedPhotoPath(UID);
    expect(a.startsWith(`${UID}/`)).toBe(true);
    expect(a.slice(UID.length + 1)).toMatch(UUID_JPG);
    expect(a).not.toBe(b);
  });

  const accepted = [`${UID}/avatar-11111111-1111-4111-8111-111111111111.jpg`];
  const rejected: Array<[string, unknown]> = [
    // KAN-487 review minor 2: only the exact name stageProfilePhoto makes.
    ['a name that is not a uuid', `${UID}/avatar-x.jpg`],
    ['an SVG uploaded straight to storage', `${UID}/avatar-11111111-1111-4111-8111-111111111111.svg`],
    ['a .jpeg extension', `${UID}/avatar-11111111-1111-4111-8111-111111111111.jpeg`],
    ['an upper-case uuid', `${UID}/avatar-AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.jpg`],
    ['a non-v4 uuid', `${UID}/avatar-11111111-1111-1111-8111-111111111111.jpg`],
    ['a bad uuid variant', `${UID}/avatar-11111111-1111-4111-c111-111111111111.jpg`],
    ['a uuid without dashes', `${UID}/avatar-11111111111141118111111111111111.jpg`],
    ['a suffix after the uuid', `${UID}/avatar-11111111-1111-4111-8111-111111111111-x.jpg`],
    ['another user', 'f00dbabe-0000-4000-8000-000000000000/avatar-1.jpg'],
    ['the legacy fixed path', `${UID}/avatar.jpg`],
    ['a parent-directory hop', `${UID}/avatar-../../other/avatar-1.jpg`],
    ['a ".." anywhere', `${UID}/avatar-a..jpg`],
    ['a nested folder', `${UID}/avatar-x/evil.jpg`],
    ['a backslash', `${UID}/avatar-x\\evil.jpg`],
    ['a query string', `${UID}/avatar-x.jpg?v=1`],
    ['a uid-prefix lookalike', `${UID}0/avatar-1.jpg`],
    ['an empty suffix', `${UID}/avatar-`],
    ['a full URL', `https://cdn.example.test/profile-photos/${UID}/avatar-1.jpg`],
    ['not a string', 42],
  ];

  test.each(accepted)('accepts %s', (p) => {
    expect(isOwnStagedPhotoPath(UID, p)).toBe(true);
  });

  test('the rejection corpus is non-empty', () => {
    expect(rejected.length).toBeGreaterThan(0);
  });

  test.each(rejected)('rejects %s', (_label, p) => {
    expect(isOwnStagedPhotoPath(UID, p)).toBe(false);
  });
});

// ── stageProfilePhoto ───────────────────────────────────────────────────

describe('KAN-487 photo staging: stageProfilePhoto', () => {
  test('uploads a processed JPEG to a unique staged path without upsert, EXIF stripped', async () => {
    const src = await jpegWithExif(800, 600);
    expect((await sharp(src).metadata()).exif).toBeDefined(); // the input really carries EXIF

    const s = fakeStorage();
    const res = await stageProfilePhoto(s.client, UID, fileOf(src), null);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(s.buckets.every((b) => b === 'profile-photos')).toBe(true);
    expect(s.upload).toHaveBeenCalledTimes(1);
    const [path, body, opts] = s.upload.mock.calls[0] as [string, Buffer, { upsert: boolean; contentType: string }];
    expect(path).toBe(res.path);
    expect(path.startsWith(`${UID}/`)).toBe(true);
    expect(path.slice(UID.length + 1)).toMatch(UUID_JPG);
    expect(opts).toEqual({ upsert: false, contentType: 'image/jpeg' });
    expect(res.previewUrl).toBe(`https://cdn.example.test/profile-photos/${path}`);

    const out = await sharp(body).metadata();
    expect(out.format).toBe('jpeg');
    expect(out.exif).toBeUndefined();
    expect(body.includes(Buffer.from('KAN487-SECRET'))).toBe(false);
    expect([out.width, out.height]).toEqual([600, 600]); // square
  });

  test('two uploads never share a path', async () => {
    const src = await jpegWithExif(500, 500);
    const s = fakeStorage();
    const a = await stageProfilePhoto(s.client, UID, fileOf(src), null);
    const b = await stageProfilePhoto(s.client, UID, fileOf(src), null);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.path).not.toBe(b.path);
  });

  test('a file that is not really an image is refused and nothing is uploaded', async () => {
    const s = fakeStorage();
    const res = await stageProfilePhoto(s.client, UID, fileOf(Buffer.from('not an image at all'), 'image/jpeg'), null);
    // Magic-byte check (SEC-52 preflightUpload, shared with uploadAvatar).
    expect(res).toEqual({
      ok: false,
      error: "File contents don't match declared type image/jpeg. The file may be corrupt or its extension may be wrong.",
    });
    expect(s.upload).not.toHaveBeenCalled();
  });

  test('a GIF (dropped in v0.8) is refused by type and nothing is uploaded', async () => {
    const s = fakeStorage();
    const gif = await sharp({ create: { width: 500, height: 500, channels: 3, background: '#000' } }).gif().toBuffer();
    const res = await stageProfilePhoto(s.client, UID, fileOf(gif, 'image/gif', 'a.gif'), null);
    expect(res).toEqual({ ok: false, error: 'Photos must be JPG, PNG or WebP.' });
    expect(s.upload).not.toHaveBeenCalled();
  });

  test('an image under 400 × 400 is refused and nothing is uploaded', async () => {
    const s = fakeStorage();
    const res = await stageProfilePhoto(s.client, UID, fileOf(await jpegWithExif(300, 300)), null);
    expect(res).toEqual({ ok: false, error: 'Photos must be at least 400 × 400 pixels.' });
    expect(s.upload).not.toHaveBeenCalled();
  });

  test('no file → "No file provided"', async () => {
    const s = fakeStorage();
    await expect(stageProfilePhoto(s.client, UID, null, null)).resolves.toEqual({ ok: false, error: 'No file provided' });
    expect(s.upload).not.toHaveBeenCalled();
  });
});

// ── resolveStagedPhoto ──────────────────────────────────────────────────

describe('KAN-487 photo staging: resolveStagedPhoto', () => {
  const name = 'avatar-33333333-3333-4333-8333-333333333333.jpg';

  test('another user’s path is refused without touching storage', async () => {
    const s = fakeStorage();
    const res = await resolveStagedPhoto(s.client, UID, `f00dbabe-0000-4000-8000-000000000000/${name}`);
    expect(res).toEqual({ ok: false, error: 'That photo is no longer available. Please upload it again.' });
    expect(s.list).not.toHaveBeenCalled();
  });

  test('a path with ".." is refused', async () => {
    const s = fakeStorage();
    const res = await resolveStagedPhoto(s.client, UID, `${UID}/avatar-../${name}`);
    expect(res.ok).toBe(false);
    expect(s.list).not.toHaveBeenCalled();
  });

  test('an own path that no longer exists is refused', async () => {
    const s = fakeStorage();
    s.list.mockResolvedValue({ data: [{ name: 'avatar.jpg' }], error: null });
    const res = await resolveStagedPhoto(s.client, UID, `${UID}/${name}`);
    expect(res.ok).toBe(false);
  });

  test('an own existing path → its public URL with a ?v= version', async () => {
    const s = fakeStorage();
    s.list.mockResolvedValue({ data: [{ name }], error: null });
    const res = await resolveStagedPhoto(s.client, UID, `${UID}/${name}`);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.avatarUrl).toMatch(
      new RegExp(`^https://cdn\\.example\\.test/profile-photos/${UID}/avatar-3{8}-3{4}-4333-8333-3{12}\\.jpg\\?v=\\d+$`),
    );
    expect(s.list).toHaveBeenCalledWith(UID, expect.objectContaining({ search: name }));
  });
});

// ── cleanupOldPhotos ────────────────────────────────────────────────────

describe('KAN-487 photo staging: cleanupOldPhotos', () => {
  test('removes the other avatar* files, keeps the current one and non-avatar files', async () => {
    const s = fakeStorage();
    s.list.mockResolvedValue({
      data: [{ name: 'avatar.jpg' }, { name: 'avatar-keep.jpg' }, { name: 'avatar-old.jpg' }, { name: 'notes.pdf' }],
      error: null,
    });
    await cleanupOldPhotos(s.client, UID, `${UID}/avatar-keep.jpg`);
    expect(s.remove).toHaveBeenCalledWith([`${UID}/avatar.jpg`, `${UID}/avatar-old.jpg`]);
  });

  test('keepPath null removes every avatar file', async () => {
    const s = fakeStorage();
    s.list.mockResolvedValue({ data: [{ name: 'avatar.jpg' }, { name: 'avatar-1.jpg' }], error: null });
    await cleanupOldPhotos(s.client, UID, null);
    expect(s.remove).toHaveBeenCalledWith([`${UID}/avatar.jpg`, `${UID}/avatar-1.jpg`]);
  });

  test('nothing to remove → no remove call', async () => {
    const s = fakeStorage();
    s.list.mockResolvedValue({ data: [{ name: 'avatar-keep.jpg' }], error: null });
    await cleanupOldPhotos(s.client, UID, `${UID}/avatar-keep.jpg`);
    expect(s.remove).not.toHaveBeenCalled();
  });

  test('never throws: list rejecting', async () => {
    const s = fakeStorage();
    s.list.mockRejectedValue(new Error('storage down'));
    await expect(cleanupOldPhotos(s.client, UID, null)).resolves.toBeUndefined();
  });

  test('never throws: list returning an error', async () => {
    const s = fakeStorage();
    s.list.mockResolvedValue({ data: null, error: { message: 'nope' } });
    await expect(cleanupOldPhotos(s.client, UID, null)).resolves.toBeUndefined();
    expect(s.remove).not.toHaveBeenCalled();
  });

  test('never throws: remove rejecting', async () => {
    const s = fakeStorage();
    s.list.mockResolvedValue({ data: [{ name: 'avatar.jpg' }], error: null });
    s.remove.mockRejectedValue(new Error('storage down'));
    await expect(cleanupOldPhotos(s.client, UID, null)).resolves.toBeUndefined();
  });
});
