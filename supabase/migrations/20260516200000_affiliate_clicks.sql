-- KAN-189: affiliate_clicks — internal click log for affiliate-monetised links.
--
-- Every call to the Affiliate Link Service (KAN-188) writes a row here whether
-- the click was monetised or not. The log is the source of truth for:
--   1. Monthly reconciliation against Sovrn's report (KAN-195) — joined on
--      provider_subid which is our generated UUID echoed back by Sovrn.
--   2. Per-merchant EPC (KAN-195) which feeds back into the recommender's
--      ranking weights (KAN-199).
--   3. The feedback loop in KAN-202 — recommendation_id links clicks back to
--      the recommendation render event.
--
-- The table is append-only on the hot path. The reconciliation cron updates
-- the converted_at / commission_* fields once Sovrn confirms a sale.
--
-- SubID convention (set by KAN-188 link service, NOT by this migration):
--   - web/email source: "lyra-{click_id}"   (lyra- prefix)
--   - mcp source:       "lyra-mcp-{click_id}"
-- We use the same opaque click_id as both PK and the seed of provider_subid so
-- reconciliation is a straight equi-join after stripping the prefix.
--
-- RLS:
--   - Users see their own clicks only.
--   - Service-role bypasses RLS to write from the link service and read for
--     the reconciliation cron.
--
-- Rollback (one-time, do not include in migration body):
--   drop table if exists public.affiliate_clicks;

create table if not exists public.affiliate_clicks (
  click_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Attribution context. Nullable because we want to allow anonymous browsing
  -- (no auth) and landing-page clicks (no recipient anchor).
  session_id text,
  user_id uuid references auth.users(id) on delete set null,
  recipient_id uuid references public.profiles(id) on delete set null,
  recommendation_id text,  -- free-form until KAN-202 introduces the events table

  -- Merchant + geo signals (per KAN-185 + KAN-187)
  merchant_id text,                       -- e.g. "amazon", "etsy"; null if unknown to us
  buyer_country text check (buyer_country ~ '^[A-Z]{2}$'),       -- ISO-3166 alpha-2
  recipient_country text check (recipient_country ~ '^[A-Z]{2}$'),

  -- Provider that monetised the click (or "raw" if none)
  provider text not null check (provider in ('sovrn', 'amazon_direct', 'geniuslink', 'raw')),
  provider_subid text,                    -- what we sent the provider; null for "raw"
  source text not null default 'web' check (source in ('web', 'mcp', 'email')),

  -- URLs (raw_url is the recommender's pre-monetised choice; monetised_url is
  -- what the user clicked on)
  raw_url text not null,
  monetised_url text not null,

  -- Reconciliation fields — populated by the cron in KAN-195
  converted_at timestamptz,
  commission_amount numeric(12, 4),
  commission_currency text check (commission_currency ~ '^[A-Z]{3}$'),
  commission_gbp numeric(12, 4)
);

-- Indexes
-- (provider, provider_subid) is the reconciliation join key
create index if not exists affiliate_clicks_provider_subid_idx
  on public.affiliate_clicks(provider, provider_subid)
  where provider_subid is not null;

-- (session_id, created_at) supports session-attribution + time-window queries
create index if not exists affiliate_clicks_session_idx
  on public.affiliate_clicks(session_id, created_at desc)
  where session_id is not null;

-- (user_id, created_at) supports a user's own click history view
create index if not exists affiliate_clicks_user_idx
  on public.affiliate_clicks(user_id, created_at desc)
  where user_id is not null;

-- (recipient_id) supports analytics breakdown by recipient profile
create index if not exists affiliate_clicks_recipient_idx
  on public.affiliate_clicks(recipient_id)
  where recipient_id is not null;

-- (merchant_id, buyer_country, created_at) supports per-merchant per-country
-- EPC computation in KAN-195
create index if not exists affiliate_clicks_merchant_country_idx
  on public.affiliate_clicks(merchant_id, buyer_country, created_at desc)
  where merchant_id is not null;

-- RLS
alter table public.affiliate_clicks enable row level security;

drop policy if exists "Users can read own clicks" on public.affiliate_clicks;
create policy "Users can read own clicks"
  on public.affiliate_clicks for select to authenticated
  using (user_id = auth.uid());

-- No insert / update / delete policies for authenticated role — writes happen
-- only via the service role from the Affiliate Link Service (KAN-188) and the
-- reconciliation cron (KAN-195). Service role bypasses RLS so no explicit
-- policy is needed; clients cannot write through the regular Supabase client.
