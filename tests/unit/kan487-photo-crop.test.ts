/**
 * KAN-487 — About Me photo helpers (spec v0.8 §01 "JPG, PNG or WebP; maximum
 * 5 MB; square crop; minimum 400 × 400 pixels"; plan §B "Photo", §C row 01,
 * §D copy, founder-approved 2026-11-23). Expected values are literals from the spec / plan.
 */
import {
  PHOTO_PICK_MAX_BYTES,
  needsReencode,
  decodeFailureError,
  DOWNSCALE_MAX_SIDE,
  PHOTO_ACCEPT,
  PHOTO_HINT,
  PHOTO_MAX_BYTES,
  PHOTO_MIN_PX,
  PHOTO_PUBLISHED_BLOCK_NOTE,
  PHOTO_UPLOAD_MAX_BYTES,
  applyCropKey,
  centreCropAt,
  checkPhotoDimensions,
  clampCrop,
  cropKeyAction,
  cropOverlayPercent,
  cropPreviewStyle,
  cropStep,
  displayToNatural,
  downscaleSide,
  downscaledUploadCrop,
  initialCrop,
  minCropSize,
  moveCrop,
  safeObjectUrl,
  needsDownscale,
  preCheckPhotoFile,
  resizeCrop,
} from '@/modules/profile/editor/photo-crop';

const MB = 1024 * 1024;

describe('KAN-487 photo limits and copy', () => {
  test('limits are the spec values', () => {
    // KAN-496 (founder feedback 2026-11-26): extensions and HEIC are listed so
    // a JPG the system reports oddly is not greyed out. Old expected value:
    //   expect(PHOTO_ACCEPT).toBe('image/jpeg,image/png,image/webp');
    expect(PHOTO_ACCEPT).toBe(
      'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif',
    );
    expect(PHOTO_PICK_MAX_BYTES).toBe(26214400);
    expect(PHOTO_MIN_PX).toBe(400);
    expect(PHOTO_MAX_BYTES).toBe(5242880);
    expect(PHOTO_UPLOAD_MAX_BYTES).toBe(4194304);
    expect(DOWNSCALE_MAX_SIDE).toBe(2048);
  });

  test('hint and published-photo note are the plan copy', () => {
    // KAN-496. Old expected value:
    //   expect(PHOTO_HINT).toBe('JPG, PNG or WebP, at least 400 × 400 pixels, up to 5 MB');
    expect(PHOTO_HINT).toBe('JPG, PNG or WebP, at least 400 × 400 pixels. Large photos are made smaller for you.');
    expect(PHOTO_PUBLISHED_BLOCK_NOTE).toBe(
      'Add a new photo to save your changes — a published profile needs a photo.',
    );
  });
});

describe('KAN-487 preCheckPhotoFile — type and size before cropping', () => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  test.each(allowed)('%s up to 5 MB passes', (type) => {
    expect(allowed.length).toBe(3);
    expect(preCheckPhotoFile({ type, size: 5 * MB })).toBeNull();
  });

  // KAN-496 (founder feedback 2026-11-26): a normal phone JPG over 5 MB was
  // refused before the editor tried to shrink it. Old expected values:
  //   refused types: 'image/gif', 'image/svg+xml', 'image/heic', 'application/pdf', ''
  //     → 'Photos must be JPG, PNG or WebP.'
  //   5 MB + 1 byte → 'Photos must be 5 MB or smaller.'
  //   empty file → "We couldn't read that image. Please try another."
  const refused = ['image/gif', 'image/svg+xml', 'application/pdf', ''];
  test.each(refused)('%p is refused with the type error', (type) => {
    expect(refused.length).toBe(4);
    expect(preCheckPhotoFile({ type, size: 1000 })).toBe(
      "This file isn't a JPG, PNG or WebP photo. Please choose a photo in one of those formats.",
    );
  });

  test('HEIC, and a JPG the system reported with no type, are let through to the browser to open', () => {
    expect(preCheckPhotoFile({ type: 'image/heic', size: 1000, name: 'IMG_1.HEIC' })).toBeNull();
    expect(preCheckPhotoFile({ type: '', size: 1000, name: 'IMG_1.HEIC' })).toBeNull();
    expect(preCheckPhotoFile({ type: '', size: 1000, name: 'holiday.JPG' })).toBeNull();
    expect(preCheckPhotoFile({ type: '', size: 1000, name: 'notes.pdf' })).not.toBeNull();
  });

  test('a phone photo over 5 MB passes (it is shrunk before upload); over 25 MB is refused', () => {
    expect(preCheckPhotoFile({ type: 'image/jpeg', size: 12 * MB })).toBeNull();
    expect(preCheckPhotoFile({ type: 'image/jpeg', size: 25 * MB })).toBeNull();
    expect(preCheckPhotoFile({ type: 'image/png', size: 25 * MB + 1 })).toBe(
      'This photo is larger than 25 MB. Please choose a smaller one.',
    );
  });

  test('an empty file cannot be opened', () => {
    expect(preCheckPhotoFile({ type: 'image/jpeg', size: 0 })).toBe(
      "We couldn't open this photo. The file may be damaged or in a format we don't support. Please try another photo.",
    );
  });

  test('a file the browser cannot open gets a HEIC-specific or general message', () => {
    expect(decodeFailureError({ type: 'image/heic', name: 'a.heic' })).toBe(
      "This is an iPhone HEIC photo, which this browser can't open. Please choose a JPG or PNG, or try again in Safari.",
    );
    expect(decodeFailureError({ type: 'image/jpeg', name: 'a.jpg' })).toMatch(/^We couldn't open this photo\./);
  });
});

