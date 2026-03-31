/**
 * Real auth action tests with mocked Supabase
 * KAN-111: Replace file-existence checks with functional tests
 */

// Mock next/navigation
const mockRedirect = jest.fn();
jest.mock('next/navigation', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  redirect: (...args: unknown[]) => { mockRedirect(...args); throw new Error('REDIRECT'); },
}));

// Mock next/headers
jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue('https://dev.checklyra.com'),
  }),
}));

// Mock @/lib/env
jest.mock('@/lib/env', () => ({
  env: { siteUrl: () => 'https://dev.checklyra.com' },
}));

// Mock Supabase client
const mockSignUp = jest.fn();
const mockSignInWithPassword = jest.fn();
const mockSignOut = jest.fn();
const mockSignInWithOAuth = jest.fn();

jest.mock('@/lib/supabase-server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      signUp: (...args: unknown[]) => mockSignUp(...args),
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
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
});

describe('KAN-111: signUp action', () => {
  test('redirects with error when fields are missing', async () => {
    const fd = makeFormData({ email: 'test@example.com', password: '123456' });
    // full_name is missing
    await expect(signUp(fd)).rejects.toThrow('REDIRECT');
    expect(mockRedirect).toHaveBeenCalledWith(
      expect.stringContaining('/signup?error=')
    );
    expect(mockRedirect.mock.calls[0][0]).toContain('All%20fields%20are%20required');
  });

  test('redirects with error when password too short', async () => {
    const fd = makeFormData({ email: 'test@example.com', password: '123', full_name: 'Test' });
    await expect(signUp(fd)).rejects.toThrow('REDIRECT');
    expect(mockRedirect.mock.calls[0][0]).toContain('Password%20must%20be%20at%20least%206');
  });

  test('calls supabase signUp with correct params on valid input', async () => {
    mockSignUp.mockResolvedValue({ error: null });
    const fd = makeFormData({ email: 'test@example.com', password: 'secure123', full_name: 'Test User' });
    await expect(signUp(fd)).rejects.toThrow('REDIRECT');
    expect(mockSignUp).toHaveBeenCalledWith(expect.objectContaining({
      email: 'test@example.com',
      password: 'secure123',
    }));
    expect(mockRedirect.mock.calls[0][0]).toContain('/signup?message=');
  });

  test('redirects with supabase error on failure', async () => {
    mockSignUp.mockResolvedValue({ error: { message: 'User already exists' } });
    const fd = makeFormData({ email: 'test@example.com', password: 'secure123', full_name: 'Test' });
    await expect(signUp(fd)).rejects.toThrow('REDIRECT');
    expect(mockRedirect.mock.calls[0][0]).toContain('User%20already%20exists');
  });
});

describe('KAN-111: signIn action', () => {
  test('redirects with error when fields are missing', async () => {
    const fd = makeFormData({ email: 'test@example.com' });
    await expect(signIn(fd)).rejects.toThrow('REDIRECT');
    expect(mockRedirect.mock.calls[0][0]).toContain('Email%20and%20password%20are%20required');
  });

  test('calls supabase signInWithPassword on valid input', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });
    const fd = makeFormData({ email: 'test@example.com', password: 'secure123' });
    await expect(signIn(fd)).rejects.toThrow('REDIRECT');
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'secure123',
    });
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
  });

  test('redirects with error on invalid credentials', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const fd = makeFormData({ email: 'test@example.com', password: 'wrong' });
    await expect(signIn(fd)).rejects.toThrow('REDIRECT');
    expect(mockRedirect.mock.calls[0][0]).toContain('Invalid%20login%20credentials');
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
