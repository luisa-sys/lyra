/**
 * KAN-486 — profile photo pipeline (spec v0.8 §01): real type verified, ≥ 400 px,
 * ≤ 5 MB, square, EXIF/GPS stripped. Images are generated in memory with sharp.
 */
import sharp from 'sharp';
import { processProfilePhoto, parseCrop } from '@/modules/profile/photo-processing';

async function image(w: number, h: number, format: 'jpeg' | 'png' | 'webp' | 'gif' = 'jpeg'): Promise<Buffer> {
  const base = sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 100, b: 50 } } });
  return base.toFormat(format).toBuffer();
}

async function jpegWithGps(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .withExif({
      IFD0: { Copyright: 'secret-owner', Make: 'PhoneCo' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 0/1' },
    })
    .jpeg()
    .toBuffer();
}

describe('KAN-486 processProfilePhoto — rejections', () => {
  test('under 400 px on either side is rejected', async () => {
    expect(await processProfilePhoto(await image(399, 600, 'png'))).toEqual({
      ok: false,
      error: 'Photos must be at least 400 × 400 pixels.',
    });
    expect(await processProfilePhoto(await image(600, 399))).toEqual({
      ok: false,
      error: 'Photos must be at least 400 × 400 pixels.',
    });
  });

  test('GIF is rejected by its real type', async () => {
    expect(await processProfilePhoto(await image(500, 500, 'gif'))).toEqual({
      ok: false,
      error: 'Photos must be JPG, PNG or WebP.',
    });
  });

  test('non-image bytes are rejected by their real type', async () => {
    expect(await processProfilePhoto(Buffer.from('<html>not an image</html>'))).toEqual({
      ok: false,
      error: 'Photos must be JPG, PNG or WebP.',
    });
  });

  test('over 5 MB is rejected before decoding', async () => {
    expect(await processProfilePhoto(Buffer.alloc(5 * 1024 * 1024 + 1))).toEqual({
      ok: false,
      error: 'Photos must be 5 MB or smaller.',
    });
  });
});

describe('KAN-486 processProfilePhoto — output', () => {
  test('EXIF and GPS are stripped and the output is a square JPEG', async () => {
    const input = await jpegWithGps(800, 600);
    expect((await sharp(input).metadata()).exif).toBeDefined(); // the fixture really carries EXIF

    const r = await processProfilePhoto(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const meta = await sharp(r.buffer).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([600, 600]);
    expect(r.buffer.includes(Buffer.from('secret-owner'))).toBe(false);
  });

  test.each(['png', 'webp'] as const)('%s input is accepted and re-encoded as JPEG', async (fmt) => {
    const r = await processProfilePhoto(await image(500, 700, fmt));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.contentType).toBe('image/jpeg');
    expect((await sharp(r.buffer).metadata()).format).toBe('jpeg');
  });

  test('large images are downscaled to 1024 × 1024', async () => {
    const r = await processProfilePhoto(await image(2000, 1500));
    expect(r.ok && [r.width, r.height]).toEqual([1024, 1024]);
  });

  test('a valid crop rectangle is used', async () => {
    const r = await processProfilePhoto(await image(1000, 600), { x: 100, y: 0, size: 500 });
    expect(r.ok && [r.width, r.height]).toEqual([500, 500]);
  });

  test('an out-of-bounds crop falls back to a centre crop', async () => {
    const r = await processProfilePhoto(await image(1000, 600), { x: 800, y: 0, size: 500 });
    expect(r.ok && [r.width, r.height]).toEqual([600, 600]);
  });
});

describe('KAN-486 parseCrop', () => {
  const form = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  test('integers parse', () => {
    expect(parseCrop(form({ cropX: '10', cropY: '0', cropSize: '400' }))).toEqual({ x: 10, y: 0, size: 400 });
  });
  test('missing or non-integer fields give null', () => {
    expect(parseCrop(form({ cropX: '10', cropY: '0' }))).toBeNull();
    expect(parseCrop(form({ cropX: '1.5', cropY: '0', cropSize: '400' }))).toBeNull();
    expect(parseCrop(form({ cropX: '-1', cropY: '0', cropSize: '400' }))).toBeNull();
  });
});