describe('KAN-496 needsReencode — what is redrawn as JPEG before upload', () => {
  test('a small JPG within the pixel limit is sent as is', () => {
    expect(needsReencode({ type: 'image/jpeg', size: 3 * MB }, 4032, 3024)).toBe(false);
  });
  test('over 4 MB, over 40 MP, HEIC or untyped is redrawn', () => {
    expect(needsReencode({ type: 'image/jpeg', size: 4 * MB + 1 }, 4032, 3024)).toBe(true);
    expect(needsReencode({ type: 'image/jpeg', size: 3 * MB }, 8064, 6048)).toBe(true);
    expect(needsReencode({ type: 'image/heic', size: 1 * MB }, 4032, 3024)).toBe(true);
    expect(needsReencode({ type: '', size: 1 * MB }, 4032, 3024)).toBe(true);
  });
});

describe('KAN-487 checkPhotoDimensions — at least 400 × 400', () => {
  test('exactly 400 × 400 passes', () => {
    expect(checkPhotoDimensions(400, 400)).toBeNull();
  });
  // KAN-496: the message now gives the photo's size. Old expected value:
  //   'Photos must be at least 400 × 400 pixels.'
  test('399 wide is refused', () => {
    expect(checkPhotoDimensions(399, 1000)).toBe(
      'This photo is 399 × 1000 pixels. Photos must be at least 400 × 400 pixels, so please choose a larger one.',
    );
  });
  test('399 high is refused', () => {
    expect(checkPhotoDimensions(1000, 399)).toBe(
      'This photo is 1000 × 399 pixels. Photos must be at least 400 × 400 pixels, so please choose a larger one.',
    );
  });
  test('zero size is unreadable', () => {
    expect(checkPhotoDimensions(0, 0)).toBe("We couldn't read that image. Please try another.");
  });
});

describe('KAN-487 initialCrop — largest centred square', () => {
  test('landscape', () => {
    expect(initialCrop(1000, 600)).toEqual({ x: 200, y: 0, size: 600 });
  });
  test('portrait with an odd margin floors', () => {
    expect(initialCrop(600, 1001)).toEqual({ x: 0, y: 200, size: 600 });
  });
  test('square', () => {
    expect(initialCrop(800, 800)).toEqual({ x: 0, y: 0, size: 800 });
  });
});

