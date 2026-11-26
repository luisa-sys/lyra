/**
 * Profile photo upload tests
 * KAN-135: Profile photo upload — Supabase Storage + upload API + display
 */

const fs = require('fs');
const path = require('path');
const { SRC } = require('../support/source-paths.json');

const root = path.join(__dirname, '../..');

describe('KAN-135: Upload action exists with validation', () => {
  const actionsPath = path.join(root, SRC.profileActions);
  let content;

  beforeAll(() => {
    content = fs.readFileSync(actionsPath, 'utf8');
  });

  test('uploadAvatar function is exported', () => {
    expect(content).toMatch(/export async function uploadAvatar/);
  });

  // KAN-486 (spec v0.8 §01, founder-approved 2026-11-23): JPG, PNG or WebP
  // only — GIF is no longer accepted (this case used to assert 'image/gif' was
  // present). Behaviour is pinned in upload-avatar-limits-wiring.test.ts.
  test('validates MIME type server-side', () => {
    expect(content).toContain('ALLOWED_IMAGE_TYPES');
    expect(content).toContain("'image/jpeg'");
    expect(content).toContain("'image/png'");
    expect(content).toContain("'image/webp'");
    expect(content).not.toContain("'image/gif'");
  });

  // KAN-486: the 5 MB cap now comes from the photo pipeline
  // (src/modules/profile/photo-processing.ts, PHOTO_MAX_BYTES = 5 * 1024 * 1024);
  // this case used to look for a local MAX_FILE_SIZE constant.
  test('validates file size (5MB max)', () => {
    expect(content).toContain('maxBytes: PHOTO_MAX_BYTES');
  });

  test('uploads to profile-photos bucket', () => {
    expect(content).toContain("'profile-photos'");
    expect(content).toContain('.upload(');
  });

  test('updates profiles.avatar_url after upload', () => {
    expect(content).toContain('avatar_url');
    expect(content).toContain('publicUrl');
  });

  test('uses upsert to overwrite existing avatar', () => {
    expect(content).toContain('upsert: true');
  });
});

describe('KAN-135: WizardProfile includes avatar_url', () => {
  const typesPath = path.join(root, SRC.types);
  let content;

  beforeAll(() => {
    content = fs.readFileSync(typesPath, 'utf8');
  });

  test('WizardProfile has avatar_url field', () => {
    expect(content).toContain('avatar_url: string | null');
  });
});

