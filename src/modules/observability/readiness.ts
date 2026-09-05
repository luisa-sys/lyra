/**
 * SEC-96 instance 3 — a readiness probe that is *able to say no*.
 *
 * WHY THIS EXISTS
 * ---------------
 * The public `/status` page renders its Website row from a literal:
 *
 *     { name: 'Website (checklyra.com)', ok: true, detail: 'Serving' }
 *
 * so `allOk` turns solely on the MCP `/health` fetch, and the banner reads
 * "All systems operational" for a site whose database is down — the site is
 * "up" by virtue of having served the status page that says so. That is the
 * false-positive shape the Workflow & Backup Integrity Policy forbids, and the
 * same family as SEC-79 (workflows reporting green while disabled) and BUGS-81.
 *
 * The existing `/api/health` route cannot stand in for this. It is a *config
 * echo* — it returns a hardcoded `ok: true` alongside three public env values
 * and touches no dependency at all, so it is green in exactly the outage this
 * probe needs to catch. Its response shape is pinned by an exact `toEqual` in
 * `tests/unit/health-endpoint.test.ts` and consumed by CI smoke checks, so it
 * is deliberately left alone rather than widened; readiness is a separate
 * question from liveness and gets a separate endpoint.
 *
 * WHAT "READY" MEANS HERE
 * -----------------------
 * One round trip to PostgREST. That is the dependency whose loss makes the
 * site non-functional while still serving static pages — sign-in, dashboard
 * and every profile read go through it. A `head` count is used so the request
 * returns *no rows*: this endpoint is public and unauthenticated, and it must
 * prove reachability without becoming a data surface. It runs on the anon key,
 * not the service role, so it can never read more than an anonymous visitor.
 *
 * WHY THE FAILURE DETAIL IS GENERIC
 * ---------------------------------
 * SEC-96 §4: a public probe must return ok/degraded only, with no internal
 * detail leak. A raw PostgREST/undici error can carry hostnames, ports, key
 * fragments and driver internals. So the real error is logged server-side and
 * the caller is handed a fixed string. `detail` is a stable enum-like token,
 * never interpolated from an exception.
 */

import { createClient } from '@supabase/supabase-js';
import { env } from '@/modules/platform/env';
import type { Database } from '@/types/database';

/** Fixed, non-leaking detail tokens. Never interpolate an exception into these. */
export const READY_DETAIL = {
  ok: 'Reachable',
  degraded: 'Database unreachable',
  timeout: 'Database timed out',
} as const;

export type ReadinessResult = {
  ok: boolean;
  /** One of READY_DETAIL — safe to render publicly. */
  detail: string;
};

/**
 * The probe, narrowed to the only thing readiness cares about: did a trivial
 * round trip to the database succeed? Injectable so tests can drive the
 * degraded and timeout branches without a live database — the real client is
 * built lazily inside the default so importing this module never requires
 * Supabase env vars to be present.
 */
export type DatabaseProbe = (signal: AbortSignal) => Promise<{ failed: boolean }>;

const DEFAULT_TIMEOUT_MS = 3000;

const defaultProbe: DatabaseProbe = async (signal) => {
  const supabase = createClient<Database>(env.supabaseUrl(), env.supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // `head: true` returns no rows — reachability only, never data. An RLS-empty
  // result is still a successful round trip and therefore still "ready".
  const { error } = await supabase
    .from('profiles')
    .select('id', { head: true, count: 'exact' })
    .abortSignal(signal);

  return { failed: Boolean(error) };
};

/**
 * Probes the database and reports readiness.
 *
 * Never throws: an unreachable dependency is a *result*, not an exception, or
 * the caller would 500 and the status page would lose the distinction between
 * "degraded" and "the probe itself broke".
 */
export async function checkReadiness(
  probe: DatabaseProbe = defaultProbe,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ReadinessResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { failed } = await probe(controller.signal);
    if (failed) {
      console.error('[readiness] database probe reported an error');
      return { ok: false, detail: READY_DETAIL.degraded };
    }
    return { ok: true, detail: READY_DETAIL.ok };
  } catch (e) {
    // Deliberately not surfaced to the caller — see the header note on leaks.
    console.error('[readiness] database probe threw', e);
    const timedOut = controller.signal.aborted;
    return { ok: false, detail: timedOut ? READY_DETAIL.timeout : READY_DETAIL.degraded };
  } finally {
    clearTimeout(timer);
  }
}
