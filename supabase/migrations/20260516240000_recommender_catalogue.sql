-- KAN-200: recommender_catalogue — Tier 1 of the V2 candidate-sourcing
-- waterfall (KAN-199 design).
--
-- Admin-curated evergreen gift items mapped to V1 category keys + buyer-
-- country availability. The candidate-sourcing module checks this table
-- first; matched concepts always beat Sovrn / LLM results because curated
-- entries are known-good and known-monetisable.
--
-- This is the only Tier of the waterfall that works without Sovrn. While
-- KAN-184 is pending, V2 will surface ONLY curated entries — sparse but
-- correct.
--
-- Examples Luisa might add at MVP launch (handled in a separate seed PR):
--   - Brompton folding bike → "experiences" / "transport" / GB+IE
--   - Bookshop.org gift card → "books_reading" / all countries
--   - Etsy "personalised" search → "arts_crafts" / GB+US+DE
--
-- Rollback (one-time, do not include in migration body):
--   drop table if exists public.recommender_catalogue;

create table if not exists public.recommender_catalogue (
  catalogue_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The V1 category key (`'experiences'`, `'food_drink'`, etc.) — matches
  -- src/lib/recommend/categories.ts. The candidate sourcer filters by this
  -- when V1 emits a concept in that category.
  concept_category text not null,

  -- Optional finer-grained concept anchor — short text the V1 ranker can
  -- check against to ensure relevance (e.g. "cycling" for a folding bike).
  -- Null = match any concept in the category.
  concept_keywords text[] not null default '{}',

  -- What the user sees.
  title text not null,
  description text,
  image_url text,
  raw_url text not null,
  merchant_id text not null,          -- canonical merchant_id, KAN-191 detector
  price_min_minor integer,            -- minimum price in the lowest currency unit (e.g. pence)
  price_max_minor integer,            -- maximum price in lowest currency unit; null = no ceiling
  price_currency text check (price_currency ~ '^[A-Z]{3}$'),

  -- Buyer-country eligibility. NULL means "available everywhere we support";
  -- specific list restricts. Array because a single catalogue entry can
  -- apply to multiple countries (e.g. "Etsy gift card" works in GB+US+DE).
  buyer_countries text[],             -- ISO-2 array; null = global

  -- Active flag — admins can toggle off without deleting (preserve history).
  is_active boolean not null default true,

  -- Rationale fragment used by the V2 explainer (KAN-199) — short clause
  -- that gets composed into the final user-visible rationale.
  rationale_fragment text,

  -- Optional sort weight for ties (higher wins). Defaults to 0.
  weight numeric not null default 0
);

-- Per-category lookup is the hot path during recommendation.
create index if not exists recommender_catalogue_category_idx
  on public.recommender_catalogue(concept_category, is_active);

-- Per-merchant lookup for reporting (KAN-195).
create index if not exists recommender_catalogue_merchant_idx
  on public.recommender_catalogue(merchant_id);

-- updated_at maintained by a trigger so admin edits stay accurate.
create or replace function public.recommender_catalogue_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end$$ language plpgsql;

drop trigger if exists recommender_catalogue_touch on public.recommender_catalogue;
create trigger recommender_catalogue_touch before update on public.recommender_catalogue
  for each row execute function public.recommender_catalogue_touch_updated_at();

-- RLS
alter table public.recommender_catalogue enable row level security;

-- Public read — same model as profile data. The candidate sourcer reads via
-- service role (faster, bypasses RLS) but a public read policy keeps things
-- consistent if a future public listing UI is added.
drop policy if exists "Public read active catalogue" on public.recommender_catalogue;
create policy "Public read active catalogue"
  on public.recommender_catalogue for select to public
  using (is_active = true);

-- Admin write — re-uses the existing is_admin flag on profiles, same
-- pattern as KAN-141 admin moderation table.
drop policy if exists "Admins manage catalogue" on public.recommender_catalogue;
create policy "Admins manage catalogue"
  on public.recommender_catalogue for all to authenticated
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
