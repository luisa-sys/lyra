-- KAN-205 — Convene Phase 1: venues layer.
--
-- venues          canonical venue records (shared across users)
-- venue_visits    which gathering visited which venue (joined-via-gathering)
-- venue_ratings   per-user ratings (owner-scoped)
--
-- venues is a SHARED catalogue (anyone authenticated can read). Writes go
-- through service-role only — the application enriches venues from Google
-- Places and never accepts user-submitted venue rows directly.

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  google_place_id text unique,
  name text not null,
  venue_type text not null check (venue_type in (
    'cafe', 'restaurant', 'bar', 'pub', 'park', 'soft_play', 'museum',
    'theatre', 'cinema', 'gallery', 'sports_venue', 'home', 'office',
    'event_space', 'other'
  )),
  cuisine text,
  price_tier smallint check (price_tier between 1 and 4),
  capacity_estimate int,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postcode text,
  country text not null default 'GB',
  lat numeric(9,6),
  lng numeric(9,6),
  phone text,
  website_url text,
  opening_hours jsonb,
  accessibility_flags text[] not null default '{}',
  dietary_flags text[] not null default '{}',
  external_rating numeric(2,1) check (external_rating between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index venues_city_idx on public.venues (city);
create index venues_type_idx on public.venues (venue_type);
create index venues_location_idx on public.venues (lat, lng) where lat is not null;

alter table public.venues enable row level security;

-- Authenticated users can read any venue (it's a public catalogue).
create policy venues_authenticated_read on public.venues
  for select to authenticated using (true);

-- Writes only from service role (no policy = deny).

create trigger venues_updated_at before update on public.venues
  for each row execute function public.convene_set_updated_at();

comment on table public.venues is 'KAN-205 — canonical venue catalogue. Sourced from Google Places via service-role writes. Shared across users.';

-- ─── venue_visits ─────────────────────────────────────────────────────────
-- Recorded per gathering. RLS inherited via gathering (forward ref — applied
-- by trigger once gatherings table exists).

create table public.venue_visits (
  id uuid primary key default gen_random_uuid(),
  gathering_id uuid not null,  -- FK added in gatherings migration to break the cycle cleanly
  venue_id uuid not null references public.venues(id) on delete restrict,
  visited_at date not null,
  created_at timestamptz not null default now()
);

create index venue_visits_gathering_idx on public.venue_visits (gathering_id);
create index venue_visits_venue_idx on public.venue_visits (venue_id);

alter table public.venue_visits enable row level security;
-- Policies created in gatherings migration (need gathering FK first).

comment on table public.venue_visits is 'KAN-205 — joins gatherings to venues (training data for venue recommender). RLS inherited via gathering.';

-- ─── venue_ratings ────────────────────────────────────────────────────────

create table public.venue_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, venue_id)
);

create index venue_ratings_venue_idx on public.venue_ratings (venue_id);

alter table public.venue_ratings enable row level security;

create policy venue_ratings_owner_select on public.venue_ratings
  for select using (auth.uid() = user_id);

create policy venue_ratings_owner_write on public.venue_ratings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger venue_ratings_updated_at before update on public.venue_ratings
  for each row execute function public.convene_set_updated_at();

comment on table public.venue_ratings is 'KAN-205 — per-user, per-venue rating (1-5) + optional note. Drives personalised ranking.';
