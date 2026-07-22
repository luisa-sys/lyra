/**
 * SEC-52: shared upload preflight — magic-byte enforcement on the avatar path.
 *
 * The avatar uploader (`uploadAvatar`) historically validated only the
 * browser-declared MIME + size and skipped `validateFileMagicBytes`, which the
 * sibling profile-files path enforced. A spoofed-MIME / polyglot file
 * (e.g. an EXE served with `Content-Type: image/png`) therefore landed in the
 * world-readable `profile-photos` bucket. `finding web-input-01`.
 *
 * These tests lock two things:
 *   1. `preflightUpload` behaviour — the shared helper both paths now use:
 *      presence, size cap, MIME allow-list, and (critically) the magic-byte
 *      signature check.
 *   2. Source guards — that BOTH `uploadAvatar` and `uploadProfileFile` route
 *      through `preflightUpload` BEFORE the storage `.upload(` call, so the two
 *      paths can't drift apart again.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { preflightUpload } from '@/lib/file-magic-bytes';

const ROOT = resolve(__dirname, '../..');

/** Build a File with a known byte prefix and declared MIME. */
function fileWith(prefix: number[], type: string, totalLen = 32): File {
  const bytes = new Uint8Array(totalLen);
  bytes.set(prefix);
  return new File([bytes], 'upload.bin', { type });
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIG = [0xff, 0xd8, 0xff, 0xe0];
const EXE_SIG = [0x4d, 0x5a]; // "MZ" — PE/COFF header, not an image

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

describe('SEC-52 preflightUpload', () => {
  const opts = {
    allowedMimes: IMAGE_MIMES,
    maxBytes: 5 * 1024 * 1024,
    emptyMessage: 'No file provided',
    typeMessage: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF',
    sizeMessage: 'File too large. Maximum size is 5MB',
  };

  test('accepts a genuine PNG (bytes match declared MIME)', async () => {
    const err = await preflightUpload(fileWith(PNG_SIG, 'image/png'), opts);
    expect(err).toBeNull();
  });

  test('accepts a genuine JPEG', async () => {
    const err = await preflightUpload(fileWith(JPEG_SIG, 'image/jpeg'), opts);
    expect(err).toBeNull();
  });

  test('REJECTS a spoofed MIME — EXE bytes declared as image/png', async () => {
    // This is the core SEC-52 vulnerability: declared MIME passes the
    // allow-list, but the actual bytes are not a PNG.
    const err = await preflightUpload(fileWith(EXE_SIG, 'image/png'), opts);
    expect(err).not.toBeNull();
    expect(err).toMatch(/don['']t match/i);
  });

  test('REJECTS a spoofed MIME — PNG bytes declared as image/jpeg', async () => {
    const err = await preflightUpload(fileWith(PNG_SIG, 'image/jpeg'), opts);
    expect(err).not.toBeNull();
    expect(err).toMatch(/don['']t match/i);
  });

  test('rejects a disallowed declared type before the byte check', async () => {
    // PDF has valid magic bytes but is not in the avatar allow-list.
    const err = await preflightUpload(
      fileWith([0x25, 0x50, 0x44, 0x46, 0x2d], 'application/pdf'),
      opts,
    );
    expect(err).toBe(opts.typeMessage);
  });

  test('rejects an oversize file', async () => {
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', {
      type: 'image/png',
    });
    const err = await preflightUpload(big, opts);
    expect(err).toBe(opts.sizeMessage);
  });

  test('rejects a null / missing file', async () => {
    expect(await preflightUpload(null, opts)).toBe(opts.emptyMessage);
  });

  test('rejects an empty (zero-byte) file', async () => {
    const empty = new File([], 'empty.png', { type: 'image/png' });
    expect(await preflightUpload(empty, opts)).toBe(opts.emptyMessage);
  });

  test('honours a distinct allow-list + messages per caller (files path)', async () => {
    // The profile-files path allows PDFs and uses its own wording.
    const fileOpts = {
      allowedMimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'],
      maxBytes: 10 * 1024 * 1024,
      emptyMessage: 'File is empty',
    };
    const ok = await preflightUpload(
      fileWith([0x25, 0x50, 0x44, 0x46, 0x2d], 'application/pdf'),
      fileOpts,
    );
    expect(ok).toBeNull();
    const empty = new File([], 'x.pdf', { type: 'application/pdf' });
    expect(await preflightUpload(empty, fileOpts)).toBe('File is empty');
  });
});

describe('SEC-52 source guards — both upload paths enforce the shared preflight', () => {
  test('uploadAvatar runs preflightUpload before the profile-photos upload', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/actions.ts'),
      'utf-8',
    );
    const fn = src.slice(src.indexOf('export async function uploadAvatar'));
    const preflightIdx = fn.indexOf('preflightUpload(');
    const uploadIdx = fn.indexOf("from('profile-photos')");
    expect(preflightIdx).toBeGreaterThan(-1);
    expect(uploadIdx).toBeGreaterThan(-1);
    // The magic-byte-bearing preflight must run BEFORE the storage upload.
    expect(preflightIdx).toBeLessThan(uploadIdx);
  });

  test('uploadProfileFile runs preflightUpload before the profile-files upload', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/app/dashboard/profile/files-actions.ts'),
      'utf-8',
    );
    const fn = src.slice(src.indexOf('export async function uploadProfileFile'));
    const preflightIdx = fn.indexOf('preflightUpload(');
    const uploadIdx = fn.indexOf("from('profile-files')");
    expect(preflightIdx).toBeGreaterThan(-1);
    expect(uploadIdx).toBeGreaterThan(-1);
    expect(preflightIdx).toBeLessThan(uploadIdx);
  });

  test('preflightUpload always reaches the magic-byte validator', () => {
    // Guard the helper itself: it must call validateFileMagicBytes so a future
    // edit can't quietly drop the anti-spoofing check.
    const src = readFileSync(resolve(ROOT, 'src/lib/file-magic-bytes.ts'), 'utf-8');
    const fn = src.slice(src.indexOf('export async function preflightUpload'));
    expect(fn).toMatch(/validateFileMagicBytes\(/);
  });
});
