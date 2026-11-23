/**
 * SEC-55: OAuth-secret & PII scrubbing for Sentry events + breadcrumbs.
 *
 * `sendDefaultPii:false` stops Sentry attaching cookies/IP by default, but it
 * does NOT strip application-level secrets that end up in request URLs, query
 * strings, bodies or breadcrumb URLs — PKCE verifiers, single-use auth codes,
 * `state`, refresh/access tokens and client secrets. The MCP OAuth design
 * (docs/MCP_OAUTH_DESIGN.md) mandates a `beforeSend` scrubbing layer; this
 * module is that layer, shared by all three web Sentry inits (server + edge in
 * `instrumentation.ts`, browser in `instrumentation-client.ts`). An identical
 * copy lives in `lyra-mcp-server/src/sentry-scrub.ts` for the MCP server.
 *
 * The functions mutate the event/breadcrumb in place (the Sentry-idiomatic
 * pattern) and also return it, so a call site can write
 * `beforeSend: (event) => scrubSentryEvent(event)`.
 *
 * Design notes:
 * - Sensitive KEYS are deleted outright (not masked) so "the key is removed
 *   from the captured event" is literally true — see SEC-55 acceptance.
 * - `/oauth/*` and `/api/convene/oauth/*` URLs have their ENTIRE query string
 *   redacted, because the auth code / state / token live there and enumerating
 *   every possible param name is fragile.
 * - With `WEB_SCRUB_OPTIONS` (every lyra web init), `/search` URLs — the
 *   public "Find someone" page — also have their ENTIRE query string
 *   redacted (KAN-482, DPIA §2a AD-6): `?q=` is free text that routinely
 *   names a third party or a school. It is an option, not a default, so the
 *   SEC-55 defaults stay identical to the MCP server's copy (no /search).
 * - All other URLs only drop the enumerated sensitive params, preserving
 *   benign query context (pagination, etc.) for debugging.
 * - Navigation breadcrumbs carry URLs in `data.from` / `data.to`, and
 *   performance spans in `data.url` / `http.url` / `url.full` /
 *   `http.target` (+ a bare `url.query` / `http.query`), so those are scrubbed
 *   too; `scrubSentryTransaction` covers transaction events, which do not go
 *   through `beforeSend`.
 */

/** Parameter / body-field / header names whose values must never reach Sentry. */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'code',
  'code_verifier',
  'state',
  'refresh_token',
  'access_token',
  'client_secret',
  'token',
]);

/** Header names that carry credentials wholesale and are dropped entirely. */
const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
]);

/** Paths whose query string is redacted in full (auth code / state / token live here). */
const OAUTH_PATH_RE = /\/(?:oauth|api\/convene\/oauth)(?:\/|$|\?)/i;

/**
 * Per-app additions to the always-on rules. The defaults (no options) are the
 * SEC-55 behaviour shared with the MCP server's copy of this module.
 */
export interface ScrubOptions {
  /** Extra paths whose ENTIRE query string is redacted, like `/oauth/*`. */
  readonly fullyRedactedPaths?: readonly RegExp[];
}

/** KAN-482: the public search page; its `?q=` is free text naming people / schools. */
export const SEARCH_PATH_RE = /\/search\/?$/i;

/**
 * The options every web (lyra) Sentry init passes — server, edge and browser.
 * KAN-482 / DPIA §2a AD-6: `/search?q=` must never reach Sentry.
 */
export const WEB_SCRUB_OPTIONS: ScrubOptions = { fullyRedactedPaths: [SEARCH_PATH_RE] };

/** True when a URL / path's query string must be redacted in full. */
function isFullyRedactedPath(path: string, opts: ScrubOptions): boolean {
  if (OAUTH_PATH_RE.test(path)) return true;
  return (opts.fullyRedactedPaths ?? []).some((re) => re.test(path));
}

