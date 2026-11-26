/**
 * KAN-487 — v0.8 profile editor: pure photo helpers for the About Me photo
 * field (spec v0.8 §01 "Profile photo (required): JPG, PNG or WebP; maximum
 * 5 MB; square crop; minimum 400 × 400 pixels"; plan §B "Photo", §C row 01).
 *
 *   - Client pre-check of the picked file (type, size) and of the decoded
 *     image (≥ 400 × 400). The server re-checks everything from the bytes
 *     (photo-processing.ts); these checks only save a round trip.
 *   - Square crop maths in the image's NATURAL pixels: integer
 *     `{x, y, size}`, always inside the image, `size` ≥ 400 (the server's
 *     `validCrop` falls back to a centre crop for anything smaller).
 *     Keyboard: arrow keys move, + / − resize (about the centre).
 *   - Upload size: Vercel caps request bodies at 4.5 MB (KAN-486 plan Q4),
 *     so a file over PHOTO_UPLOAD_MAX_BYTES is not sent as is. The client
 *     draws only the crop square onto a canvas (side ≤ 2048, never < 400),
 *     re-encodes it as JPEG and sends crop `{0, 0, side}`.
 *
 * No DOM, no `'use client'`, no server-only imports (sharp lives in
 * photo-processing.ts, which must never reach the browser bundle, so the
 * limits are restated here as literals and pinned by tests).
 */

// ── Limits and copy (same values / strings as photo-processing.ts) ───────

// KAN-496: `.jpg`/`.jpeg` and HEIC are listed too. Some systems report an
// empty or unusual type for a JPG (so the picker greyed it out), and Safari
// can decode iPhone HEIC photos, which the editor then re-encodes as JPEG.
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';
export const PHOTO_ALLOWED_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];
export const PHOTO_MIN_PX = 400;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/**
 * KAN-496: the largest file the member may PICK. Phone photos are often
 * 5–15 MB; anything over PHOTO_UPLOAD_MAX_BYTES is shrunk in the browser, so
 * what reaches the server stays under PHOTO_MAX_BYTES (spec v0.8 §01).
 */
export const PHOTO_PICK_MAX_BYTES = 25 * 1024 * 1024;
/** Same as photo-processing.ts MAX_INPUT_PIXELS: larger images are shrunk in the browser first. */
export const PHOTO_SERVER_MAX_PIXELS = 40_000_000;
/** Largest body we send to the server action (Vercel's cap is 4.5 MB). */
export const PHOTO_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** Longest side of a client-downscaled crop (the server outputs 1024). */
export const DOWNSCALE_MAX_SIDE = 2048;
/** Each retry shrinks the side by this factor (floored at PHOTO_MIN_PX). */
export const DOWNSCALE_STEP = 0.75;
export const DOWNSCALE_JPEG_QUALITY = 0.9;

/**
 * Plan §C (hint under the picker). KAN-496 (founder feedback 2026-11-26):
 * the old hint said "up to 5 MB", and a normal phone JPG over 5 MB was refused
 * before the editor tried to shrink it. Old value:
 *   'JPG, PNG or WebP, at least 400 × 400 pixels, up to 5 MB'
 */
export const PHOTO_HINT = 'JPG, PNG or WebP, at least 400 × 400 pixels. Large photos are made smaller for you.';
export const PHOTO_TYPE_ERROR = 'Photos must be JPG, PNG or WebP.';
export const PHOTO_SIZE_ERROR = 'Photos must be 5 MB or smaller.';
export const PHOTO_DIMENSIONS_ERROR = 'Photos must be at least 400 × 400 pixels.';
export const PHOTO_UNREADABLE_ERROR = "We couldn't read that image. Please try another.";
// KAN-496: each failure says what was wrong and what to do (founder feedback 2026-11-26).
export const PHOTO_PICK_TYPE_ERROR =
  "This file isn't a JPG, PNG or WebP photo. Please choose a photo in one of those formats.";
export const PHOTO_HEIC_ERROR =
  "This is an iPhone HEIC photo, which this browser can't open. Please choose a JPG or PNG, or try again in Safari.";
export const PHOTO_PICK_SIZE_ERROR = 'This photo is larger than 25 MB. Please choose a smaller one.';
export const PHOTO_DECODE_ERROR =
  "We couldn't open this photo. The file may be damaged or in a format we don't support. Please try another photo.";
export const PHOTO_SMALL_ERROR = (w: number, h: number) =>
  `This photo is ${w} × ${h} pixels. Photos must be at least 400 × 400 pixels, so please choose a larger one.`;
export const PHOTO_UPLOAD_FAILED_ERROR =
  "We couldn't upload your photo. Please check your internet connection and try again.";
