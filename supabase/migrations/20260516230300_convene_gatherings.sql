-- KAN-205 — Convene Phase 1: gatherings layer.
--
-- Five tables, all RLS-enforced. The host-user-id is the canonical owner.
-- Invitee contact PII never leaves the host's scope.

-- ─── gatherings ───────────────────────────────────────────────────────────

create table public.gatherings (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  gathering_type text not null check (gathering_type in (
    'coffee', 'lunch', 'dinner', 'drinks', 'party', 'kids_party',
    'meeting', 'date', 'walk', 'cinema', 'other'
  )),
  status text not null default 'draft' check (status in (
    'draft', 'awaiting_responses', 'live', 'rescheduled', 'cancelled', 'completed'
  )),
  target_window_start timestamptz,
  target_window_end timestamptz,
  finalised_slot_start timestamptz,
  finalised_slot_end timestamptz,
  venue_id uuid references public.venues(id) on delete set null,
  capacity_min int check (capacity_min >= 0),
  capacity_max int check (capacity_max >= 0 and capacity_max >= coalesce(capacity_min, 0)),
  dietary_summary text,
  accessibility_required text[] not null default '{}',
  notes text,
  silence_nudge_days int not null default 2 check (silence_nudge_days between 1 and 14),
  silence_presumed_declined_days int not null default 4 check (silence_presumed_declined_days between 2 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index gatherings_host_idx on public.gatherings (host_user_id) where deleted_at is null;
create index gatherings_status_idx on public.gatherings (host_user_id, status) where deleted_at is null;
create index gatherings_venue_idx on public.gatherings (venue_id) where venue_id is not null;
create index gatherings_finalised_slot_idx on public.gatherings (finalised_slot_start) where finalised_slot_start is not null;

alter table public.gatherings enable row level security;

create policy gatherings_host_all on public.gatherings
  for all using (auth.uid() = host_user_id) with check (auth.uid() = host_user_id);

create trigger gatherings_updated_at before update on public.gatherings
  for each row execute function public.convene_set_updated_at();

comment on table public.gatherings is 'KAN-205 — the core record. host_user_id is the canonical owner across all child tables.';

-- ─── gathering_invitees ───────────────────────────────────────────────────

create table public.gathering_invitees (
  id uuid primary key default gen_random_uuid(),
  gathering_id uuid not null references public.gatherings(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete restrict,
  status text not null default 'invited' check (status in (
    'invited', 'tentative', 'accepted', 'declined',
    'presumed_declined', 'waitlist', 'attended', 'no_show', 'cancelled'
  )),
  dietary_overrides text,
  plus_ones smallint not null default 0 check (plus_ones >= 0),
  notes text,
  rsvp_token text unique,
  rsvp_token_expires_at timestamptz,
  invited_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gathering_id, contact_id)
);

create index gathering_invitees_gathering_idx on public.gathering_invitees (gathering_id);
create index gathering_invitees_contact_idx on public.gathering_invitees (contact_id);
create index gathering_invitees_token_idx on public.gathering_invitees (rsvp_token) where rsvp_token is not null;
create index gathering_invitees_status_idx on public.gathering_invitees (gathering_id, status);

alter table public.gathering_invitees enable row level security;

create policy gathering_invitees_via_gathering_all on public.gathering_invitees
  for all using (
    exists (
      select 1 from public.gatherings g
      where g.id = gathering_id and g.host_user_id = auth.uid() and g.deleted_at is null
    )
  ) with check (
    exists (
      select 1 from public.gatherings g
      where g.id = gathering_id and g.host_user_id = auth.uid() and g.deleted_at is null
    )
  );

create trigger gathering_invitees_updated_at before update on public.gathering_invitees
  for each row execute function public.convene_set_updated_at();

-- Cross-table invariant: invitee's contact must be owned by the gathering host.
create or replace function public.gathering_invitees_enforce_host_owns_contact()
  returns trigger
  language plpgsql
as $$
declare
  v_host uuid;
  v_contact_owner uuid;
begin
  select host_user_id into v_host from public.gatherings where id = new.gathering_id;
  select owner_user_id into v_contact_owner from public.contacts where id = new.contact_id;
  if v_host is null or v_contact_owner is null then
    raise exception 'gathering_invitees: gathering or contact missing';
  end if;
  if v_host <> v_contact_owner then
    raise exception 'gathering_invitees: host (%) does not own contact (%)', v_host, v_contact_owner;
  end if;
  return new;
end;
$$;

create trigger gathering_invitees_host_owns_contact
  before insert or update on public.gathering_invitees
  for each row execute function public.gathering_invitees_enforce_host_owns_contact();

comment on table public.gathering_invitees is 'KAN-205 — per-invitee state. Host must own the contact (trigger-enforced). rsvp_token gates the public /r/<token> page.';

-- ─── gathering_proposed_slots ─────────────────────────────────────────────

create table public.gathering_proposed_slots (
  id uuid primary key default gen_random_uuid(),
  gathering_id uuid not null references public.gatherings(id) on delete cascade,
  slot_start timestamptz not null,
  slot_end timestamptz not null check (slot_end > slot_start),
  score numeric(5,3),
  availability_breakdown jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index gathering_proposed_slots_gathering_idx on public.gathering_proposed_slots (gathering_id, score desc);

alter table public.gathering_proposed_slots enable row level security;

create policy gathering_proposed_slots_via_gathering_all on public.gathering_proposed_slots
  for all using (
    exists (
      select 1 from public.gatherings g
      where g.id = gathering_id and g.host_user_id = auth.uid() and g.deleted_at is null
    )
  ) with check (
    exists (
      select 1 from public.gatherings g
      where g.id = gathering_id and g.host_user_id = auth.uid() and g.deleted_at is null
    )
  );

comment on table public.gathering_proposed_slots is 'KAN-205 — candidate time slots before finalisation. availability_breakdown is {contact_id: free|busy|unknown}.';

-- ─── gathering_invite_messages ────────────────────────────────────────────

create table public.gathering_invite_messages (
  id uuid primary key default gen_random_uuid(),
  gathering_id uuid not null references public.gatherings(id) on delete cascade,
  invitee_id uuid not null references public.gathering_invitees(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms', 'whatsapp', 'imessage')),
  template_name text not null,
  sent_at timestamptz,
  delivery_status text not null default 'queued' check (delivery_status in (
    'queued', 'sent', 'delivered', 'opened', 'clicked',
    'bounced', 'complained', 'failed'
  )),
  bounce_reason text,
  external_message_id text,
  created_at timestamptz not null default now()
);

create index gathering_invite_messages_gathering_idx on public.gathering_invite_messages (gathering_id);
create index gathering_invite_messages_invitee_idx on public.gathering_invite_messages (invitee_id);

alter table public.gathering_invite_messages enable row level security;

create policy gathering_invite_messages_via_gathering_select on public.gathering_invite_messages
  for select using (
    exists (
      select 1 from public.gatherings g
      where g.id = gathering_id and g.host_user_id = auth.uid() and g.deleted_at is null
    )
  );

-- Writes service-role only (no insert/update/delete policy).

comment on table public.gathering_invite_messages is 'KAN-205 — outbound message log. Service-role writes; host can read.';

-- ─── gathering_events_log ─────────────────────────────────────────────────

create table public.gathering_events_log (
  id uuid primary key default gen_random_uuid(),
  gathering_id uuid not null references public.gatherings(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  subject_kind text,
  subject_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index gathering_events_log_gathering_idx on public.gathering_events_log (gathering_id, created_at desc);

alter table public.gathering_events_log enable row level security;

create policy gathering_events_log_via_gathering_select on public.gathering_events_log
  for select using (
    exists (
      select 1 from public.gatherings g
      where g.id = gathering_id and g.host_user_id = auth.uid() and g.deleted_at is null
    )
  );

-- Append-only — service-role writes, host reads.
create or replace function public.gathering_events_log_block_mutations()
  returns trigger
  language plpgsql
as $$
begin
  raise exception 'gathering_events_log is append-only';
end;
$$;

create trigger gathering_events_log_no_update before update on public.gathering_events_log
  for each row execute function public.gathering_events_log_block_mutations();

create trigger gathering_events_log_no_delete before delete on public.gathering_events_log
  for each row execute function public.gathering_events_log_block_mutations();

comment on table public.gathering_events_log is 'KAN-205 — append-only audit trail per gathering. Drives the "what happened" agent view.';

-- ─── venue_visits: now add FK + policy (was forward-declared) ─────────────

alter table public.venue_visits
  add constraint venue_visits_gathering_fk
  foreign key (gathering_id) references public.gatherings(id) on delete cascade;

create policy venue_visits_via_gathering_select on public.venue_visits
  for select using (
    exists (
      select 1 from public.gatherings g
      where g.id = gathering_id and g.host_user_id = auth.uid() and g.deleted_at is null
    )
  );
