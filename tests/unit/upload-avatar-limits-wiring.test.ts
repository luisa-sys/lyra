/**
 * KAN-414 F4 (KAN-417 §8 group 3) — behavioural replacement for the MIME/size
 * scans in tests/unit/photo-upload.test.js.
 *
 * WHAT THIS IS *NOT* DUPLICATING
 * ------------------------------
 * `tests/unit/sec52-upload-preflight.test.ts` already tests `preflightUpload`
 * itself, and tests it well: a genuine PNG accepted, EXE bytes declared as
 * `image/png` rejected, oversize rejected, empty rejected. None of that is
 * repeated here.
 *
 * The gap is one level up. SEC-52 calls the helper with **its own** options, so
 * it proves the helper honours whatever allow-list it is handed — not that
 * `uploadAvatar` hands it the right one. Widen the caller's list:
 *
 *     const preflightError = await preflightUpload(file, {
 *   -   allowedMimes: ALLOWED_IMAGE_TYPES,
 *   +   allowedMimes: [...ALLOWED_IMAGE_TYPES, 'application/pdf'],
 *
 * and **both existing guards stay green**: SEC-52 because it never calls
 * `uploadAvatar`, and `photo-upload.test.js` because `ALLOWED_IMAGE_TYPES`,
 * `image/jpeg`, `MAX_FILE_SIZE` and `5 * 1024 * 1024` are all still in the file.
 * The scan asserts the constants EXIST; it cannot assert they are USED.
 *
 * That matters because `profile-photos` is a world-readable bucket, and the
 * declared MIME is browser-controlled.
 *
 * THE INVARIANTS, IN WORDS
 * ------------------------
 *  1. A disallowed type is refused, and nothing is written to storage. The
 *     absent upload is the property; the error string is the symptom.
 *  2. A file over 5MB is refused.
 *  3. A SPOOFED type — a real PNG declared as `image/jpeg` — is refused, which
 *     is what magic-byte checking buys and what no text scan can observe.
 *  4. A genuine allowed image reaches the `profile-photos` bucket, upserted so
 *     a re-upload overwrites rather than accumulating.
 *
 * MUTATION PROOF (2026-08-02, each reverted)
 *   * add 'application/pdf' to the caller's allowedMimes  -> case 1 reddens
 *   * raise the caller's maxBytes to 50MB                 -> case 2 reddens
 *   * pass a hardcoded allow-list instead of the constant -> cases 1 and 3 redden
 * Under every one, photo-upload.test.js stays 6/6 green.
 */
import sharp from 'sharp';
import { uploadAvatar } from '@/app/dashboard/profile/actions';
import { getMyFeatureEntitlements } from '@/modules/features/entitlements';

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

jest.mock('@/modules/guards/profile-rate-limit', () => ({
  checkProfileWriteRateLimit: jest.fn(async () => ({ allowed: true })),
}));

// Params are declared so `upload.mock.calls[0][n]` is typed — an untyped
// jest.fn() infers a zero-length tuple and the assertions below won't compile.
const upload = jest.fn(
  async (_path: string, _body: unknown, _opts?: { upsert?: boolean }) => ({
    data: { path: 'p' },
    error: null,
  }),
);
const getPublicUrl = jest.fn(() => ({ data: { publicUrl: 'https://cdn/x.png' } }));
const storageFrom = jest.fn(() => ({ upload, getPublicUrl }));
const profileUpdate = jest.fn(() => ({ eq: jest.fn(async () => ({ error: null })) }));

jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'user-1' } } })) },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(async () => ({ data: { id: 'profile-1' } })),
        })),
      })),
      update: profileUpdate,
    })),
    storage: { from: storageFrom },
  })),
}));

jest.mock('@/modules/features/entitlements', () => ({
  getMyFeatureEntitlements: jest.fn(),
}));

const GRANTED = {
  media_uploads: true,
  discovery: true,
  mcp: false,
  convene: false,
  paid_gift_links: false,
  convene_paid_channels: false,
} as const;

// Real signatures — the point of case 3 is that the BYTES decide, not the
// declared type, so these have to be genuine.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

