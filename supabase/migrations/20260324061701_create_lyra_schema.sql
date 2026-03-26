-- Lyra Database Schema
-- KAN-18: Create Supabase database schema and migrations

-- Enable UUID extension
create extension if not exists "uuid-ossp" with schema extensions;

-- ============================================================
-- PROFILES - Core user profile table
-- ============================================================
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  display_name text not null,
  slug text unique not null,
  headline text,
  bio_short text,
  city text,
  region text,
  postcode_prefix text,
  country text default 'GB',
  is_published boolean default false,
  onboarding_complete boolean default false,
  completion_score integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- Indexes for profiles
create unique index profiles_user_id_idx on public.profiles(user_id);
create unique index profiles_slug_idx on public.profiles(slug);
create index profiles_is_published_idx on public.profiles(is_published);

-- ============================================================
-- PROFILE ITEMS - Gift ideas, likes, dislikes, boundaries, etc.
-- ============================================================
create type public.item_category as enum (
  'gift_ideas',
  'gifts_to_avoid',
  'likes',
  'dislikes',
  'helpful_to_know',
  'boundaries'
);

create type public.visibility_level as enum (
  'public',
  'members_only',
  'private'
);

create table public.profile_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade not null,
  category item_category not null,
  title text not null,
  description text,
  url text,
  visibility visibility_level default 'public',
  sort_order integer default 0,
  created_at timestamptz default now()
);
-- Indexes for profile_items
create index profile_items_profile_id_idx on public.profile_items(profile_id);
create index profile_items_category_idx on public.profile_items(category);

-- ============================================================
-- EXTERNAL LINKS - Wishlists, shops, articles
-- ============================================================
create type public.link_type as enum (
  'retailer',
  'wishlist',
  'article',
  'general'
);

create table public.external_links (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  url text not null,
  link_type link_type default 'general',
  description text,
  sort_order integer default 0,
  created_at timestamptz default now()
);

create index external_links_profile_id_idx on public.external_links(profile_id);
-- ============================================================
-- SCHOOL AFFILIATIONS
-- ============================================================
create type public.school_relationship as enum (
  'parent',
  'student',
  'alumni',
  'staff',
  'other'
);

create table public.school_affiliations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade not null,
  school_name text not null,
  school_location text,
  relationship school_relationship default 'parent',
  created_at timestamptz default now()
);

create index school_affiliations_profile_id_idx on public.school_affiliations(profile_id);
-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.profile_items enable row level security;
alter table public.external_links enable row level security;
alter table public.school_affiliations enable row level security;

-- Profiles: owners can do everything, public can read published
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = user_id);

create policy "Anyone can read published profiles"
  on public.profiles for select
  using (is_published = true);
-- Profile items: owners can CRUD, public can read from published profiles
create policy "Users can manage own profile items"
  on public.profile_items for all
  using (profile_id in (
    select id from public.profiles where user_id = auth.uid()
  ));

create policy "Anyone can read items from published profiles"
  on public.profile_items for select
  using (profile_id in (
    select id from public.profiles where is_published = true
  ) and visibility = 'public');

-- External links: same pattern
create policy "Users can manage own links"
  on public.external_links for all
  using (profile_id in (
    select id from public.profiles where user_id = auth.uid()
  ));

create policy "Anyone can read links from published profiles"
  on public.external_links for select
  using (profile_id in (
    select id from public.profiles where is_published = true
  ));
-- School affiliations: same pattern
create policy "Users can manage own school affiliations"
  on public.school_affiliations for all
  using (profile_id in (
    select id from public.profiles where user_id = auth.uid()
  ));

create policy "Anyone can read schools from published profiles"
  on public.school_affiliations for select
  using (profile_id in (
    select id from public.profiles where is_published = true
  ));

-- ============================================================
-- AUTO-UPDATE TIMESTAMP TRIGGER
-- ============================================================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_profile_updated
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, display_name, slug)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    lower(replace(coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), ' ', '-'))
      || '-' || substr(new.id::text, 1, 8)
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();