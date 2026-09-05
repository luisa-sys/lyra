/**
 * KAN-142: magic-byte (file signature) validation.
 *
 * `File.type` is the declared MIME type — set by the browser based on
 * the file's extension, which is trivially spoofable. A malicious client
 * could upload a `.jpg`-named EXE with `Content-Type: image/jpeg` and
 * the browser would let it through. Server-side, we'd accept it on the
 * `Type` check alone.
 *
 * This module inspects the actual bytes of the file's prefix and matches
 * them against the documented signatures of the formats we allow. Any
 * file whose prefix doesn't match its declared type is rejected. The
 * cost is a single ArrayBuffer read of the file's first 16 bytes — much
 * smaller than the file itself.
 *
 * Signatures from <https://en.wikipedia.org/wiki/List_of_file_signatures>.
 */

export type AllowedMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif'
  | 'application/pdf';

export const ALLOWED_MIMES: ReadonlySet<AllowedMime> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

/**
 * Each format has 1+ acceptable magic byte sequences. JPEGs in
 * particular have several variants (JFIF, EXIF, raw SOI), which is why
 * we use an array of signatures rather than a single fixed prefix.
 */
const SIGNATURES: Record<AllowedMime, readonly Uint8Array[]> = {
  // JPEG: starts with 0xFF 0xD8 0xFF (start-of-image marker). The next
  // byte varies by sub-type (E0 = JFIF, E1 = EXIF, DB = raw quantization
  // table, etc.) — we accept any of them.
  'image/jpeg': [new Uint8Array([0xff, 0xd8, 0xff])],
  // PNG: fixed 8-byte signature.
  'image/png': [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ],
  // WebP: RIFF container — "RIFF" + 4 size bytes + "WEBP".
  // We can't predict the size bytes so we match the RIFF prefix and
  // verify "WEBP" appears at offset 8.
  // Encoded specially below in `matchesSignature`.
  'image/webp': [new Uint8Array([0x52, 0x49, 0x46, 0x46])],
  // GIF: "GIF87a" or "GIF89a" — 6 ASCII bytes.
  'image/gif': [
    new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]),
    new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
  ],
  // PDF: "%PDF-" — 5 ASCII bytes.
  'application/pdf': [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])],
};

/**
 * Returns true if the byte prefix of `buf` matches one of the documented
 * signatures for `mime`. For WebP, also verifies the "WEBP" marker at
 * offset 8 (since the RIFF prefix on its own is shared with WAV and AVI).
 */
export function matchesSignature(buf: Uint8Array, mime: AllowedMime): boolean {
  const sigs = SIGNATURES[mime];
  if (!sigs) return false;

  for (const sig of sigs) {
    if (buf.byteLength < sig.byteLength) continue;
    let ok = true;
    for (let i = 0; i < sig.byteLength; i++) {
      if (buf[i] !== sig[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    // WebP needs the additional WEBP marker check at offset 8.
    if (mime === 'image/webp') {
      if (buf.byteLength < 12) return false;
      const webpMarker = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
      for (let i = 0; i < 4; i++) {
        if (buf[8 + i] !== webpMarker[i]) return false;
      }
    }

    return true;
  }
  return false;
}

/**
 * Validates a file by reading its first 16 bytes and matching against
 * the declared MIME. Returns `null` if valid, or an error message if
 * the type is disallowed or the bytes don't match.
 *
 * This intentionally accepts a `File` or `ArrayBuffer` so it can be
 * called from a server action (`File` from `FormData`) or driven from
 * unit tests (raw bytes).
 */
export async function validateFileMagicBytes(
  fileOrBuf: File | ArrayBuffer | Uint8Array,
  declaredMime: string,
): Promise<string | null> {
  if (!ALLOWED_MIMES.has(declaredMime as AllowedMime)) {
    return `Disallowed MIME type: ${declaredMime}. Allowed: ${[...ALLOWED_MIMES].join(', ')}`;
  }

  let bytes: Uint8Array;
  if (fileOrBuf instanceof Uint8Array) {
    bytes = fileOrBuf;
  } else if (fileOrBuf instanceof ArrayBuffer) {
    bytes = new Uint8Array(fileOrBuf);
  } else {
    // File case: slice off just the first 16 bytes — enough for every
    // signature we check, much cheaper than reading the full file.
    const head = fileOrBuf.slice(0, 16);
    bytes = new Uint8Array(await head.arrayBuffer());
  }

  if (!matchesSignature(bytes, declaredMime as AllowedMime)) {
    return `File contents don't match declared type ${declaredMime}. The file may be corrupt or its extension may be wrong.`;
  }
  return null;
}

/**
 * SEC-52: shared upload preflight so the avatar path and the profile-files
 * path enforce the SAME validation and can't silently drift. The avatar
 * uploader historically validated only the browser-declared MIME + size and
 * skipped the magic-byte check that `uploadProfileFile` enforced — letting a
 * spoofed-MIME / polyglot file land in the (world-readable) profile-photos
 * bucket. Routing both callers through one helper closes that gap and keeps
 * them in lockstep.
 *
 * Runs, in order:
 *   1. presence + non-empty
 *   2. size cap
 *   3. declared MIME is in the caller's allow-list
 *   4. magic-byte signature match (the anti-spoofing check)
 *
 * Returns `null` when the file is safe to upload, or a human-readable error
 * string (mirrors `validateFileMagicBytes`' contract). Callers pass their own
 * allow-list, size cap, and messages so existing wording stays stable — but
 * every path is now guaranteed to run the magic-byte check.
 */
export interface UploadPreflightOptions {
  /** MIME types this caller accepts (a subset of ALLOWED_MIMES). */
  allowedMimes: ReadonlySet<string> | readonly string[];
  /** Hard byte cap for this caller. */
  maxBytes: number;
  emptyMessage?: string;
  sizeMessage?: string;
  typeMessage?: string;
}

export async function preflightUpload(
  file: File | null | undefined,
  opts: UploadPreflightOptions,
): Promise<string | null> {
  if (!file || file.size === 0) {
    return opts.emptyMessage ?? 'No file provided';
  }
  if (file.size > opts.maxBytes) {
    return opts.sizeMessage ?? `File exceeds the ${opts.maxBytes}-byte limit`;
  }
  const allowed =
    opts.allowedMimes instanceof Set
      ? (opts.allowedMimes as ReadonlySet<string>)
      : new Set<string>(opts.allowedMimes as readonly string[]);
  if (!allowed.has(file.type)) {
    return (
      opts.typeMessage ??
      `Disallowed type ${file.type}. Allowed: ${[...allowed].join(', ')}`
    );
  }
  // Never trust the declared MIME alone — verify the file's actual bytes.
  return validateFileMagicBytes(file, file.type);
}

/**
 * Extension guess from a MIME type. Used to build storage paths since
 * the original filename isn't trusted.
 */
export function extensionForMime(mime: AllowedMime): string {
  switch (mime) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    case 'application/pdf': return 'pdf';
  }
}
