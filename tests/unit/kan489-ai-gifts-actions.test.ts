/**
 * KAN-489 — the server actions (src/app/dashboard/profile/ai-gifts-actions.ts):
 * auth → rate limit → pipeline, and the "not configured" state never builds
 * an SDK client. The SDK and the pipeline are mocked; the env module is the
 * real one, driven through process.env (the key value is a test constant and
 * must never appear in a result).
 */

const mockCreateGiftModel = jest.fn();
const mockGenerate = jest.fn();
const mockDismiss = jest.fn();
const mockRateLimit = jest.fn();
const mockState: { userId: string | null } = { userId: 'u-1' };

jest.mock('@/modules/platform/supabase-server', () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: mockState.userId ? { id: mockState.userId } : null } }) },
    }),
}));
jest.mock('@/modules/guards/profile-rate-limit', () => ({
  checkProfileWriteRateLimit: (...a: unknown[]) => mockRateLimit(...a),
}));
jest.mock('@/modules/profile/ai-gifts/client', () => ({
  createGiftModel: (...a: unknown[]) => mockCreateGiftModel(...a),
}));
jest.mock('@/modules/profile/ai-gifts/generate', () => {
  const actual = jest.requireActual('@/modules/profile/ai-gifts/generate');
  return { ...actual, generateAiGiftSuggestions: (...a: unknown[]) => mockGenerate(...a) };
});
jest.mock('@/modules/profile/ai-gifts/store', () => ({
  dismissPendingSuggestion: (...a: unknown[]) => mockDismiss(...a),
}));

import { dismissAiGift, generateAiGifts } from '@/app/dashboard/profile/ai-gifts-actions';

const KEY = 'sk-ant-test-actions-SECRET';
const SESSION = '3f2b8c1e-9d4a-4b6e-8f10-2a3b4c5d6e7f';
const ROW = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const CONSENT = 'v1-2026-11-23';
const savedKey = process.env.ANTHROPIC_API_KEY;
const savedSwitch = process.env.LYRA_AI_GIFTS_ENABLED;

beforeEach(() => {
  mockState.userId = 'u-1';
  mockCreateGiftModel.mockReset().mockReturnValue({ suggest: jest.fn() });
  mockGenerate.mockReset().mockResolvedValue({ ok: false, reason: 'no_content' });
  mockDismiss.mockReset().mockResolvedValue({ ok: true });
  mockRateLimit.mockReset().mockResolvedValue({ allowed: true });
  process.env.ANTHROPIC_API_KEY = KEY;
  process.env.LYRA_AI_GIFTS_ENABLED = '1';
});

afterAll(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  if (savedSwitch === undefined) delete process.env.LYRA_AI_GIFTS_ENABLED;
  else process.env.LYRA_AI_GIFTS_ENABLED = savedSwitch;
});

describe('generateAiGifts', () => {
  it('signed out → unauthenticated; nothing else runs', async () => {
    mockState.userId = null;
    expect(await generateAiGifts(SESSION, CONSENT)).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('rate limited → rate_limited; the pipeline does not run', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, reason: 'user', retryAfter: 5, result: { success: false, error: 'x' } });
    expect(await generateAiGifts(SESSION, CONSENT)).toEqual({ ok: false, reason: 'rate_limited' });
    expect(mockRateLimit).toHaveBeenCalledWith('u-1');
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('configured → the model is built with the key and handed to the pipeline with the user and session', async () => {
    const model = { suggest: jest.fn() };
    mockCreateGiftModel.mockReturnValue(model);
    await generateAiGifts(SESSION, CONSENT);
    expect(mockCreateGiftModel).toHaveBeenCalledWith(KEY);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate.mock.calls[0][0].model).toBe(model);
    expect(mockGenerate.mock.calls[0][1]).toEqual({ userId: 'u-1', sessionId: SESSION, consentVersion: CONSENT });
  });

  it.each([['absent', undefined], ['empty', ''], ['whitespace', '   ']])(
    'key %s → no SDK client is built; the pipeline gets model null',
    async (_label, value) => {
      if (value === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = value;
      await generateAiGifts(SESSION, CONSENT);
      expect(mockCreateGiftModel).not.toHaveBeenCalled();
      expect(mockGenerate.mock.calls[0][0].model).toBeNull();
    },
  );

  it.each([['absent', undefined], ['empty', ''], ['0', '0'], ['true', 'true'], [' 1 padded', ' 1 ']])(
    'review fix — key set but LYRA_AI_GIFTS_ENABLED %s: only exactly "1" (trimmed) builds a client',
    async (label, value) => {
      if (value === undefined) delete process.env.LYRA_AI_GIFTS_ENABLED;
      else process.env.LYRA_AI_GIFTS_ENABLED = value;
      await generateAiGifts(SESSION, CONSENT);
      if (label === ' 1 padded') {
        expect(mockCreateGiftModel).toHaveBeenCalledWith(KEY);
      } else {
        expect(mockCreateGiftModel).not.toHaveBeenCalled();
        expect(mockGenerate.mock.calls[0][0].model).toBeNull();
      }
    },
  );

  it('returns the pipeline result unchanged, and a throw becomes failed', async () => {
    mockGenerate.mockResolvedValueOnce({ ok: false, reason: 'cap_full' });
    expect(await generateAiGifts(SESSION, CONSENT)).toEqual({ ok: false, reason: 'cap_full' });
    mockGenerate.mockRejectedValueOnce(new Error(`boom ${KEY}`));
    const r = await generateAiGifts(SESSION, CONSENT);
    expect(r).toEqual({ ok: false, reason: 'failed' });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
});

describe('dismissAiGift', () => {
  it('signed out → unauthenticated', async () => {
    mockState.userId = null;
    expect(await dismissAiGift(ROW)).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('rate limited → rate_limited', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, reason: 'ip', retryAfter: 5, result: { success: false, error: 'x' } });
    expect(await dismissAiGift(ROW)).toEqual({ ok: false, reason: 'rate_limited' });
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('a non-UUID id → not_found without a database call', async () => {
    expect(await dismissAiGift('not-a-uuid')).toEqual({ ok: false, reason: 'not_found' });
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('deletes through the store and returns its result', async () => {
    mockDismiss.mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    expect(await dismissAiGift(ROW)).toEqual({ ok: false, reason: 'not_found' });
    expect(mockDismiss.mock.calls[0][1]).toBe(ROW);
  });
});