/** Plan §D copy (not in the spec; founder-approved 2026-11-23): a published profile cannot save without a photo. */
export const PHOTO_PUBLISHED_BLOCK_NOTE =
  'Add a new photo to save your changes — a published profile needs a photo.';

// ── Pre-checks ──────────────────────────────────────────────────────────

const EXT_RE = /\.(jpe?g|png|webp|heic|heif)$/i;
const HEIC_RE = /\.(heic|heif)$/i;

/** True when the picked file is (by type or name) an iPhone HEIC/HEIF photo. */
export function isHeicFile(file: { type: string; name?: string }): boolean {
  return /^image\/hei[cf]/i.test(file.type) || HEIC_RE.test(file.name ?? '');
}

/**
 * Type and size of the picked file. null when the editor should try to open
 * it. KAN-496: a file whose type is empty or HEIC but whose name says it is a
 * photo is let through; whether the browser can actually open it decides
 * (Safari opens HEIC; the result is re-encoded as JPEG before upload).
 */
export function preCheckPhotoFile(file: { type: string; size: number; name?: string }): string | null {
  const knownType = PHOTO_ALLOWED_TYPES.includes(file.type);
  const maybePhoto = knownType || isHeicFile(file) || (file.type === '' && EXT_RE.test(file.name ?? ''));
  if (!maybePhoto) return PHOTO_PICK_TYPE_ERROR;
  if (!(file.size > 0)) return PHOTO_DECODE_ERROR;
  if (file.size > PHOTO_PICK_MAX_BYTES) return PHOTO_PICK_SIZE_ERROR;
  return null;
}

/** The message when the browser could not open the picked file. */
export function decodeFailureError(file: { type: string; name?: string }): string {
  return isHeicFile(file) ? PHOTO_HEIC_ERROR : PHOTO_DECODE_ERROR;
}

/** Decoded (oriented) dimensions. null when both sides are ≥ 400. */
export function checkPhotoDimensions(width: number, height: number): string | null {
  if (!(width > 0) || !(height > 0)) return PHOTO_UNREADABLE_ERROR;
  if (width < PHOTO_MIN_PX || height < PHOTO_MIN_PX) return PHOTO_SMALL_ERROR(Math.round(width), Math.round(height));
  return null;
}

// ── Crop maths ──────────────────────────────────────────────────────────

