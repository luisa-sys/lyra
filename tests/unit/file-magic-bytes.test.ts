/**
 * KAN-142: magic-byte validator behaviour.
 *
 * Each test feeds a synthetic byte buffer with a known signature prefix
 * and asserts the validator accepts the matching MIME and rejects every
 * other one. The point is regression coverage on the spoofing-attack
 * vector: a `.jpg`-named EXE with `Content-Type: image/jpeg` should be
 * detected and rejected.
 */

import {
  validateFileMagicBytes,
  matchesSignature,
  extensionForMime,
  ALLOWED_MIMES,
  type AllowedMime,
} from '@/lib/file-magic-bytes';

/** Build a Uint8Array with a known prefix and trailing zeros. */
function bufWithPrefix(prefix: number[], totalLen = 32): Uint8Array {
  const out = new Uint8Array(totalLen);
  out.set(prefix);
  return out;
}

// Documented signature prefixes — taken from Wikipedia's file-signatures
// list. Used both to drive happy-path tests and to make the negative
// (mismatch) cases obvious.
const SIG = {
  jpegJFIF: [0xff, 0xd8, 0xff, 0xe0],
  jpegEXIF: [0xff, 0xd8, 0xff, 0xe1],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  webp: [
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x00, 0x00, 0x00, 0x00, // size (any 4 bytes)
    0x57, 0x45, 0x42, 0x50, // WEBP
  ],
  gif87: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
  gif89: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d],
  exe: [0x4d, 0x5a], // PE/COFF header — definitely not an image
  webpNoMarker: [
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x00, 0x00, 0x00, 0x00, // size
    0x57, 0x41, 0x56, 0x45, // WAVE — NOT WebP
  ],
} as const;

describe('KAN-142 magic-byte validator', () => {
  describe('happy paths — each MIME accepts its own signature', () => {
    const cases: Array<[string, AllowedMime, number[]]> = [
      ['JPEG (JFIF)', 'image/jpeg', [...SIG.jpegJFIF]],
      ['JPEG (EXIF)', 'image/jpeg', [...SIG.jpegEXIF]],
      ['PNG', 'image/png', [...SIG.png]],
      ['WebP', 'image/webp', [...SIG.webp]],
      ['GIF87a', 'image/gif', [...SIG.gif87]],
      ['GIF89a', 'image/gif', [...SIG.gif89]],
      ['PDF', 'application/pdf', [...SIG.pdf]],
    ];

    for (const [name, mime, sig] of cases) {
      test(`${name} prefix matches ${mime}`, () => {
        expect(matchesSignature(bufWithPrefix(sig), mime)).toBe(true);
      });
    }
  });

  describe('rejection cases — bytes do not match declared MIME', () => {
    test('EXE bytes declared as image/jpeg → rejected', async () => {
      const err = await validateFileMagicBytes(bufWithPrefix([...SIG.exe]), 'image/jpeg');
      expect(err).toMatch(/don['']t match/i);
    });

    test('PNG bytes declared as application/pdf → rejected', async () => {
      const err = await validateFileMagicBytes(bufWithPrefix([...SIG.png]), 'application/pdf');
      expect(err).toMatch(/don['']t match/i);
    });

    test('GIF87a bytes declared as image/png → rejected', async () => {
      const err = await validateFileMagicBytes(bufWithPrefix([...SIG.gif87]), 'image/png');
      expect(err).toMatch(/don['']t match/i);
    });

    test('RIFF/WAVE (not WebP) declared as image/webp → rejected', async () => {
      // RIFF prefix matches WebP's first 4 bytes, but the marker at offset 8
      // is "WAVE" not "WEBP". Validator must catch this.
      const err = await validateFileMagicBytes(bufWithPrefix([...SIG.webpNoMarker]), 'image/webp');
      expect(err).toMatch(/don['']t match/i);
    });

    test('Empty buffer declared as image/jpeg → rejected', async () => {
      const err = await validateFileMagicBytes(new Uint8Array(0), 'image/jpeg');
      expect(err).toMatch(/don['']t match/i);
    });
  });

  describe('disallowed MIME types', () => {
    test('text/html → rejected even before byte check', async () => {
      const err = await validateFileMagicBytes(new Uint8Array(64), 'text/html');
      expect(err).toMatch(/Disallowed MIME/i);
    });

    test('application/zip → rejected', async () => {
      const err = await validateFileMagicBytes(new Uint8Array(64), 'application/zip');
      expect(err).toMatch(/Disallowed MIME/i);
    });
  });

  describe('extensionForMime', () => {
    test('returns standard extensions', () => {
      expect(extensionForMime('image/jpeg')).toBe('jpg');
      expect(extensionForMime('image/png')).toBe('png');
      expect(extensionForMime('image/webp')).toBe('webp');
      expect(extensionForMime('image/gif')).toBe('gif');
      expect(extensionForMime('application/pdf')).toBe('pdf');
    });
  });

  describe('ALLOWED_MIMES export', () => {
    test('contains exactly the five types we accept', () => {
      expect(ALLOWED_MIMES.size).toBe(5);
      expect(ALLOWED_MIMES.has('image/jpeg')).toBe(true);
      expect(ALLOWED_MIMES.has('image/png')).toBe(true);
      expect(ALLOWED_MIMES.has('image/webp')).toBe(true);
      expect(ALLOWED_MIMES.has('image/gif')).toBe(true);
      expect(ALLOWED_MIMES.has('application/pdf')).toBe(true);
    });
  });
});