describe('KAN-487 clampCrop — integers, inside the image, size ≥ 400', () => {
  test('minCropSize is 400 for a large image', () => {
    expect(minCropSize(1000, 800)).toBe(400);
  });
  test('rounds fractional values', () => {
    expect(clampCrop({ x: 10.4, y: 20.6, size: 500.5 }, 1000, 800)).toEqual({ x: 10, y: 21, size: 501 });
  });
  test('size below 400 grows to 400', () => {
    expect(clampCrop({ x: 0, y: 0, size: 100 }, 1000, 800)).toEqual({ x: 0, y: 0, size: 400 });
  });
  test('size above the short side shrinks to it', () => {
    expect(clampCrop({ x: 0, y: 0, size: 5000 }, 1000, 800)).toEqual({ x: 0, y: 0, size: 800 });
  });
  test('negative position clamps to 0', () => {
    expect(clampCrop({ x: -50, y: -1, size: 500 }, 1000, 800)).toEqual({ x: 0, y: 0, size: 500 });
  });
  test('position past the far edge clamps so the square stays inside', () => {
    expect(clampCrop({ x: 900, y: 700, size: 500 }, 1000, 800)).toEqual({ x: 500, y: 300, size: 500 });
  });
});

describe('KAN-487 moveCrop / resizeCrop / centreCropAt', () => {
  test('moves by dx, dy', () => {
    expect(moveCrop({ x: 100, y: 100, size: 500 }, 20, -30, 1000, 800)).toEqual({ x: 120, y: 70, size: 500 });
  });
  test('cannot move past the right edge', () => {
    expect(moveCrop({ x: 490, y: 0, size: 500 }, 50, 0, 1000, 800)).toEqual({ x: 500, y: 0, size: 500 });
  });
  test('grows about the centre', () => {
    expect(resizeCrop({ x: 200, y: 200, size: 400 }, 100, 1000, 800)).toEqual({ x: 150, y: 150, size: 500 });
  });
  test('shrinks about the centre', () => {
    expect(resizeCrop({ x: 100, y: 100, size: 600 }, -100, 1000, 800)).toEqual({ x: 150, y: 150, size: 500 });
  });
  test('cannot shrink below 400', () => {
    expect(resizeCrop({ x: 100, y: 100, size: 420 }, -100, 1000, 800)).toEqual({ x: 110, y: 110, size: 400 });
  });
  test('growing at a corner stays inside', () => {
    expect(resizeCrop({ x: 0, y: 0, size: 700 }, 400, 1000, 800)).toEqual({ x: 0, y: 0, size: 800 });
  });
  test('centres on a clicked point', () => {
    expect(centreCropAt({ x: 0, y: 0, size: 400 }, 500, 400, 1000, 800)).toEqual({ x: 300, y: 200, size: 400 });
  });
  test('a click near the edge keeps the square inside', () => {
    expect(centreCropAt({ x: 0, y: 0, size: 400 }, 990, 10, 1000, 800)).toEqual({ x: 600, y: 0, size: 400 });
  });
});

describe('KAN-487 keyboard crop — arrows move, +/- resize', () => {
  test('step is 2 % of the short side, ×5 with Shift', () => {
    expect(cropStep(1000, 800)).toBe(16);
    expect(cropStep(1000, 800, true)).toBe(80);
    expect(cropStep(400, 400)).toBe(8);
  });

  test('arrow keys move', () => {
    expect(cropKeyAction('ArrowLeft', 1000, 800)).toEqual({ kind: 'move', dx: -16, dy: 0 });
    expect(cropKeyAction('ArrowRight', 1000, 800)).toEqual({ kind: 'move', dx: 16, dy: 0 });
    expect(cropKeyAction('ArrowUp', 1000, 800)).toEqual({ kind: 'move', dx: 0, dy: -16 });
    expect(cropKeyAction('ArrowDown', 1000, 800)).toEqual({ kind: 'move', dx: 0, dy: 16 });
  });

  test('+ and = grow, - and _ shrink, by two steps', () => {
    expect(cropKeyAction('+', 1000, 800)).toEqual({ kind: 'resize', delta: 32 });
    expect(cropKeyAction('=', 1000, 800)).toEqual({ kind: 'resize', delta: 32 });
    expect(cropKeyAction('-', 1000, 800)).toEqual({ kind: 'resize', delta: -32 });
    expect(cropKeyAction('_', 1000, 800)).toEqual({ kind: 'resize', delta: -32 });
  });

  test('other keys are ignored', () => {
    expect(cropKeyAction('Enter', 1000, 800)).toBeNull();
    expect(cropKeyAction('a', 1000, 800)).toBeNull();
    expect(applyCropKey({ x: 0, y: 0, size: 400 }, 'Tab', 1000, 800)).toBeNull();
  });

  test('applyCropKey moves and resizes', () => {
    expect(applyCropKey({ x: 100, y: 100, size: 500 }, 'ArrowRight', 1000, 800)).toEqual({ x: 116, y: 100, size: 500 });
    expect(applyCropKey({ x: 100, y: 100, size: 500 }, 'ArrowUp', 1000, 800, true)).toEqual({ x: 100, y: 20, size: 500 });
    expect(applyCropKey({ x: 100, y: 100, size: 500 }, '+', 1000, 800)).toEqual({ x: 84, y: 84, size: 532 });
    expect(applyCropKey({ x: 100, y: 100, size: 500 }, '-', 1000, 800)).toEqual({ x: 116, y: 116, size: 468 });
  });
});

