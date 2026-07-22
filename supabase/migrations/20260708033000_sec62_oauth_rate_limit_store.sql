-- SEC-62 (web-oauth-4): shared, cross-instance rate-limit store for the OAuth
-- endpoints (/oauth/token, /oauth/revoke, /oauth/register).
--
-- The in-memory limiter in src/lib/rate-limit.ts is per-serverless-instance:
-- on Vercel every lambda has its own Map, so an attacker spraying requests
-- lands on many instances and the effective cap is (per-IP cap × instance
-- count). This migration adds a single shared counter table + an ATOMIC upsert
-- RPC so the cap holds no matter how many instances serve the traffic.
--
-- Atomicity: rate_limit_hit() does the read-modify-write in ONE
-- INSERT ... ON CONFLICT DO UPDATE statement. Concurrent callers on the same
-- bucket serialise on the row lock, so no increment is lost (no read-then-write
-- race across instances). Fixed-window semantics: the first hit of a window
-- sets reset_at; expired windows reset the counter to 1 on the next hit.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.rate_limit_hit(text, integer, integer);
--   DROP TABLE IF EXISTS public.rate_limits;

CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket    text PRIMARY KEY,
  hits      integer NOT NULL DEFAULT 0,
  reset_at  timestamptz NOT NULL
);

COMMENT ON TABLE public.rate_limits IS
  'SEC-62: shared fixed-window rate-limit counters. Written only via the service-role rate_limit_hit() RPC. One row per (endpoint,ip|client) bucket.';

-- Lets a periodic sweep / index-scan drop expired rows cheaply. Not required
-- for correctness (rate_limit_hit resets in-place) — purely for housekeeping.
CREATE INDEX IF NOT EXISTS rate_limits_reset_at_idx ON public.rate_limits (reset_at);

-- Lock the table down: only the service-role (which BYPASSES RLS) may touch it.
-- Enabling RLS with no policies denies anon/authenticated entirely — the RPC
-- below runs SECURITY DEFINER so it still works, and no client can read another
-- caller's counters or forge/reset their own.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM anon, authenticated;

-- Atomic fixed-window increment. Returns whether this hit is over the cap and
-- how many seconds until the window resets.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  p_bucket          text,
  p_limit           integer,
  p_window_seconds  integer
)
RETURNS TABLE (limited boolean, retry_after integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hits     integer;
  v_reset_at timestamptz;
BEGIN
  INSERT INTO public.rate_limits AS r (bucket, hits, reset_at)
  VALUES (
    p_bucket,
    1,
    now() + make_interval(secs => p_window_seconds)
  )
  ON CONFLICT (bucket) DO UPDATE
    SET hits = CASE
                 WHEN r.reset_at < now() THEN 1
                 ELSE r.hits + 1
               END,
        reset_at = CASE
                     WHEN r.reset_at < now()
                       THEN now() + make_interval(secs => p_window_seconds)
                     ELSE r.reset_at
                   END
  RETURNING r.hits, r.reset_at INTO v_hits, v_reset_at;

  limited := v_hits > p_limit;
  retry_after := GREATEST(0, ceil(extract(epoch FROM (v_reset_at - now()))))::integer;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.rate_limit_hit(text, integer, integer) IS
  'SEC-62: atomic fixed-window rate-limit increment. Service-role only.';

-- SECURITY DEFINER + no public EXECUTE: only the service-role key (used by the
-- web app''s server routes) may call it. anon/authenticated cannot enumerate or
-- reset counters.
REVOKE ALL ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) TO service_role;
