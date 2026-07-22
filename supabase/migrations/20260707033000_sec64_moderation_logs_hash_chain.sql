-- SEC-64 (tamper-evidence leg, finding adminmcp-audit-1) — make
-- public.moderation_logs tamper-evident with a per-row hash chain, and
-- fail-closed the service-role UPDATE/DELETE/TRUNCATE grants so the audit
-- trail cannot be silently rewritten.
--
-- Epic SEC-1 / KAN-350. Split from queue row #22 (operator-attribution leg,
-- admin-MCP PR #7) because the tamper-evidence must be atomic DB-side: an
-- app-side read-then-insert forks the chain under concurrent admin actions
-- (two writers read the same tip) and raises false alarms. That is why this
-- lives in the DB, not in the admin-MCP service code.
--
-- moderation_logs lives in the LYRA Supabase (dev-lyra ilprytcrnqyrsbsrfujj);
-- the admin-MCP and the web admin console both write it. It is append-only by
-- design (no UPDATE/DELETE RLS policy; see 20260516120000_admin_and_moderation).
--
-- Apply order: dev -> staging -> prod (supervised; the autopilot applies DEV
-- only). All statements are idempotent / safe to re-run.
--
-- What this migration does:
--   (a) A per-row hash chain: each row stores seq (gap-free, assigned inside a
--       serialized trigger), prev_hash (the previous row's row_hash) and
--       row_hash = sha256( prev_hash || canonical(row) ). Editing or deleting
--       any non-tail row breaks verification of every following row.
--   (b) REVOKE UPDATE, DELETE, TRUNCATE on moderation_logs FROM service_role
--       (which BYPASSES RLS — the real exposure), plus anon/authenticated, and
--       a BEFORE UPDATE/DELETE trigger that raises, so the append-only intent is
--       enforced regardless of future grant drift.
--   (c) public.verify_moderation_log_chain() — walks the chain and reports the
--       first tampered seq (or that the chain is intact).
--
-- Residual (OUT OF SCOPE — founder/infra): a table owner / superuser can still
-- DELETE the tail (most-recent rows) and drop the triggers. Detecting tail
-- truncation needs an external append-only / WORM sink (SIEM), tracked
-- separately. This migration defeats every non-owner tamper and makes any
-- middle-row edit/delete detectable.
--
-- Rollback (destroys tamper-evidence — not recommended):
--   drop trigger if exists moderation_logs_hash_chain_trg on public.moderation_logs;
--   drop trigger if exists moderation_logs_forbid_mutation_trg on public.moderation_logs;
--   drop function if exists public.moderation_logs_hash_chain();
--   drop function if exists public.moderation_logs_forbid_mutation();
--   drop function if exists public.verify_moderation_log_chain();
--   drop function if exists public.moderation_log_row_hash(text,uuid,uuid,uuid,uuid,text,text,jsonb,timestamptz,bigint);
--   alter table public.moderation_logs drop column if exists row_hash,
--     drop column if exists prev_hash, drop column if exists seq;
--   grant update, delete, truncate on public.moderation_logs to service_role;

-- ============================================================================
-- (a.0) Canonical row-hash helper — the SINGLE source of truth for the hash so
--       the INSERT trigger and the verify function can never drift.
-- ============================================================================
-- pgcrypto (extensions.digest) lives in the `extensions` schema on Supabase;
-- it is referenced fully-qualified so search_path='' is safe. chr(30) (RECORD
-- SEPARATOR) delimits fields so no value can shift a field boundary. created_at
-- is rendered in fixed UTC ISO form so the hash is independent of the session
-- timezone/datestyle at insert vs verify time.
create or replace function public.moderation_log_row_hash(
  p_prev_hash         text,
  p_id                uuid,
  p_actor_user_id     uuid,
  p_target_profile_id uuid,
  p_target_item_id    uuid,
  p_action            text,
  p_reason            text,
  p_metadata          jsonb,
  p_created_at        timestamptz,
  p_seq               bigint
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select encode(
    extensions.digest(
      coalesce(p_prev_hash, '')                    || chr(30) ||
      p_seq::text                                  || chr(30) ||
      p_id::text                                   || chr(30) ||
      p_actor_user_id::text                        || chr(30) ||
      coalesce(p_target_profile_id::text, '')      || chr(30) ||
      coalesce(p_target_item_id::text, '')         || chr(30) ||
      p_action                                     || chr(30) ||
      coalesce(p_reason, '')                       || chr(30) ||
      coalesce(p_metadata::text, '{}')             || chr(30) ||
      to_char(p_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      'sha256'
    ),
    'hex'
  );
$$;

-- ============================================================================
-- (a.1) Chain columns.
-- ============================================================================
alter table public.moderation_logs
  add column if not exists seq       bigint,
  add column if not exists prev_hash text,
  add column if not exists row_hash  text;

-- ============================================================================
-- (a.2) Backfill any pre-existing rows into the chain, in a deterministic
--       (created_at, id) order. No-op on a fresh table (dev has 0 rows); needed
--       on staging/prod if rows already exist. Runs BEFORE the trigger exists.
-- ============================================================================
do $$
declare
  r             record;
  v_prev_hash   text := null;
  v_seq         bigint := 0;
  v_hash        text;
begin
  for r in
    select * from public.moderation_logs
    where row_hash is null
    order by created_at asc, id asc
    for update
  loop
    v_seq := v_seq + 1;
    v_hash := public.moderation_log_row_hash(
      v_prev_hash, r.id, r.actor_user_id, r.target_profile_id, r.target_item_id,
      r.action, r.reason, r.metadata, r.created_at, v_seq
    );
    update public.moderation_logs
       set seq = v_seq, prev_hash = v_prev_hash, row_hash = v_hash
     where id = r.id;
    v_prev_hash := v_hash;
  end loop;
end;
$$;

-- ============================================================================
-- (a.3) Constrain the chain columns now they are populated.
-- ============================================================================
create unique index if not exists moderation_logs_seq_key
  on public.moderation_logs(seq);

alter table public.moderation_logs
  alter column seq      set not null,
  alter column row_hash set not null;

-- ============================================================================
-- (a.4) The INSERT trigger — atomic, serialized chain append.
-- ============================================================================
-- A transaction-scoped advisory lock on a fixed key serializes every insert
-- across ALL roles (service_role, admin authenticated), so two concurrent
-- writers cannot read the same tip and fork the chain. The lock is released at
-- commit/rollback. seq is assigned INSIDE the lock (not via a sequence default)
-- so seq order == chain-build order == tip order, with no gaps. Client-supplied
-- seq/prev_hash/row_hash are always overwritten, so a caller cannot forge a row.
-- SECURITY DEFINER so the tip SELECT sees the true latest row regardless of the
-- inserting role's RLS.
create or replace function public.moderation_logs_hash_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_seq  bigint;
  v_prev_hash text;
begin
  -- Fixed arbitrary key unique to this chain.
  perform pg_catalog.pg_advisory_xact_lock(7364640264001);

  select ml.seq, ml.row_hash
    into v_prev_seq, v_prev_hash
    from public.moderation_logs ml
   order by ml.seq desc
   limit 1;

  new.seq       := coalesce(v_prev_seq, 0) + 1;
  new.prev_hash := v_prev_hash;   -- null for the genesis row
  new.row_hash  := public.moderation_log_row_hash(
    v_prev_hash, new.id, new.actor_user_id, new.target_profile_id,
    new.target_item_id, new.action, new.reason, new.metadata,
    new.created_at, new.seq
  );
  return new;
end;
$$;

drop trigger if exists moderation_logs_hash_chain_trg on public.moderation_logs;
create trigger moderation_logs_hash_chain_trg
  before insert on public.moderation_logs
  for each row
  execute function public.moderation_logs_hash_chain();

-- ============================================================================
-- (b) Append-only enforcement — no UPDATE/DELETE/TRUNCATE.
-- ============================================================================
-- service_role BYPASSES RLS, so revoking its UPDATE/DELETE/TRUNCATE table
-- grants is what actually prevents the audit trail being rewritten with the
-- service key. anon/authenticated are already blocked by the absence of an
-- UPDATE/DELETE RLS policy, but we revoke there too (TRUNCATE ignores RLS) for
-- defence in depth. INSERT + SELECT are retained (the app appends + reads).
revoke update, delete, truncate on public.moderation_logs from service_role;
revoke update, delete, truncate on public.moderation_logs from authenticated;
revoke update, delete, truncate on public.moderation_logs from anon;

-- Belt-and-suspenders: a trigger that raises on any UPDATE/DELETE, so the
-- append-only intent holds even if a future grant re-opens the privilege.
create or replace function public.moderation_logs_forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'moderation_logs is append-only (SEC-64 tamper-evidence); % is not permitted', tg_op
    using errcode = 'insufficient_privilege';
  return null;
end;
$$;

drop trigger if exists moderation_logs_forbid_mutation_trg on public.moderation_logs;
create trigger moderation_logs_forbid_mutation_trg
  before update or delete on public.moderation_logs
  for each row
  execute function public.moderation_logs_forbid_mutation();

-- ============================================================================
-- (c) Verifier — walk the chain, report the first tampered seq (or intact).
-- ============================================================================
-- Returns one row: ok, rows_checked, first_bad_seq, detail. Recomputes each
-- row_hash from stored fields + the running prev_hash, and checks the stored
-- prev_hash linkage — so an edited row (row_hash mismatch) or a deleted /
-- reordered middle row (prev_hash linkage break) is caught. SECURITY DEFINER so
-- it can read the whole table; it returns only integrity metadata, no PII.
create or replace function public.verify_moderation_log_chain()
returns table(ok boolean, rows_checked bigint, first_bad_seq bigint, detail text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r           record;
  v_prev_hash text := null;
  v_expected  text;
  v_count     bigint := 0;
begin
  for r in
    select * from public.moderation_logs order by seq asc
  loop
    v_count := v_count + 1;

    if r.prev_hash is distinct from v_prev_hash then
      ok := false; rows_checked := v_count; first_bad_seq := r.seq;
      detail := 'prev_hash linkage broken at seq ' || r.seq
        || ' (a row was inserted out of band, deleted, or reordered)';
      return next; return;
    end if;

    v_expected := public.moderation_log_row_hash(
      v_prev_hash, r.id, r.actor_user_id, r.target_profile_id, r.target_item_id,
      r.action, r.reason, r.metadata, r.created_at, r.seq
    );
    if r.row_hash is distinct from v_expected then
      ok := false; rows_checked := v_count; first_bad_seq := r.seq;
      detail := 'row_hash mismatch at seq ' || r.seq || ' (row content altered)';
      return next; return;
    end if;

    v_prev_hash := r.row_hash;
  end loop;

  ok := true; rows_checked := v_count; first_bad_seq := null;
  detail := 'chain intact (' || v_count || ' rows)';
  return next;
end;
$$;

-- Lock down EXECUTE.
--   * The two trigger functions fire via the trigger mechanism regardless of
--     EXECUTE grants, so NO role ever needs to call them directly — revoke from
--     everyone. (This also clears the anon/authenticated "Public Can Execute
--     SECURITY DEFINER Function" advisor on moderation_logs_hash_chain.)
--   * verify_* is service_role-only (ops / admin-MCP integrity checks) — it must
--     not be callable by anon or by ordinary signed-in users.
--   * the row-hash helper is only ever called from inside the two SECURITY
--     DEFINER functions above (which run as the owner), so it needs no caller
--     grant either.
-- NOTE: Supabase's default privileges auto-grant EXECUTE to anon+authenticated
-- on every new function in `public`, so revoking from PUBLIC alone is NOT enough
-- — each role must be revoked explicitly.
revoke all on function public.moderation_logs_hash_chain()
  from public, anon, authenticated, service_role;
revoke all on function public.moderation_logs_forbid_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.verify_moderation_log_chain()
  from public, anon, authenticated;
grant execute on function public.verify_moderation_log_chain() to service_role;
revoke all on function public.moderation_log_row_hash(text,uuid,uuid,uuid,uuid,text,text,jsonb,timestamptz,bigint)
  from public, anon, authenticated;
grant execute on function public.moderation_log_row_hash(text,uuid,uuid,uuid,uuid,text,text,jsonb,timestamptz,bigint)
  to service_role;
