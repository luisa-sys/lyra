/**
 * KAN-489 — the Anthropic client wrapper (src/modules/profile/ai-gifts/client.ts).
 *
 * `@anthropic-ai/sdk` is mocked: the constructor and `beta.messages.create`
 * are spies, and the error classes are the SDK's REAL classes (so the
 * subclass relationships the wrapper relies on — e.g. OverloadedError extends
 * InternalServerError — are the real ones). The real API is never called.
 *
 * Expected values are literals from the claude-api skill / KAN-489 plan
 * (model id, beta header, effort, schema), never read back from client.ts
 * (CLAUDE.md failure mode 10).
 */

const mockCreate = jest.fn();
const mockCtor = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  const actual = jest.requireActual('@anthropic-ai/sdk');
  class MockAnthropic {
    beta = { messages: { create: (...args: unknown[]) => mockCreate(...args) } };
    constructor(opts: unknown) {
      mockCtor(opts);
    }
  }
  for (const name of [
    'APIError',
    'APIConnectionError',
    'APIConnectionTimeoutError',
    'AuthenticationError',
    'PermissionDeniedError',
    'RateLimitError',
    'InternalServerError',
    'OverloadedError',
    'BadRequestError',
    'NotFoundError',
  ]) {
    (MockAnthropic as unknown as Record<string, unknown>)[name] = actual[name];
  }
  return { __esModule: true, default: MockAnthropic };
});

import * as SDK from '@anthropic-ai/sdk';
import { createGiftModel, finalText } from '@/modules/profile/ai-gifts/client';

const actualSdk = jest.requireActual('@anthropic-ai/sdk') as typeof SDK;
const KEY = 'sk-ant-test-KAN489-SECRET-VALUE';
const PROMPT = { system: 'SYSTEM-PROMPT', userContent: '<recipient_profile>x</recipient_profile>' };

function headers(): Headers {
  return new Headers({ 'request-id': 'req_kan489' });
}

function message(over: Record<string, unknown>) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    stop_details: null,
    content: [],
    usage: { input_tokens: 1, output_tokens: 1 },
    ...over,
  };
}

beforeEach(() => {
  mockCreate.mockReset();
  mockCtor.mockReset();
});

describe('createGiftModel — client construction', () => {
  it('passes the key explicitly, with a 30 s timeout and one retry', () => {
    createGiftModel(KEY, () => {});
    expect(mockCtor).toHaveBeenCalledTimes(1);
    expect(mockCtor.mock.calls[0][0]).toEqual({ apiKey: KEY, timeout: 30000, maxRetries: 1 });
  });
});

describe('createGiftModel — request shape', () => {
  it('sends exactly the skill-mandated request (model, effort, fallbacks, json schema, no thinking)', async () => {
    mockCreate.mockResolvedValue(message({ content: [{ type: 'text', text: '{"suggestions":[]}' }] }));
    await createGiftModel(KEY, () => {}).suggest(PROMPT);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const body = mockCreate.mock.calls[0][0];
    expect(body).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              suggestions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { title: { type: 'string' }, description: { type: 'string' } },
                  required: ['title', 'description'],
                  additionalProperties: false,
                },
              },
            },
            required: ['suggestions'],
            additionalProperties: false,
          },
        },
      },
      system: 'SYSTEM-PROMPT',
      messages: [{ role: 'user', content: '<recipient_profile>x</recipient_profile>' }],
    });
    expect(Object.keys(body)).not.toContain('thinking');
  });
});

