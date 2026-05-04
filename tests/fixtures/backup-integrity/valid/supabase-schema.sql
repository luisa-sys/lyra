-- PostgreSQL database dump
-- Test fixture for KAN-167 Phase 4 (check-backup-integrity.sh)
-- This file mimics a real pg_dump header so the integrity script accepts it.

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE SCHEMA IF NOT EXISTS public;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  display_name text,
  is_published boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.profile_items (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  kind text NOT NULL,
  data jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.external_links (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  url text NOT NULL,
  label text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.school_affiliations (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id),
  school_name text NOT NULL,
  start_year int,
  end_year int
);

CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  key_hash text NOT NULL,
  created_at timestamptz DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX profiles_user_id_idx ON public.profiles(user_id);
CREATE INDEX profile_items_profile_id_idx ON public.profile_items(profile_id);
CREATE INDEX external_links_profile_id_idx ON public.external_links(profile_id);
CREATE INDEX api_keys_user_id_idx ON public.api_keys(user_id);
