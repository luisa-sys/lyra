-- KAN-142: profile_files — general file/media uploads on profiles.
--
-- 10 files max per profile, ≤10 MB each. Allowed: jpeg/png/webp/gif/pdf.
-- Mirrors the KAN-135 avatar pattern with the additions:
--   1. A metadata table (profile_files) so we can list/order files and
--      enforce the 10-file cap without listing the bucket.
--   2. A BEFORE INSERT trigger that enforces the cap at the DB layer so
--      the UI can't be the only thing keeping it honest.
--   3. Per-item visibility (KAN-143 visibility_level enum) — files can be
--      public, members_only, or draft.
--
-- Storage path convention: {user_id}/{uuid}.{ext}
--   * UUID rather than display filename so duplicate names don't collide
--   * Folder = user_id so storage RLS via (storage.foldername(name))[1]
--     enforces per-user ownership in storage as well as in the metadata
--     table
--
-- Applied to all 3 envs on 2026-05-16:
--   dev    (ilprytcrnqyrsbsrfujj): ✓ via apply_migration
--   stage  (uobmlkzrjkptwhttzmmi): ✓ via apply_migration
--   prod   (llzkgprqewuwkiwclowi): ✓ via apply_migration

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-files', 'profile-files', true, 10485760,
  array['image/jpeg','image/png','image/webp','image/gif','application/pdf']
) on conflict (id) do nothing;

create table if not exists public.profile_files (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  sort_order integer default 0,
  visibility visibility_level default 'public',
  created_at timestamptz default now()
);
create index if not exists profile_files_profile_id_idx on public.profile_files(profile_id);

create or replace function public.enforce_profile_files_cap()
returns trigger as $$
begin
  if (select count(*) from public.profile_files where profile_id = new.profile_id) >= 10 then
    raise exception 'Profile file limit (10) reached';
  end if;
  return new;
end$$ language plpgsql;

drop trigger if exists profile_files_cap on public.profile_files;
create trigger profile_files_cap before insert on public.profile_files
  for each row execute function public.enforce_profile_files_cap();

alter table public.profile_files enable row level security;

drop policy if exists "Users can manage own files" on public.profile_files;
create policy "Users can manage own files"
  on public.profile_files for all
  using (profile_id in (select id from public.profiles where user_id = auth.uid()))
  with check (profile_id in (select id from public.profiles where user_id = auth.uid()));

drop policy if exists "Anyone can read public files from published profiles" on public.profile_files;
create policy "Anyone can read public files from published profiles"
  on public.profile_files for select
  using (
    visibility = 'public'
    and exists (
      select 1 from public.profiles
      where id = profile_files.profile_id
        and is_published = true
        and is_suspended = false
    )
  );

drop policy if exists "Authenticated can read members_only files" on public.profile_files;
create policy "Authenticated can read members_only files"
  on public.profile_files for select to authenticated
  using (
    visibility in ('public', 'members_only')
    and exists (
      select 1 from public.profiles
      where id = profile_files.profile_id
        and is_published = true
        and is_suspended = false
    )
  );

-- Storage RLS
drop policy if exists "Users upload own files" on storage.objects;
create policy "Users upload own files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users delete own files" on storage.objects;
create policy "Users delete own files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'profile-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Anyone view profile files" on storage.objects;
create policy "Anyone view profile files"
  on storage.objects for select to public
  using (bucket_id = 'profile-files');