// KAN-487 part 3 (founder sign-off 2026-11-23, chat): this describe read the
// legacy wizard's `steps/identity-step.tsx`, which is deleted. The photo
// upload UI it guarded is live in the v0.8 editor's `editor/photo-field.tsx`,
// so the five tests are repointed there (comments stripped, so the file's own
// header — which quotes `<input type="file" …>` — cannot satisfy them).
// Old expected values, on identity-step.tsx:
//   'onUploadAvatar'
//   'type="file"', 'accept="image/jpeg,image/png,image/webp,image/gif"'
//   'preview', 'readAsDataURL'
//   'image/jpeg', 'Please choose a JPEG'
//   '5 * 1024 * 1024', 'under 5MB'
// v0.8 §01 accepts JPG, PNG or WebP only (no GIF) up to 5 MB; the accept
// value itself is pinned as a literal in kan487-photo-crop.test.ts.
describe('KAN-135: Editor has photo upload UI', () => {
  const { stripComments } = require('../support/strip-comments');
  const {
    preCheckPhotoFile,
    PHOTO_TYPE_ERROR,
    PHOTO_SIZE_ERROR,
  } = require('@/modules/profile/editor/photo-crop');
  const photoFieldPath = path.join(root, SRC.profile, 'editor/photo-field.tsx');
  let content;

  beforeAll(() => {
    content = stripComments(fs.readFileSync(photoFieldPath, 'utf8'));
  });

  test('uploads the picked photo through stageProfilePhoto', () => {
    expect(content).toContain("import { stageProfilePhoto } from '../editor-actions'");
    expect(content).toContain('await stageProfilePhoto(fd)');
  });

  test('has file input for images', () => {
    expect(content).toContain('type="file"');
    expect(content).toContain('accept={PHOTO_ACCEPT}');
  });

  test('shows image preview', () => {
    expect(content).toContain('URL.createObjectURL(file)');
    expect(content).toContain('<canvas ref={previewCanvasRef}');
  });

  test('validates file type client-side', () => {
    expect(content).toContain('const typeOrSize = preCheckPhotoFile(file);');
    expect(content).toContain('setLocalError(typeOrSize);');
    // KAN-496: the picker's own message names what to do. Old expected value:
    //   expect(preCheckPhotoFile({ type: 'image/gif', size: 1024 })).toBe(PHOTO_TYPE_ERROR);
    // (PHOTO_TYPE_ERROR is still the server's message, pinned below.)
    expect(preCheckPhotoFile({ type: 'image/gif', size: 1024 })).toBe(
      "This file isn't a JPG, PNG or WebP photo. Please choose a photo in one of those formats.",
    );
    expect(PHOTO_TYPE_ERROR).toBe('Photos must be JPG, PNG or WebP.');
  });

  test('validates file size client-side', () => {
    expect(preCheckPhotoFile({ type: 'image/jpeg', size: 5 * 1024 * 1024 })).toBeNull();
    // KAN-496: phone photos over 5 MB are shrunk in the browser; the server
    // still refuses an upload over 5 MB. Old expected value:
    //   expect(preCheckPhotoFile({ type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 })).toBe(PHOTO_SIZE_ERROR);
    expect(preCheckPhotoFile({ type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 })).toBeNull();
    expect(preCheckPhotoFile({ type: 'image/jpeg', size: 25 * 1024 * 1024 + 1 })).toBe(
      'This photo is larger than 25 MB. Please choose a smaller one.',
    );
    expect(PHOTO_SIZE_ERROR).toBe('Photos must be 5 MB or smaller.');
  });
});

describe('KAN-135: Public profile shows avatar', () => {
  // KAN-488: the public page's read moved into the public-profile loader and
  // its header into the section renderer. Was: one file, SRC.slugPage.
  let loader;
  let sections;

  beforeAll(() => {
    loader = fs.readFileSync(path.join(root, SRC.loadPublicProfile), 'utf8');
    sections = fs.readFileSync(path.join(root, SRC.publicProfileSections), 'utf8');
  });

  // The photo reaches the renderer through the v0.8 view model; the rendered
  // photo is asserted in kan488-public-profile-page.test.tsx.
  test('ProfileData interface includes avatar_url', () => {
    // Was: expect(content).toContain('avatar_url: string | null');
    expect(loader).toContain('avatar_url: row.avatar_url');
  });

  test('profile header conditionally shows avatar image', () => {
    // Was: expect(content).toContain('typedProfile.avatar_url');
    //      expect(content).toContain('object-cover');
    expect(sections).toContain('section.photoUrl ?');
    expect(sections).toContain('object-cover');
  });
});

describe('KAN-135: Search page shows avatar in cards', () => {
  const searchPath = path.join(root, SRC.searchPage);
  let content;

  beforeAll(() => {
    content = fs.readFileSync(searchPath, 'utf8');
  });

  test('SearchProfile includes avatar_url', () => {
    expect(content).toContain('avatar_url: string | null');
  });

  test('search query selects avatar_url', () => {
    expect(content).toContain('avatar_url');
    expect(content).toContain('.select(');
  });

  test('ProfileCard conditionally shows avatar image', () => {
    expect(content).toContain('profile.avatar_url');
    expect(content).toContain('object-cover');
  });
});

describe('KAN-135: Migration file exists', () => {
  test('migration SQL file is present', () => {
    const migrationPath = path.join(root, SRC.migrations20260330120000AddAvatarUrlAndStorage);
    expect(fs.existsSync(migrationPath)).toBe(true);
    const content = fs.readFileSync(migrationPath, 'utf8');
    expect(content).toContain('avatar_url');
    expect(content).toContain('profile-photos');
    expect(content).toContain('storage.objects');
  });
});