/** A square in the image's natural pixels. Always integers. */
export interface CropBox {
  x: number;
  y: number;
  size: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/** The smallest crop side allowed: 400, or the image's short side if less. */
export function minCropSize(width: number, height: number): number {
  return Math.min(PHOTO_MIN_PX, Math.floor(width), Math.floor(height));
}

/** The largest centred square. */
export function initialCrop(width: number, height: number): CropBox {
  const w = Math.floor(width);
  const h = Math.floor(height);
  const size = Math.min(w, h);
  return { x: Math.floor((w - size) / 2), y: Math.floor((h - size) / 2), size };
}

/** Round to integers and keep the square inside the image, size in [min, short side]. */
export function clampCrop(crop: CropBox, width: number, height: number): CropBox {
  const w = Math.floor(width);
  const h = Math.floor(height);
  const size = clamp(Math.round(crop.size), minCropSize(w, h), Math.min(w, h));
  return {
    x: clamp(Math.round(crop.x), 0, w - size),
    y: clamp(Math.round(crop.y), 0, h - size),
    size,
  };
}

export function moveCrop(crop: CropBox, dx: number, dy: number, width: number, height: number): CropBox {
  return clampCrop({ x: crop.x + dx, y: crop.y + dy, size: crop.size }, width, height);
}

/** Grow (delta > 0) or shrink the square about its centre. */
export function resizeCrop(crop: CropBox, delta: number, width: number, height: number): CropBox {
  const w = Math.floor(width);
  const h = Math.floor(height);
  const size = clamp(Math.round(crop.size + delta), minCropSize(w, h), Math.min(w, h));
  const cx = crop.x + crop.size / 2;
  const cy = crop.y + crop.size / 2;
  return clampCrop({ x: Math.round(cx - size / 2), y: Math.round(cy - size / 2), size }, w, h);
}

/** Centre the square on a natural-pixel point (click to position, no drag). */
export function centreCropAt(crop: CropBox, px: number, py: number, width: number, height: number): CropBox {
  return clampCrop(
    { x: Math.round(px - crop.size / 2), y: Math.round(py - crop.size / 2), size: crop.size },
    width,
    height,
  );
}

/** Keyboard step: 2 % of the short side (at least 1 px); ×5 with Shift. */
export function cropStep(width: number, height: number, large = false): number {
  const base = Math.max(1, Math.round(Math.min(width, height) / 50));
  return large ? base * 5 : base;
}

export type CropKeyAction = { kind: 'move'; dx: number; dy: number } | { kind: 'resize'; delta: number };

/**
 * What a key does to the crop square, or null for keys it ignores.
 * Arrows move by one step; `+` / `=` grow and `-` / `_` / `−` shrink by
 * two steps (one on each side).
 */
export function cropKeyAction(key: string, width: number, height: number, large = false): CropKeyAction | null {
  const s = cropStep(width, height, large);
  switch (key) {
    case 'ArrowLeft':
      return { kind: 'move', dx: -s, dy: 0 };
    case 'ArrowRight':
      return { kind: 'move', dx: s, dy: 0 };
    case 'ArrowUp':
      return { kind: 'move', dx: 0, dy: -s };
    case 'ArrowDown':
      return { kind: 'move', dx: 0, dy: s };
    case '+':
    case '=':
      return { kind: 'resize', delta: 2 * s };
    case '-':
    case '_':
    case '−':
      return { kind: 'resize', delta: -2 * s };
    default:
      return null;
  }
}

/** Apply a key to the crop; null when the key is not a crop key. */
export function applyCropKey(
  crop: CropBox,
  key: string,
  width: number,
  height: number,
  large = false,
): CropBox | null {
  const a = cropKeyAction(key, width, height, large);
  if (a === null) return null;
  return a.kind === 'move' ? moveCrop(crop, a.dx, a.dy, width, height) : resizeCrop(crop, a.delta, width, height);
}

/** The crop frame as percentages of the displayed image (CSS left/top/width/height). */
export function cropOverlayPercent(
  crop: CropBox,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  return {
    left: (crop.x / width) * 100,
    top: (crop.y / height) * 100,
    width: (crop.size / width) * 100,
    height: (crop.size / height) * 100,
  };
}

/** A point on the displayed image (CSS px from its top-left) → natural pixels. */
export function displayToNatural(
  offsetX: number,
  offsetY: number,
  displayWidth: number,
  displayHeight: number,
  width: number,
  height: number,
): { x: number; y: number } {
  if (!(displayWidth > 0) || !(displayHeight > 0)) return { x: 0, y: 0 };
  return {
    x: clamp(Math.round((offsetX / displayWidth) * width), 0, width),
    y: clamp(Math.round((offsetY / displayHeight) * height), 0, height),
  };
}

/**
 * CSS for a `box`-px square preview of the crop: the whole image is drawn at
 * `width × height` px and shifted by `left` / `top` (both ≤ 0).
 */
export function cropPreviewStyle(
  crop: CropBox,
  width: number,
  height: number,
  box: number,
): { width: number; height: number; left: number; top: number } {
  const k = box / crop.size;
  return { width: width * k, height: height * k, left: -crop.x * k, top: -crop.y * k };
}

// ── Upload size ─────────────────────────────────────────────────────────

/** True when the original file is too big to send as is. */
export function needsDownscale(bytes: number): boolean {
  return bytes > PHOTO_UPLOAD_MAX_BYTES;
}

/**
 * KAN-496: true when the picked file must be redrawn in the browser and sent
 * as a JPEG rather than as is: too many bytes for the request, more pixels
 * than the server will decode, or a type the server does not accept (HEIC
 * opened by Safari, or a JPG the system reported with no type).
 */
export function needsReencode(file: { type: string; size: number }, width: number, height: number): boolean {
  return (
    needsDownscale(file.size) || width * height > PHOTO_SERVER_MAX_PIXELS || !PHOTO_ALLOWED_TYPES.includes(file.type)
  );
}

/**
 * The canvas side for downscale attempt `attempt` (0, 1, 2, …) of a crop of
 * `cropSize` natural pixels: min(cropSize, 2048), then ×0.75 per retry,
 * never below 400. Returns null once the 400 px attempt has been tried, so
 * the caller stops and shows the size error.
 */
export function downscaleSide(cropSize: number, attempt: number): number | null {
  const first = Math.max(PHOTO_MIN_PX, Math.min(Math.floor(cropSize), DOWNSCALE_MAX_SIDE));
  const sideAt = (n: number) => Math.max(PHOTO_MIN_PX, Math.floor(first * DOWNSCALE_STEP ** n));
  if (!Number.isInteger(attempt) || attempt < 0) return null;
  if (attempt > 0 && sideAt(attempt - 1) === PHOTO_MIN_PX) return null;
  return sideAt(attempt);
}

/** The crop sent with a downscaled upload: the whole square image. */
export function downscaledUploadCrop(side: number): CropBox {
  return { x: 0, y: 0, size: side };
}

/**
 * KAN-487 — only a same-document object URL (`blob:`) created from the picked
 * file may be used as an <img> src while cropping. Anything else is refused,
 * so text from the DOM can never be reinterpreted as markup (CodeQL
 * js/xss-through-dom).
 */
export function safeObjectUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url.startsWith('blob:')) return null;
  return url;
}
