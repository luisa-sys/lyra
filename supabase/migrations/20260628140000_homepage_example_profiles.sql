-- KAN-334: homepage example profiles — gate the public (logged-out) homepage to
-- curated demo profiles ONLY. Real production users must never appear there.
--
-- Allowlist semantics: a new boolean `is_homepage_example` (default false) marks
-- a curated demo profile; the public homepage query renders ONLY these. An
-- ordering column drives display order. A BEFORE trigger hard-guarantees the
-- flag can only ever be set on `@seed.checklyra.com` demo accounts, so real
-- users (incl. Ben/Luisa on @santos-stephens.com) can never be flagged — even
-- by a buggy admin write or a bad seed script.
--
-- Additive + idempotent; promote dev -> staging -> prod.
-- Rollback: drop trigger + function, drop the two columns.

alter table public.profiles
  add column if not exists is_homepage_example boolean not null default false,
  add column if not exists homepage_example_order smallint; -- display order; null for non-examples

create index if not exists profiles_homepage_example_idx
  on public.profiles (homepage_example_order) where is_homepage_example;

comment on column public.profiles.is_homepage_example is
  'KAN-334: curated demo profile shown on the PUBLIC (logged-out) homepage. Real users must never be flagged true (enforced by trg_enforce_homepage_example_seed_only).';
comment on column public.profiles.homepage_example_order is
  'KAN-334: display order on the public homepage band (1..N); null for non-examples.';

-- Anti-leak guard: only a @seed.checklyra.com demo account may be flagged as a
-- homepage example. SECURITY DEFINER so it can read auth.users; raises 42501
-- otherwise. Fires only when the flag is being set true (cheap on normal writes).
create or replace function public.enforce_homepage_example_seed_only()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
begin
  select u.email into v_email from auth.users u where u.id = new.user_id;
  if v_email is null or v_email not ilike '%@seed.checklyra.com' then
    raise exception
      'is_homepage_example may only be set on @seed.checklyra.com demo profiles (got %)',
      coalesce(v_email, '(no auth user)')
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_homepage_example_seed_only() from public, anon, authenticated;

drop trigger if exists trg_enforce_homepage_example_seed_only on public.profiles;
create trigger trg_enforce_homepage_example_seed_only
  before insert or update of is_homepage_example on public.profiles
  for each row
  when (new.is_homepage_example is true)
  execute function public.enforce_homepage_example_seed_only();
