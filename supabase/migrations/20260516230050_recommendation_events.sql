-- KAN-202: recommendation_events — feedback + learning loop for the V2
-- recommender.
--
-- The V2 ranker (KAN-199) needs signals to improve over time. This table
-- captures every observable event on a recommendation:
--   1. Explicit signals — thumbs up/down, hide, the user explicitly rated
--      a recommendation either via the web UI (KAN-191) or via the MCP
--      `lyra_record_feedback` tool (added in a separate lyra-mcp-server PR).
--   2. Implicit signals — shown / clicked / converted. The recommender's
--      render path emits 'shown', the link service (KAN-188) emits 'clicked'
--      (mirrored into affiliate_clicks too, KAN-189), and the reconciliation
--      cron (KAN-195) emits 'converted'.
--
-- A nightly aggregation cron (separate ticket) computes per-merchant EPC +
-- CTR + per-concept satisfaction from this table and feeds them back into
-- the ranker's weights via KV cache.
--
-- Join key: recommendation_id is a free-form text matching what the
-- recommender emits and what `affiliate_clicks.recommendation_id` points
-- at. We could FK it but the recommender's render event isn't persisted
-- yet (V2 will introduce that in a later ticket) — keeping it free-form
-- lets us start collecting signals immediately.
--
-- Rollback (one-time, do not include in migration body):
--   drop table if exists public.recommendation_events;

create table if not exists public.recommendation_events (
  event_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Joins to the affiliate_clicks row when the event_type is 'clicked' /
  -- 'converted'; for 'shown' / 'thumbs_*' / 'hidden', the click hasn't
  -- happened yet so the relationship is by recommendation_id alone.
  recommendation_id text not null,

  -- Attribution. session_id is always present (web + MCP both produce
  -- one); user_id is null for anonymous web visitors; recipient_id is
  -- null when feedback is on a sample/demo recommendation not tied to
  -- a real profile.
  session_id text,
  user_id uuid references auth.users(id) on delete set null,
  recipient_id uuid references public.profiles(id) on delete set null,

  -- The merchant the surfaced recommendation pointed at. Useful for
  -- per-merchant EPC computation without joining to affiliate_clicks.
  merchant_id text,

  event_type text not null check (event_type in (
    'shown',           -- recommendation rendered to the user
    'clicked',         -- user clicked the affiliate link
    'converted',       -- provider reported a sale on this click
    'thumbs_up',       -- explicit positive signal
    'thumbs_down',     -- explicit negative signal
    'hidden'           -- user hid the recommendation
  )),

  -- Source of the event — same enum as affiliate_clicks.source so the
  -- two are aligned for reporting.
  source text not null default 'web' check (source in ('web', 'mcp', 'email')),

  -- Free-form bag for event-specific context. NO PII. Example uses:
  --   { "position": 2, "concept": "books_reading" }  for 'shown'
  --   { "reason": "too_expensive" }  for 'thumbs_down'
  -- Schema-less by design — the ranker reads keys it knows about and
  -- ignores the rest.
  metadata jsonb not null default '{}'::jsonb
);

-- Indexes
-- (recommendation_id) is the primary join key for analytics aggregation
create index if not exists recommendation_events_recommendation_idx
  on public.recommendation_events(recommendation_id);

-- (merchant_id, event_type, created_at) supports per-merchant CTR / EPC
-- computation in the nightly aggregation
create index if not exists recommendation_events_merchant_idx
  on public.recommendation_events(merchant_id, event_type, created_at desc)
  where merchant_id is not null;

-- (user_id, created_at) supports per-user feedback history (e.g. "what
-- have I rated lately")
create index if not exists recommendation_events_user_idx
  on public.recommendation_events(user_id, created_at desc)
  where user_id is not null;

-- (recipient_id, event_type) supports per-profile feedback rollups for
-- the future per-recipient learning (V2.2 in KAN-199)
create index if not exists recommendation_events_recipient_idx
  on public.recommendation_events(recipient_id, event_type)
  where recipient_id is not null;

-- RLS
alter table public.recommendation_events enable row level security;

-- Users can read their own events only. Service role bypasses RLS for writes
-- (from the recommender / link service / cron) and aggregate reads (from the
-- admin dashboard).
drop policy if exists "Users can read own recommendation events" on public.recommendation_events;
create policy "Users can read own recommendation events"
  on public.recommendation_events for select to authenticated
  using (user_id = auth.uid());