describe('KAN-487 crop display mapping', () => {
  test('overlay percentages', () => {
    expect(cropOverlayPercent({ x: 250, y: 200, size: 400 }, 1000, 800)).toEqual({
      left: 25,
      top: 25,
      width: 40,
      height: 50,
    });
  });
  test('display point → natural pixels', () => {
    expect(displayToNatural(150, 60, 300, 240, 1000, 800)).toEqual({ x: 500, y: 200 });
  });
  test('display point outside the image clamps', () => {
    expect(displayToNatural(-5, 999, 300, 240, 1000, 800)).toEqual({ x: 0, y: 800 });
  });
  test('zero display size maps to the origin', () => {
    expect(displayToNatural(10, 10, 0, 0, 1000, 800)).toEqual({ x: 0, y: 0 });
  });
  test('preview style for a 100 px box', () => {
    expect(cropPreviewStyle({ x: 200, y: 100, size: 400 }, 1000, 800, 100)).toEqual({
      width: 250,
      height: 200,
      left: -50,
      top: -25,
    });
  });
});

describe('KAN-487 upload downscaling — under 4 MB, never below 400 px', () => {
  test('a file of exactly 4 MB is sent as is', () => {
    expect(needsDownscale(4194304)).toBe(false);
  });
  test('one byte over 4 MB is downscaled', () => {
    expect(needsDownscale(4194305)).toBe(true);
  });

  test('first attempt uses the crop size when under 2048', () => {
    expect(downscaleSide(1500, 0)).toBe(1500);
  });
  test('first attempt caps at 2048', () => {
    expect(downscaleSide(4000, 0)).toBe(2048);
  });
  test('retries shrink by 0.75, floored', () => {
    expect(downscaleSide(4000, 1)).toBe(1536);
    expect(downscaleSide(4000, 2)).toBe(1152);
    expect(downscaleSide(4000, 3)).toBe(864);
    expect(downscaleSide(4000, 4)).toBe(648);
    expect(downscaleSide(4000, 5)).toBe(486);
  });
  test('the last attempt is exactly 400, then it stops', () => {
    expect(downscaleSide(4000, 6)).toBe(400);
    expect(downscaleSide(4000, 7)).toBeNull();
  });
  test('a 400 px crop gets one attempt only', () => {
    expect(downscaleSide(400, 0)).toBe(400);
    expect(downscaleSide(400, 1)).toBeNull();
  });
  test('a negative or fractional attempt is refused', () => {
    expect(downscaleSide(1000, -1)).toBeNull();
    expect(downscaleSide(1000, 0.5)).toBeNull();
  });
  test('the downscaled upload is cropped to the whole square', () => {
    expect(downscaledUploadCrop(1536)).toEqual({ x: 0, y: 0, size: 1536 });
  });
});

describe('KAN-487 safeObjectUrl (CodeQL js/xss-through-dom)', () => {
  test('accepts a blob: object URL unchanged', () => {
    expect(safeObjectUrl('blob:https://dev.checklyra.com/1b4e28ba-2fa1-11d2-883f-0016d3cca427')).toBe(
      'blob:https://dev.checklyra.com/1b4e28ba-2fa1-11d2-883f-0016d3cca427',
    );
  });
  test.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'https://evil.example/x.png', '', '"><img src=x>'])(
    'refuses %j',
    (u) => {
      expect(safeObjectUrl(u)).toBeNull();
    },
  );
  test('refuses null / undefined', () => {
    expect(safeObjectUrl(null)).toBeNull();
    expect(safeObjectUrl(undefined)).toBeNull();
  });
});
