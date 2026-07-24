/**
 * KAN-276 — transactional email sender (allowlist-free Resend wrapper).
 *
 *   - no RESEND_API_KEY → { ok:false, code:'no_api_key' }, no fetch made.
 *   - happy path → POSTs to Resend with bearer auth + the right body, returns id.
 *   - non-2xx → { ok:false, code:'send_failed' }.
 *   - fetch throwing → swallowed into { ok:false, code:'send_failed' } (no throw).
 */

import { sendTransactionalEmail } from '@/lib/email/transactional';

const ORIGINAL_KEY = process.env.RESEND_API_KEY;
const realFetch = global.fetch;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_KEY;
  global.fetch = realFetch;
  jest.clearAllMocks();
});

const INPUT = {
  to: 'x@example.com',
  subject: 'Hi',
  html: '<p>Hi</p>',
  text: 'Hi',
};

describe('KAN-276 sendTransactionalEmail', () => {
  test('returns no_api_key and makes no request when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await sendTransactionalEmail(INPUT);
    expect(res).toEqual({ ok: false, code: 'no_api_key', detail: 'RESEND_API_KEY not set' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('posts to Resend with bearer auth and returns the message id', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'resend-123' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await sendTransactionalEmail(INPUT);
    expect(res).toEqual({ ok: true, messageId: 'resend-123' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(['x@example.com']);
    expect(body.subject).toBe('Hi');
  });

  test('returns send_failed on a non-2xx response', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => 'bad domain',
    }) as unknown as typeof fetch;

    const res = await sendTransactionalEmail(INPUT);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('send_failed');
  });

  test('swallows a thrown fetch into send_failed (never throws)', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const res = await sendTransactionalEmail(INPUT);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('send_failed');
      expect(res.detail).toContain('network down');
    }
  });
});
