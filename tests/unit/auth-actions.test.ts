/**
 * Real auth action tests with mocked Supabase.
 * KAN-111: functional tests · KAN-258: passwordless (magic-link) sign-in + invite gate
 */

// Mock next/navigation
const mockRedirect = jest.fn();
jest.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => { mockRedirect(...args); throw new Error('REDIRECT'); },
}));

// Mock next/headers
jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue('https://dev.checklyra.com'),
  }),
}));

// Mock @/lib/env — `mockInviteCode` is mutated per-test to toggle the
// KAN-258 invite-only gate (empty string = gate off).
let mockInviteCode = '';
jest.mock('@/lib/env', () => ({
  env: {
    siteUrl: () => 'https://dev.checklyra.com',
    inviteCode: () => mockInviteCode,
  },
}));

// Mock Supabase client — passwordless flow uses signInWithOtp.
const mockSignInWithOtp = jest.fn();
const mockSignOut = jest.fn();
const mockSignInWithOAuth = jest.fn();

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      signInWithOtp: (...args: unknown[]) => mockSignInWithOtp(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args),
    },
  }),
}));

// Import the actual server actions
import { signUp, signIn, signOut, signInWithGoogle } from '@/app/(auth)/actions';

function makeFormData(data: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInviteCode = '';
});

describe('KAN-258: signUp action (passwordless)', () => {
  test('redirects with error when name or email is missing', async () => {
    const fd = makeFormData({ email: 'test@example.com' }); // full_name missing
    await expect(signUp(fd)).rejects.toThrow('REDIRECT');
    expect(mockRedirect.mock.calls[0][0]).toContain('/signup?error=');
    expect(mockRedirect.mock.calls[0][0]).toContain('name%20and%20email');
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  test('emails a magic link (shouldCreateUser:true) with full_name metadata on valid input', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    const fd = makeFormData({ email: 'test@example.com', full_name: 'Test User' });
    await expect(signUp(fd)).rejects.toThrow('REDIRECT');
    expect(mockSignInWithOtp).toHaveBeenCalledWith(expect.objectContaining({
      email: 'test@example.com',
      options: expect.objectContaining({
        shouldCreateUser: true,
        data: { full_name: 'Test User' },
      }),
    }));
    expect(mockRedirect.mock.calls[0][0]).toContain('/signup?message=');
  });

  test('redirects with supabase error on failure', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { message: 'Signups not allowed' } });
    const fd = makeFormData({ email: 'test@example.com', full_name: 'Test' });
    await expect(signUp(fd)).rejects.toThrow('REDIRECT');
    expect(mockRedirect.mock.calls[0][0]).toContain('Signups%20not%20allowed');
  });
});

describe('KAN-258: invite-only signup gate', () => {
  test('with no invite code configured, signup is NOT gated (back-compat)', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    const fd = makeFormData({ email: 'a@b.com', full_name: 'A' });
    await expect(signUp(fd)).rejects.toThrow('REDIRECT');
    expect(mockSignInWithOtp).toHaveBeenCalled();
  });

  test('rejects signup when an invite code is required but missing', async () => {
    mockInviteCode = 'LET-ME-IN';
    const fd = makeFormData({ email: 'a@b.com', full_name: 'A' });
    await expect(signUp(fd)).rejects.toThrow('REDIRECT');
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
    expect(mockRedirect.mock.calls[0][0]).toContain('/signup?error=');
    expect(mockRedirect.mock.calls[0][0]).toContain('invite-only');
  });

  test('rejects signup when the invite code is wrong', async () => {
    mockInviteCode = 'LET-ME-IN';
    const fd = makeFormData({ email: 'a@b.com', full_name: 'A', invite_code: 'nope' });
    await expect(signUp(fd)).rejects.toThrow('REDIRECT');
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  test('allows signup when the invite code matches', async () => {
    mockInviteCode = 'LET-ME-IN';
    mockSignInWithOtp.mockResolvedValue({ error: null });
    const fd = makeFormData({ email: 'a@b.com', full_name: 'A', invite_code: 'LET-ME-IN' });
    await expect(signUp(fd)).rejects.toThrow('REDIRECT');
    expect(mockSignInWithOtp).toHaveBeenCalled();
    expect(mockRedirect.mock.calls[0][0]).toContain('/signup?message=');
  });

  test('trims surrounding whitespace from the invite code', async () => {
    mockInviteCode = 'LET-ME-IN';
    mockSignInWithOtp.mockResolvedValue({ error: null });
    const fd = makeFormData({ email: 'a@b.com', full_name: 'A', invite_code: '  LET-ME-IN  ' });
    await expect(signUp(fd)).rejects.toThrow('REDIRECT');
    expect(mockSignInWithOtp).toHaveBeenCalled();
  });
});

describe('KAN-258: signIn action (passwordless)', () => {
  test('redirects with error when email is missing', async () => {
    const fd = makeFormData({});
    await expect(signIn(fd)).rejects.toThrow('REDIRECT');
    expect(mockRedirect.mock.calls[0][0]).toContain('Email%20is%20required');
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  test('emails a sign-in link (shouldCreateUser:false) on valid input', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    const fd = makeFormData({ email: 'test@example.com' });
    await expect(signIn(fd)).rejects.toThrow('REDIRECT');
    expect(mockSignInWithOtp).toHaveBeenCalledWith(expect.objectContaining({
      email: 'test@example.com',
      options: expect.objectContaining({ shouldCreateUser: false }),
    }));
    expect(mockRedirect.mock.calls[0][0]).toContain('/login?message=');
  });

  test('redirects with error on failure', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { message: 'Email rate limit exceeded' } });
    const fd = makeFormData({ email: 'test@example.com' });
    await expect(signIn(fd)).rejects.toThrow('REDIRECT');
    expect(mockRedirect.mock.calls[0][0]).toContain('rate%20limit');
  });
});

describe('KAN-111: signOut action', () => {
  test('calls supabase signOut and redirects to home', async () => {
    mockSignOut.mockResolvedValue({ error: null });
    await expect(signOut()).rejects.toThrow('REDIRECT');
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith('/');
  });
});

describe('KAN-111: signInWithGoogle action', () => {
  test('calls supabase OAuth with google provider', async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: { url: 'https://accounts.google.com/...' }, error: null });
    await expect(signInWithGoogle()).rejects.toThrow('REDIRECT');
    expect(mockSignInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'google',
    }));
  });

  test('redirects to Google OAuth URL on success', async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: { url: 'https://accounts.google.com/auth' }, error: null });
    await expect(signInWithGoogle()).rejects.toThrow('REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith('https://accounts.google.com/auth');
  });

  test('redirects with error on OAuth failure', async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: {}, error: { message: 'OAuth error' } });
    await expect(signInWithGoogle()).rejects.toThrow('REDIRECT');
    expect(mockRedirect.mock.calls[0][0]).toContain('OAuth%20error');
  });
});