/** Path part of a URL or path string (before `?` / `#`). */
function pathOf(url: string): string {
  return url.split(/[?#]/, 1)[0];
}

const FILTERED = '[Filtered]';
const MAX_DEPTH = 8;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Delete enumerated sensitive keys anywhere in a nested plain-object/array tree. */
function scrubObjectInPlace(obj: Record<string, unknown>, depth: number): void {
  if (depth > MAX_DEPTH) return;
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      delete obj[key];
      continue;
    }
    const val = obj[key];
    if (Array.isArray(val)) {
      for (const el of val) {
        if (isPlainObject(el)) scrubObjectInPlace(el, depth + 1);
      }
    } else if (isPlainObject(val)) {
      scrubObjectInPlace(val, depth + 1);
    }
  }
}

/** Strip sensitive params from a raw `a=b&c=d` query string. */
function scrubQueryStringValue(qs: string): string {
  const params = new URLSearchParams(qs);
  let mutated = false;
  for (const key of [...params.keys()]) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      params.delete(key);
      mutated = true;
    }
  }
  return mutated ? params.toString() : qs;
}

/**
 * Redact a URL string. OAuth paths lose their whole query; every other URL
 * only loses the enumerated sensitive params. Fragment/host/path are kept.
 */
export function scrubUrl(url: string, opts: ScrubOptions = {}): string {
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return url;
  const path = url.slice(0, qIdx);
  const query = url.slice(qIdx + 1);

  if (isFullyRedactedPath(path, opts)) {
    return `${path}?${FILTERED}`;
  }

  const params = new URLSearchParams(query);
  let mutated = false;
  for (const key of [...params.keys()]) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      params.delete(key);
      mutated = true;
    }
  }
  if (!mutated) return url;
  const rebuilt = params.toString();
  return rebuilt ? `${path}?${rebuilt}` : path;
}

function scrubHeaders(headers: Record<string, unknown>): void {
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_HEADERS.has(lower) || SENSITIVE_KEYS.has(lower)) {
      delete headers[key];
    }
  }
}

/** Scrub a JSON-encoded request body; non-JSON strings are returned unchanged. */
function scrubJsonString(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (isPlainObject(parsed)) {
      scrubObjectInPlace(parsed, 0);
      return JSON.stringify(parsed);
    }
    if (Array.isArray(parsed)) {
      for (const el of parsed) if (isPlainObject(el)) scrubObjectInPlace(el, 0);
      return JSON.stringify(parsed);
    }
  } catch {
    // Not JSON — leave untouched (form bodies are handled as objects upstream).
  }
  return body;
}

function scrubRequest(req: Record<string, unknown>, opts: ScrubOptions): void {
  const fullyRedacted = typeof req.url === 'string' && isFullyRedactedPath(pathOf(req.url), opts);
  if (typeof req.url === 'string') req.url = scrubUrl(req.url, opts);

  if (fullyRedacted && req.query_string !== undefined) {
    req.query_string = FILTERED;
  } else if (typeof req.query_string === 'string') {
    req.query_string = scrubQueryStringValue(req.query_string);
  } else if (isPlainObject(req.query_string)) {
    scrubObjectInPlace(req.query_string, 0);
  } else if (Array.isArray(req.query_string)) {
    req.query_string = req.query_string.filter(
      (pair) =>
        !(
          Array.isArray(pair) &&
          typeof pair[0] === 'string' &&
          SENSITIVE_KEYS.has(pair[0].toLowerCase())
        ),
    );
  }

  if (isPlainObject(req.data)) scrubObjectInPlace(req.data, 0);
  else if (typeof req.data === 'string') req.data = scrubJsonString(req.data);

  if (isPlainObject(req.headers)) scrubHeaders(req.headers);
  if (isPlainObject(req.cookies)) scrubObjectInPlace(req.cookies, 0);
}

/** Redact any URL-shaped tokens embedded in a breadcrumb message. */
function scrubMessageUrls(message: string, opts: ScrubOptions): string {
  return message
    .split(' ')
    .map((token) => (token.includes('?') ? scrubUrl(token, opts) : token))
    .join(' ');
}

