-- KAN-187: affiliate_merchant_eligibility — country × merchant matrix the
-- recommender's eligibility filter (KAN-190) and the Affiliate Link Service
-- (KAN-188) both consult before generating a monetised link.
--
-- For every (merchant_id, country_code) pair we record:
--   - which affiliate network we have a commission relationship through
--   - that network's program identifier so the link service can submit it
--   - an informational commission rate used as a weight by the ranker
--   - an is_active flag so admins can toggle merchants off in case of
--     compliance issues without deleting history
--
-- Seed strategy (sliding-window over time):
--   1. MVP / pre-Sovrn (this PR): seed a small starter set covering the
--      curated catalogue merchants (Bookshop.org, Etsy, John Lewis,
--      Notonthehighstreet, Amazon) for the supported countries from
--      src/lib/affiliate/country-codes.ts. Marked is_active=true so the
--      KAN-190 filter has data to work with even before Sovrn is live.
--   2. Once SOVRN_API_KEY is set (KAN-184): the nightly seed script (see
--      scripts/seed-affiliate-merchant-eligibility.ts) will fetch Sovrn's
--      Merchant API and upsert thousands more rows, replacing the starter
--      seed where they overlap.
--
-- Rollback (one-time, do not include in migration body):
--   drop table if exists public.affiliate_merchant_eligibility;

create table if not exists public.affiliate_merchant_eligibility (
  merchant_id text not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  merchant_display_name text not null,
  affiliate_network text not null check (affiliate_network in ('sovrn', 'amazon_direct', 'geniuslink', 'awin', 'ebay_partner', 'curated')),
  affiliate_program_id text,
  commission_rate_pct numeric(5, 2) check (commission_rate_pct is null or (commission_rate_pct >= 0 and commission_rate_pct <= 100)),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (merchant_id, country_code)
);

-- Hot-path index: the eligibility filter (KAN-190) queries by country first,
-- then iterates merchants. The composite PK already covers this when
-- queried with (merchant_id, country_code) but the recommender's typical
-- pattern is "for buyer country, give me the active merchant set".
create index if not exists affiliate_merchant_eligibility_country_idx
  on public.affiliate_merchant_eligibility(country_code, is_active);

-- For reporting (KAN-195) — break down EPC + revenue by merchant network.
create index if not exists affiliate_merchant_eligibility_network_idx
  on public.affiliate_merchant_eligibility(affiliate_network);

-- updated_at trigger so admin edits stay accurate (same pattern as
-- recommender_catalogue in KAN-200).
create or replace function public.affiliate_merchant_eligibility_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end$$ language plpgsql;

drop trigger if exists affiliate_merchant_eligibility_touch on public.affiliate_merchant_eligibility;
create trigger affiliate_merchant_eligibility_touch before update on public.affiliate_merchant_eligibility
  for each row execute function public.affiliate_merchant_eligibility_touch_updated_at();

-- RLS
alter table public.affiliate_merchant_eligibility enable row level security;

-- Public read of ACTIVE rows. The recommender / link service hit this via
-- the service role anyway (faster, bypasses RLS); the public read policy
-- is so a future public listing UI ("which retailers does Lyra cover?")
-- doesn't need a separate path.
drop policy if exists "Public read active eligibility" on public.affiliate_merchant_eligibility;
create policy "Public read active eligibility"
  on public.affiliate_merchant_eligibility for select to public
  using (is_active = true);

-- Admin manage (re-uses the existing profiles.is_admin flag from KAN-141).
drop policy if exists "Admins manage eligibility" on public.affiliate_merchant_eligibility;
create policy "Admins manage eligibility"
  on public.affiliate_merchant_eligibility for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.is_admin = true
    )
  );
