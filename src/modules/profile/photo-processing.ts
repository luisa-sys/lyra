/**
 * KAN-486 — spec v0.8 §01 / §3: profile photo pipeline (server only).
 *
 * "JPG, PNG or WebP; maximum 5 MB; square crop; minimum 400 × 400 pixels.
 * Strip EXIF/location metadata; verify actual file type on server."
 *
 *   - Real type: sharp decodes the bytes and reports the format it found
 *     (magic bytes), whatever MIME type or extension the browser declared.
 *   - Orientation is applied first (.rotate()), so the size check and the crop
 *     see the image the way the member does.
 *   - Square: the member's crop rectangle when valid, otherwise a centre crop.
 *   - Re-encoded to JPEG without withMetadata(), so EXIF, GPS, ICC comments and
 *     XMP are all dropped. Transparent PNG/WebP areas are flattened to white.
 *
 * Node runtime only — never import this from middleware or the edge.
 */

import sharp, { type Metadata } from 'sharp';

export const PHOTO_MIN_PX = 400;
export const PHOTO_OUT_PX = 1024;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000; // decompression-bomb guard

const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export const PHOTO_TYPE_ERROR = 'Photos must be JPG, PNG or WebP.';
export const PHOTO_SIZE_ERROR = 'Photos must be 5 MB or smaller.';
export const PHOTO_DIMENSIONS_ERROR = 'Photos must be at least 400 × 400 pixels.';
export const PHOTO_UNREADABLE_ERROR = "We couldn't read that image. Please try another.";

export interface PhotoCrop {
  x: number;
  y: number;
  size: number;
}

export type PhotoResult =
  | { ok: true; buffer: Buffer; contentType: 'image/jpeg'; ext: 'jpg'; width: number; height: number }
  | { ok: false; error: string };

function validCrop(crop: PhotoCrop | null | undefined, w: number, h: number): crop is PhotoCrop {
  if (!crop) return false;
  const { x, y, size } = crop;
  if (![x, y, size].every((v) => Number.isInteger(v))) return false;
  return x >= 0 && y >= 0 && size >= PHOTO_MIN_PX && x + size <= w && y + size <= h;
}

/** Parse optional cropX / cropY / cropSize form fields (integers) into a crop. */
export function parseCrop(form: { get(name: string): unknown }): PhotoCrop | null {
  const read = (k: string) => {
    const v = form.get(k);
    if (typeof v !== 'string' || !/^\d{1,6}$/.test(v)) return null;
    return Number(v);
  };
  const x = read('cropX');
  const y = read('cropY');
  const size = read('cropSize');
  return x === null || y === null || size === null ? null : { x, y, size };
}

export async function processProfilePhoto(
  input: ArrayBuffer | Buffer,
  crop?: PhotoCrop | null,
): Promise<PhotoResult> {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.byteLength === 0) return { ok: false, error: PHOTO_UNREADABLE_ERROR };
  if (buf.byteLength > PHOTO_MAX_BYTES) return { ok: false, error: PHOTO_SIZE_ERROR };

  const opts = { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' as const };

  let meta: Metadata;
  try {
    meta = await sharp(buf, opts).metadata();
  } catch {
    return { ok: false, error: PHOTO_TYPE_ERROR };
  }
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) return { ok: false, error: PHOTO_TYPE_ERROR };
  if (!meta.width || !meta.height) return { ok: false, error: PHOTO_UNREADABLE_ERROR };

  // EXIF orientations 5–8 rotate by 90°, swapping width and height. The
  // pipeline below calls .rotate() BEFORE .extract(), so sharp applies the
  // orientation first and the crop is in the member's (oriented) coordinates.
  const swapped = (meta.orientation ?? 1) >= 5;
  const w = swapped ? meta.height : meta.width;
  const h = swapped ? meta.width : meta.height;
  if (w < PHOTO_MIN_PX || h < PHOTO_MIN_PX) return { ok: false, error: PHOTO_DIMENSIONS_ERROR };

  try {

    const square = validCrop(crop, w, h)
      ? { left: crop.x, top: crop.y, width: crop.size, height: crop.size }
      : (() => {
          const side = Math.min(w, h);
          return { left: Math.floor((w - side) / 2), top: Math.floor((h - side) / 2), width: side, height: side };
        })();

    const out = await sharp(buf, opts)
      .rotate()
      .extract(square)
      .resize(PHOTO_OUT_PX, PHOTO_OUT_PX, { fit: 'cover', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    return {
      ok: true,
      buffer: out.data,
      contentType: 'image/jpeg',
      ext: 'jpg',
      width: out.info.width,
      height: out.info.height,
    };
  } catch {
    return { ok: false, error: PHOTO_UNREADABLE_ERROR };
  }
}