describe('createGiftModel — stop_reason is checked before content', () => {
  it('refusal → refused, even when the content holds valid JSON', async () => {
    mockCreate.mockResolvedValue(
      message({
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'general_harms', explanation: null },
        content: [{ type: 'text', text: '{"suggestions":[{"title":"Leaked","description":"x"}]}' }],
      }),
    );
    expect(await createGiftModel(KEY, () => {}).suggest(PROMPT)).toEqual({ ok: false, reason: 'refused' });
  });

  it('max_tokens → failed, even when the content happens to parse', async () => {
    mockCreate.mockResolvedValue(
      message({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"suggestions":[]}' }] }),
    );
    expect(await createGiftModel(KEY, () => {}).suggest(PROMPT)).toEqual({ ok: false, reason: 'failed' });
  });

  it('end_turn with JSON text → ok with the parsed JSON', async () => {
    mockCreate.mockResolvedValue(
      message({ content: [{ type: 'text', text: '{"suggestions":[{"title":"Kite","description":"Fly it"}]}' }] }),
    );
    expect(await createGiftModel(KEY, () => {}).suggest(PROMPT)).toEqual({
      ok: true,
      json: { suggestions: [{ title: 'Kite', description: 'Fly it' }] },
    });
  });

  it('non-JSON text → failed', async () => {
    mockCreate.mockResolvedValue(message({ content: [{ type: 'text', text: 'Here are some ideas!' }] }));
    expect(await createGiftModel(KEY, () => {}).suggest(PROMPT)).toEqual({ ok: false, reason: 'failed' });
  });

  it('reads only the text AFTER the last fallback block', async () => {
    mockCreate.mockResolvedValue(
      message({
        content: [
          { type: 'text', text: '{"suggestions":[{"title":"Partial' },
          {
            type: 'fallback',
            from: { model: 'claude-opus-5-5' },
            to: { model: 'claude-opus-5' },
            trigger: { type: 'refusal', category: null },
          },
          { type: 'text', text: '{"suggestions":[{"title":"Rescued","description":"d"}]}' },
        ],
      }),
    );
    expect(await createGiftModel(KEY, () => {}).suggest(PROMPT)).toEqual({
      ok: true,
      json: { suggestions: [{ title: 'Rescued', description: 'd' }] },
    });
  });
});

describe('finalText', () => {
  it('joins text blocks after the last fallback and skips thinking blocks', () => {
    expect(
      finalText([
        { type: 'text', text: 'A' },
        { type: 'fallback' },
        { type: 'thinking' },
        { type: 'text', text: 'B' },
        { type: 'fallback' },
        { type: 'text', text: 'C' },
        { type: 'text', text: 'D' },
      ]),
    ).toBe('CD');
  });

  it('with no fallback block, all text blocks count', () => {
    expect(finalText([{ type: 'text', text: 'x' }, { type: 'text', text: 'y' }])).toBe('xy');
  });
});

describe('createGiftModel — typed SDK errors', () => {
  const cases: ReadonlyArray<readonly [string, () => Error, string]> = [
    ['AuthenticationError', () => new actualSdk.AuthenticationError(401, undefined, `bad key ${KEY}`, headers()), 'not_configured'],
    ['PermissionDeniedError', () => new actualSdk.PermissionDeniedError(403, undefined, 'denied', headers()), 'not_configured'],
    ['RateLimitError', () => new actualSdk.RateLimitError(429, undefined, 'slow down', headers()), 'busy'],
    ['InternalServerError', () => new actualSdk.InternalServerError(500, undefined, 'boom', headers()), 'busy'],
    ['OverloadedError', () => new actualSdk.OverloadedError(529, undefined, 'overloaded', headers()), 'busy'],
    ['APIConnectionError', () => new actualSdk.APIConnectionError({ message: 'offline' }), 'busy'],
    ['APIConnectionTimeoutError', () => new actualSdk.APIConnectionTimeoutError({ message: 'timeout' }), 'busy'],
    ['BadRequestError', () => new actualSdk.BadRequestError(400, undefined, 'bad', headers()), 'failed'],
    ['NotFoundError', () => new actualSdk.NotFoundError(404, undefined, 'nope', headers()), 'failed'],
    ['plain Error', () => new Error('weird'), 'failed'],
  ];

  it('covers ten error kinds (corpus guard)', () => {
    expect(cases.length).toBe(10);
  });

  it.each(cases)('%s → %s', async (_name, make, reason) => {
    mockCreate.mockRejectedValue(make());
    expect(await createGiftModel(KEY, () => {}).suggest(PROMPT)).toEqual({ ok: false, reason });
  });

  it('logs class, status and request id only — never the key, the message or the prompt', async () => {
    const log = jest.fn();
    mockCreate.mockRejectedValue(new actualSdk.AuthenticationError(401, undefined, `invalid x-api-key ${KEY}`, headers()));
    await createGiftModel(KEY, log).suggest(PROMPT);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][1]).toEqual({
      errorClass: 'AuthenticationError',
      status: 401,
      requestId: 'req_kan489',
      outcome: 'not_configured',
    });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain('SYSTEM-PROMPT');
    expect(logged).not.toContain('recipient_profile');
  });
});
