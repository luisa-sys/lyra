-- KAN-205 — Convene Phase 1: people & relationships layer.
--
-- contacts          host's address-book entries (NOT Lyra profiles)
-- contact_methods   email/phone/whatsapp/imessage per contact
-- tribes            named groups (uni friends, Tom's classmates, ...)
-- tribe_members     many-to-many between tribes and contacts
--
-- Strict ownership scoping: every contact has owner_user_id; tribe_members
-- inherits via the tribe; cross-table invariant (tribe and contact must share
-- the same owner) enforced by trigger.

-- ─── contacts ─────────────────────────────────────────────────────────────

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  linked_profile_id uuid references public.profiles(id) on delete set null,
  avatar_url text,
  city text,
  country text,
  notes text,
  source text not null default 'manual' check (source in ('manual', 'google_people', 'apple_contacts', 'caldav')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_user_id, source, external_id)
);

create index contacts_owner_idx on public.contacts (owner_user_id) where deleted_at is null;
create index contacts_linked_profile_idx on public.contacts (linked_profile_id) where linked_profile_id is not null;

alter table public.contacts enable row level security;

create policy contacts_owner_all on public.contacts
  for all using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.convene_set_updated_at();

comment on table public.contacts is 'KAN-205 — host''s address-book entries. Never exposed cross-user; linked_profile_id allows joining to public Lyra profiles when present.';

-- ─── contact_methods ──────────────────────────────────────────────────────

create table public.contact_methods (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  kind text not null check (kind in ('email', 'phone', 'whatsapp', 'imessage')),
  value text not null,
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contact_id, kind, value)
);

create index contact_methods_contact_idx on public.contact_methods (contact_id);

alter table public.contact_methods enable row level security;

create policy contact_methods_via_contact_all on public.contact_methods
  for all using (
    exists (
      select 1 from public.contacts c
      where c.id = contact_id and c.owner_user_id = auth.uid() and c.deleted_at is null
    )
  ) with check (
    exists (
      select 1 from public.contacts c
      where c.id = contact_id and c.owner_user_id = auth.uid() and c.deleted_at is null
    )
  );

create trigger contact_methods_updated_at before update on public.contact_methods
  for each row execute function public.convene_set_updated_at();

-- Only one primary contact-method per (contact, kind).
create unique index contact_methods_primary_per_kind_idx
  on public.contact_methods (contact_id, kind)
  where is_primary = true;

comment on table public.contact_methods is 'KAN-205 — typed contact methods. Owner-scoped via the parent contact''s RLS.';

-- ─── tribes ───────────────────────────────────────────────────────────────

create table public.tribes (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  color_hex text check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_user_id, name)
);

create index tribes_owner_idx on public.tribes (owner_user_id) where deleted_at is null;

alter table public.tribes enable row level security;

create policy tribes_owner_all on public.tribes
  for all using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

create trigger tribes_updated_at before update on public.tribes
  for each row execute function public.convene_set_updated_at();

comment on table public.tribes is 'KAN-205 — user-named groups of contacts (uni friends, school parents, book club).';

-- ─── tribe_members ────────────────────────────────────────────────────────

create table public.tribe_members (
  id uuid primary key default gen_random_uuid(),
  tribe_id uuid not null references public.tribes(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (tribe_id, contact_id)
);

create index tribe_members_tribe_idx on public.tribe_members (tribe_id);
create index tribe_members_contact_idx on public.tribe_members (contact_id);

alter table public.tribe_members enable row level security;

create policy tribe_members_via_tribe_all on public.tribe_members
  for all using (
    exists (
      select 1 from public.tribes t
      where t.id = tribe_id and t.owner_user_id = auth.uid() and t.deleted_at is null
    )
  ) with check (
    exists (
      select 1 from public.tribes t
      where t.id = tribe_id and t.owner_user_id = auth.uid() and t.deleted_at is null
    )
  );

-- Cross-table invariant: tribe and contact must share owner. Without this the
-- service-role could accidentally cross-link.
create or replace function public.tribe_members_enforce_same_owner()
  returns trigger
  language plpgsql
as $$
declare
  v_tribe_owner uuid;
  v_contact_owner uuid;
begin
  select owner_user_id into v_tribe_owner from public.tribes where id = new.tribe_id;
  select owner_user_id into v_contact_owner from public.contacts where id = new.contact_id;
  if v_tribe_owner is null or v_contact_owner is null then
    raise exception 'tribe_members: tribe or contact missing (tribe_id=%, contact_id=%)', new.tribe_id, new.contact_id;
  end if;
  if v_tribe_owner <> v_contact_owner then
    raise exception 'tribe_members: cross-user link blocked (tribe owner=% contact owner=%)', v_tribe_owner, v_contact_owner;
  end if;
  return new;
end;
$$;

create trigger tribe_members_same_owner_check
  before insert or update on public.tribe_members
  for each row execute function public.tribe_members_enforce_same_owner();

comment on table public.tribe_members is 'KAN-205 — many-to-many tribe↔contact. Cross-user link blocked by trigger.';
