/**
 * KAN-489 — AI gift suggestions: the ONLY file that imports
 * `@anthropic-ai/sdk`.
 *
 * Request shape (claude-api skill, TypeScript README + model-migration
 * "New API features"):
 *   - model `claude-opus-5-5`; no `thinking` field (thinking is always on for
 *     this model and `{type: "disabled"}` is a 400), depth set with
 *     `output_config.effort: 'low'` — a simple, well-specified task;
 *   - `max_tokens: 8000`: thinking shares the output budget;
 *   - structured output via `output_config.format` (`json_schema`), validated
 *     again by parse.ts (no zod dependency);
 *   - server-side refusal fallbacks opted in by default: the `beta` namespace,
 *     `betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`.
 *
 * Response handling: `stop_reason` is checked BEFORE content is read —
 * `refusal` → refused (the whole fallback chain declined), `max_tokens` →
 * failed (truncated JSON is discarded, never parsed). Otherwise only the
 * text blocks AFTER the last `fallback` block are read (the declined model's
 * partial output before a switch point is discarded) and JSON-parsed.
 *
 * Errors use the SDK's typed classes, most specific first. The log line names
 * the error class, HTTP status and request id only — never the key, the
 * prompt or the member's text.
 *
 * The key is passed explicitly from env.anthropicApiKey() (CTL-037): the SDK's
 * no-argument constructor would read process.env on its own.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { GiftPrompt } from './prompt';

export const GIFT_MODEL = 'claude-opus-5-5';
export const GIFT_MAX_TOKENS = 8000;
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** The structured-output schema: `{ suggestions: [{ title, description }] }`. */
export const SUGGESTIONS_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['title', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
} as const;

export type ModelOutcome =
  | { ok: true; json: unknown }
  | { ok: false; reason: 'refused' | 'failed' | 'busy' | 'not_configured' };

export interface GiftModel {
  suggest(prompt: GiftPrompt): Promise<ModelOutcome>;
}

type Logger = (message: string, meta: Record<string, unknown>) => void;

const defaultLogger: Logger = (message, meta) => {
  console.warn(message, meta);
};

/** Status + request id + class name only: nothing that could carry a secret or member text. */
function errorMeta(err: unknown): Record<string, unknown> {
  if (err instanceof Anthropic.APIError) {
    return { errorClass: err.constructor.name, status: err.status ?? null, requestId: err.requestID ?? null };
  }
  return { errorClass: err instanceof Error ? err.constructor.name : typeof err };
}

/** Map an SDK error to the member-facing outcome. Most specific class first. */
export function classifyModelError(err: unknown): Extract<ModelOutcome, { ok: false }>['reason'] {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return 'not_configured';
  }
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) return 'busy';
  if (err instanceof Anthropic.APIConnectionError) return 'busy'; // includes APIConnectionTimeoutError
  return 'failed'; // BadRequestError, other APIError, anything unexpected
}

/** The text of the blocks after the last `fallback` switch point. */
export function finalText(content: ReadonlyArray<{ type: string; text?: unknown }>): string {
  let start = 0;
  content.forEach((b, i) => {
    if (b.type === 'fallback') start = i + 1;
  });
  return content
    .slice(start)
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
}

export function createGiftModel(apiKey: string, log: Logger = defaultLogger): GiftModel {
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  return {
    async suggest(prompt: GiftPrompt): Promise<ModelOutcome> {
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create({
          model: GIFT_MODEL,
          max_tokens: GIFT_MAX_TOKENS,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          output_config: {
            effort: 'low',
            format: { type: 'json_schema', schema: SUGGESTIONS_SCHEMA },
          },
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.userContent }],
        });
      } catch (err) {
        const reason = classifyModelError(err);
        log('[ai-gifts] model call failed', { ...errorMeta(err), outcome: reason });
        return { ok: false, reason };
      }

      // stop_reason FIRST: a refusal or a truncation is never parsed.
      if (response.stop_reason === 'refusal') {
        log('[ai-gifts] model refused', { category: response.stop_details?.category ?? null });
        return { ok: false, reason: 'refused' };
      }
      if (response.stop_reason === 'max_tokens') {
        log('[ai-gifts] model output truncated', {});
        return { ok: false, reason: 'failed' };
      }

      const text = finalText(response.content);
      try {
        return { ok: true, json: JSON.parse(text) };
      } catch {
        log('[ai-gifts] model output was not JSON', {});
        return { ok: false, reason: 'failed' };
      }
    },
  };
}