// KAN-486 — v0.8 §01 needs a DECODABLE image of at least 400 × 400, so the
// acceptance cases use a genuine 500 × 500 PNG (the 8-byte header above is
// still enough for the refusal cases, which never reach decoding).
let REAL_PNG: Uint8Array;
let SMALL_PNG: Uint8Array;
beforeAll(async () => {
  const make = (side: number) =>
    sharp({ create: { width: side, height: side, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png()
      .toBuffer();
  REAL_PNG = new Uint8Array(await make(500));
  SMALL_PNG = new Uint8Array(await make(300));
});

function fileOf(bytes: Uint8Array, type: string, padTo = 0): File {
  // Build on a concrete ArrayBuffer: a plain Uint8Array is typed over
  // ArrayBufferLike, which is not assignable to BlobPart under TS 5.7+.
  const size = Math.max(padTo, bytes.length);
  const buf = new ArrayBuffer(size);
  new Uint8Array(buf).set(bytes);
  return new File([buf], 'avatar', { type });
}

function form(file: File): FormData {
  const fd = new FormData();
  fd.append('avatar', file);
  return fd;
}

beforeEach(() => {
  jest.clearAllMocks();
  (getMyFeatureEntitlements as jest.Mock).mockResolvedValue(GRANTED);
});

describe('uploadAvatar — the limits are WIRED, not merely declared', () => {
  it('refuses a disallowed type and writes nothing to storage', async () => {
    const res = await uploadAvatar(form(fileOf(PDF, 'application/pdf')));

    expect(res.success).toBe(false);
    // The property: `profile-photos` is world-readable, so a refusal must mean
    // the object never lands, not merely that an error string came back.
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses a file over the 5MB cap', async () => {
    const tooBig = fileOf(PNG, 'image/png', 5 * 1024 * 1024 + 1);

    const res = await uploadAvatar(form(tooBig));

    expect(res.success).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses a SPOOFED type — real PNG bytes declared as image/jpeg', async () => {
    // Both types are on the allow-list, so only the magic-byte check can
    // catch this. A text scan asserting the allow-list contains 'image/jpeg'
    // is satisfied either way.
    const res = await uploadAvatar(form(fileOf(PNG, 'image/jpeg')));

    expect(res.success).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it('accepts a genuine PNG and upserts it into profile-photos', async () => {
    const res = await uploadAvatar(form(fileOf(REAL_PNG, 'image/png')));

    expect(res.success).toBe(true);
    expect(storageFrom).toHaveBeenCalledWith('profile-photos');
    expect(upload).toHaveBeenCalledTimes(1);
    // upsert, so re-uploading replaces rather than accumulating orphans.
    expect(upload.mock.calls[0][2]).toEqual(
      expect.objectContaining({ upsert: true }),
    );
  });

  it('stores the avatar under the caller’s own user id', async () => {
    await uploadAvatar(form(fileOf(REAL_PNG, 'image/png')));

    // Path scoping is what the storage RLS policy keys on
    // (storage.foldername(name)[1] = auth.uid()), so a wrong prefix would let
    // one member overwrite another's avatar.
    expect(String(upload.mock.calls[0][0])).toMatch(/^user-1\//);
  });
});

describe('uploadAvatar — KAN-486 photo pipeline is wired (spec v0.8 §01)', () => {
  it('uploads a re-encoded JPEG, not the bytes it was given', async () => {
    const res = await uploadAvatar(form(fileOf(REAL_PNG, 'image/png')));

    expect(res.success).toBe(true);
    const [path, body, opts] = upload.mock.calls[0];
    expect(path).toBe('user-1/avatar.jpg');
    expect(opts).toEqual(expect.objectContaining({ upsert: true, contentType: 'image/jpeg' }));
    const meta = await sharp(body as Buffer).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([500, 500]);
    expect(Buffer.compare(body as Buffer, Buffer.from(REAL_PNG))).not.toBe(0);
  });

  it('refuses a real image under 400 × 400 and writes nothing', async () => {
    const res = await uploadAvatar(form(fileOf(SMALL_PNG, 'image/png')));

    expect(res).toEqual({ success: false, error: 'Photos must be at least 400 × 400 pixels.' });
    expect(upload).not.toHaveBeenCalled();
    expect(profileUpdate).not.toHaveBeenCalled();
  });

  it('refuses a GIF (no longer an accepted type)', async () => {
    const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    const res = await uploadAvatar(form(fileOf(GIF, 'image/gif')));

    expect(res.success).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it('still uploads when media_uploads is revoked (a photo is required to publish)', async () => {
    (getMyFeatureEntitlements as jest.Mock).mockResolvedValue({ ...GRANTED, media_uploads: false });
    const res = await uploadAvatar(form(fileOf(REAL_PNG, 'image/png')));

    expect(res.success).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('sets avatar_url with a cache-busting version', async () => {
    await uploadAvatar(form(fileOf(REAL_PNG, 'image/png')));

    const written = (profileUpdate.mock.calls[0] as unknown[])[0] as { avatar_url: string };
    expect(written.avatar_url).toMatch(/^https:\/\/cdn\/x\.png\?v=\d+$/);
  });
});