/** URL-bearing keys in breadcrumb / span `data`. */
const URL_DATA_KEYS = ['url', 'from', 'to', 'http.url', 'url.full', 'http.target'] as const;
/** Bare query-string keys in span `data` (OpenTelemetry semantic conventions). */
const QUERY_DATA_KEYS = ['url.query', 'http.query'] as const;
/** Path-only keys that tell us which route a bare query belongs to. */
const PATH_DATA_KEYS = ['url.path', 'http.route', 'next.route'] as const;

/** Scrub URL-shaped values (and bare query strings) in a breadcrumb/span `data` bag. */
function scrubUrlDataInPlace(data: Record<string, unknown>, opts: ScrubOptions): void {
  let redactBareQuery = false;
  for (const key of [...URL_DATA_KEYS, ...PATH_DATA_KEYS]) {
    const v = data[key];
    if (typeof v === 'string' && isFullyRedactedPath(pathOf(v), opts)) redactBareQuery = true;
  }
  for (const key of URL_DATA_KEYS) {
    const v = data[key];
    if (typeof v === 'string') data[key] = scrubUrl(v, opts);
  }
  for (const key of QUERY_DATA_KEYS) {
    const v = data[key];
    if (typeof v !== 'string') continue;
    data[key] = redactBareQuery ? FILTERED : scrubQueryStringValue(v.replace(/^\?/, ''));
  }
}

function scrubBreadcrumbInPlace(bc: Record<string, unknown>, opts: ScrubOptions): void {
  if (typeof bc.message === 'string' && bc.message.includes('?')) {
    bc.message = scrubMessageUrls(bc.message, opts);
  }
  if (isPlainObject(bc.data)) {
    scrubUrlDataInPlace(bc.data, opts);
    scrubObjectInPlace(bc.data, 0);
  }
}

/**
 * `beforeSend` hook. Scrubs request URL/query/body/headers/cookies and any
 * breadcrumbs carried on the event. Mutates in place and returns the event.
 */
export function scrubSentryEvent<T>(event: T, opts: ScrubOptions = {}): T {
  if (!isPlainObject(event)) return event;

  if (isPlainObject(event.request)) scrubRequest(event.request, opts);

  const bc = event.breadcrumbs;
  if (Array.isArray(bc)) {
    for (const crumb of bc) if (isPlainObject(crumb)) scrubBreadcrumbInPlace(crumb, opts);
  } else if (isPlainObject(bc) && Array.isArray(bc.values)) {
    for (const crumb of bc.values) if (isPlainObject(crumb)) scrubBreadcrumbInPlace(crumb, opts);
  }

  return event;
}

/**
 * `beforeSendBreadcrumb` hook. Scrubs a single breadcrumb's message + data URL.
 * Mutates in place and returns the breadcrumb.
 */
export function scrubSentryBreadcrumb<T>(breadcrumb: T, opts: ScrubOptions = {}): T {
  if (isPlainObject(breadcrumb)) scrubBreadcrumbInPlace(breadcrumb, opts);
  return breadcrumb;
}

/**
 * `beforeSendTransaction` hook (KAN-482). Transaction events skip `beforeSend`,
 * yet carry the request URL and per-span URL attributes. Applies the event
 * scrub, then the URL scrub to the trace context and every span's `data`.
 * Mutates in place and returns the event.
 */
export function scrubSentryTransaction<T>(event: T, opts: ScrubOptions = {}): T {
  scrubSentryEvent(event, opts);
  if (!isPlainObject(event)) return event;
  const contexts = event.contexts;
  if (isPlainObject(contexts) && isPlainObject(contexts.trace) && isPlainObject(contexts.trace.data)) {
    scrubUrlDataInPlace(contexts.trace.data, opts);
  }
  if (Array.isArray(event.spans)) {
    for (const span of event.spans) {
      if (isPlainObject(span) && isPlainObject(span.data)) scrubUrlDataInPlace(span.data, opts);
      if (isPlainObject(span) && typeof span.description === 'string' && span.description.includes('?')) {
        span.description = scrubMessageUrls(span.description, opts);
      }
    }
  }
  return event;
}
