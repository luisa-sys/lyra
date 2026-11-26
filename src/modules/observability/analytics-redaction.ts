/**
 * KAN-482 — DPIA §2a AD-6: the public search term must not reach analytics.
 *
 * `/search` is a GET form, so the term travels as `?q=…` in the page URL.
 * Vercel Analytics pageviews and Speed Insights vitals both send the page URL
 * (only after the visitor accepts analytics cookies — SEC-72). This is the
 * `beforeSend` both components use: on the search route it drops the whole
 * query string; every other URL passes through unchanged.
 *
 * Generic over the event shape so it fits both packages' `beforeSend` types
 * (`{ type, url }` for Analytics, `{ type, url, route? }` for Speed Insights).
 */

import { SEARCH_PATH_RE } from './sentry-scrub';

/** Remove the query string (and fragment) from a /search URL; leave others alone. */
export function redactSearchTermFromUrl(url: string): string {
  const cut = url.search(/[?#]/);
  if (cut === -1) return url;
  const path = url.slice(0, cut);
  return SEARCH_PATH_RE.test(path) ? path : url;
}

/** `beforeSend` for `<Analytics>` and `<SpeedInsights>`. Returns a new event. */
export function redactSearchTermFromAnalyticsEvent<E extends { url: string }>(event: E): E {
  return { ...event, url: redactSearchTermFromUrl(event.url) };
}
