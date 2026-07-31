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

  test('validates MIME type server-side', () => {
    expect(content).toContain('ALLOWED_IMAGE_TYPES');
    expect(content).toContain('image/jpeg');
    expect(content).toContain('image/png');
    expect(content).toContain('image/webp');
    expect(content).toContain('image/gif');
  });

  test('validates file size (5MB max)', () => {
    expect(content).toContain('MAX_FILE_SIZE');
    expect(content).toContain('5 * 1024 * 1024');
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

describe('KAN-135: Identity step has photo upload UI', () => {
  const identityPath = path.join(root, SRC.identityStep);
  let content;

  beforeAll(() => {
    content = fs.readFileSync(identityPath, 'utf8');
  });

  test('accepts onUploadAvatar prop', () => {
    expect(content).toContain('onUploadAvatar');
  });

  test('has file input for images', () => {
    expect(content).toContain('type="file"');
    expect(content).toContain('accept="image/jpeg,image/png,image/webp,image/gif"');
  });

  test('shows image preview', () => {
    expect(content).toContain('preview');
    expect(content).toContain('readAsDataURL');
  });

  test('validates file type client-side', () => {
    expect(content).toContain('image/jpeg');
    expect(content).toContain('Please choose a JPEG');
  });

  test('validates file size client-side', () => {
    expect(content).toContain('5 * 1024 * 1024');
    expect(content).toContain('under 5MB');
  });
});

describe('KAN-135: Public profile shows avatar', () => {
  const profilePath = path.join(root, SRC.slugPage);
  let content;

  beforeAll(() => {
    content = fs.readFileSync(profilePath, 'utf8');
  });

  test('ProfileData interface includes avatar_url', () => {
    expect(content).toContain('avatar_url: string | null');
  });

  test('profile header conditionally shows avatar image', () => {
    expect(content).toContain('typedProfile.avatar_url');
    expect(content).toContain('object-cover');
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
