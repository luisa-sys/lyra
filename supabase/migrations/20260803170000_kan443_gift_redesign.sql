-- KAN-443: Gifts redesign — an optional voucher hint, and per-suggestion dismissals.
--
-- Two additive changes, both from the approved design card:
--
--   (1) profiles.gift_voucher_hint — some members (teachers especially) would
--       rather choose their own thing. One short, optional line on the profile
--       saying so. It lives on `profiles` rather than as another profile_item
--       because it is a property OF the person, not another entry in the list:
--       it has no title, no link and no position in a list, and it should show
--       once next to the gift section rather than as a row inside it.
--
--   (2) gift_suggestion_dismissals — today a member cannot remove an
--       auto-generated gift suggestion from their own profile at all. This is
--       the "not for me" store: one row per dismissed suggestion.
--
-- WHY A CHILD TABLE RATHER THAN A JSONB ARRAY ON `profiles`
-- ---------------------------------------------------------
-- Appending to a JSONB array needs read-modify-write, so two dismissals issued
-- close together race and the second silently discards the first. That is the
-- same trade `updateSectionVisibility` documents and accepts — but it is only
-- acceptable there because a section default is a single-value write where the
-- last writer legitimately wins. A dismissal is an ACCUMULATION: losing one
-- means a suggestion the member said no to comes back, which is precisely the
-- behaviour this feature exists to stop. A child table with a composite primary
-- key makes a dismissal an INSERT — atomic, idempotent, no read-modify-write.
--
-- ⚠️ `gift_voucher_hint` IS A NEW COLUMN ON A HEAVILY-USED TABLE.
-- PostgREST builds the UPDATE column list from the payload KEYS, so a write
-- naming `gift_voucher_hint` fails the WHOLE request with PGRST204 on any
-- environment where this migration has not run yet — even when the value is
-- NULL. Code reaches an environment before its migration does (KAN-444 caught
-- exactly this). `giftVoucherHintPayload` in
-- src/app/dashboard/profile/profile-fields.ts is what keeps the key out of the
-- payload when there is nothing to say about the column, and
-- tests/unit/kan443-gift-voucher-hint.test.ts pins that the key is ABSENT
-- rather than null. `npm run type-check` cannot catch this — the server
-- Supabase client in src/lib/supabase-server.ts is untyped.
--
-- Additive and reversible. No backfill, no data migration.
--
-- ROLLBACK:
--   drop policy if exists "Users can manage own gift suggestion dismissals"
--     on public.gift_suggestion_dismissals;
--   drop table if exists public.gift_suggestion_dismissals;
--   alter table public.profiles drop column if exists gift_voucher_hint;

-- ============================================================================
-- (1) The optional voucher hint
-- ============================================================================
alter table public.profiles
  add column if not exists gift_voucher_hint text;

comment on column public.profiles.gift_voucher_hint is
  'KAN-443: optional one-line note from the member for people who would rather choose their own gift ("a book token is always welcome"). Public text — sanitised + moderated on write like any other profiles column. NULL means the member has not said anything.';

-- ============================================================================
-- (2) Dismissed gift suggestions
-- ============================================================================
-- No separate index on profile_id: the composite primary key is
-- (profile_id, suggestion_key), and its index serves a profile_id-only lookup
-- from the leading column. The only two queries are "all keys for this
-- profile" (public page + editor) and "this exact row" (restore).
create table if not exists public.gift_suggestion_dismissals (
  profile_id     uuid        not null references public.profiles(id) on delete cascade,
  suggestion_key text        not null,
  dismissed_at   timestamptz not null default now(),
  primary key (profile_id, suggestion_key)
);

comment on table public.gift_suggestion_dismissals is
  'KAN-443: gift suggestions a member has said "not for me" to. suggestion_key is the stable "<categoryKey>:<lower-cased concept title>" identity produced by src/lib/recommend/dismissals.ts — a CONCEPT, not a product, so a dismissal survives the catalogue swapping which product resolves it.';

-- ============================================================================
-- RLS — a member manages only their own dismissals.
-- ============================================================================
-- Same owner-scoping shape as the profile_items / external_links policies in
-- 20260324061701_create_lyra_schema.sql. There is deliberately NO public read
-- policy: the public profile is rendered with the service-role client (which
-- bypasses RLS), and a dismissal list is a member's private editorial decision,
-- not profile content.
alter table public.gift_suggestion_dismissals enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'gift_suggestion_dismissals'
      and policyname = 'Users can manage own gift suggestion dismissals'
  ) then
    create policy "Users can manage own gift suggestion dismissals"
      on public.gift_suggestion_dismissals for all
      using (profile_id in (
        select id from public.profiles where user_id = auth.uid()
      ))
      with check (profile_id in (
        select id from public.profiles where user_id = auth.uid()
      ));
  end if;
end $$;

-- Gotcha #26: Supabase's ALTER DEFAULT PRIVILEGES grants ALL on new tables to
-- anon, authenticated and service_role directly, so `revoke ... from public`
-- alone would leave both roles holding table privileges. Name every role.
-- `authenticated` then gets back exactly the three verbs the dismiss / restore
-- actions need, still scoped row-by-row by the policy above. anon gets nothing:
-- a signed-out visitor never reads or writes this table.
revoke all on table public.gift_suggestion_dismissals from public, anon, authenticated;
grant select, insert, delete on table public.gift_suggestion_dismissals to authenticated;
grant all on table public.gift_suggestion_dismissals to service_role;
