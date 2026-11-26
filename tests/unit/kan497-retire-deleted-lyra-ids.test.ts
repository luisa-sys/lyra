/**
 * KAN-497 — a deleted account's CheckLyra ID is retired forever (founder
 * decision 2026-11-26). Migration-shape checks; the behaviour was verified on
 * dev when the migration was applied (see the PR).
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const dir = join(__dirname, '..', '..', 'supabase', 'migrations');
const file = readdirSync(dir).find((f) => /_kan497_retire_deleted_lyra_ids\.sql$/.test(f));
const sql = readFileSync(join(dir, file as string), 'utf8').replace(/--.*$/gm, '');

function fnBody(name: string): string {
  const m = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i'));
  expect(m).not.toBeNull();
  return (m as RegExpMatchArray)[0];
}

describe('KAN-497 retired_lyra_ids table', () => {
  const table = (sql.match(/create table if not exists public\.retired_lyra_ids \(([\s\S]*?)\n\);/i) ?? [])[1] ?? '';

  test('holds the ID and a date only: no link to any person', () => {
    expect(table).toMatch(/id_key\s+text primary key/i);
    expect(table).toMatch(/retired_at\s+timestamptz/i);
    expect(table).not.toMatch(/user_id|profile_id|email|references/i);
  });

  test('RLS on, no policies, no grants to members or the public', () => {
    expect(sql).toMatch(/alter table public\.retired_lyra_ids enable row level security/i);
    expect(sql).not.toMatch(/create policy[\s\S]*retired_lyra_ids/i);
    expect(sql).toMatch(/revoke all on table public\.retired_lyra_ids from public, anon, authenticated/i);
  });
});

describe('KAN-497 retire on delete', () => {
  const body = fnBody('retire_lyra_ids_on_profile_delete');

  test('BEFORE DELETE on profiles, so slug history is still there to copy', () => {
    expect(sql).toMatch(
      /create trigger profiles_v08_retire_lyra_ids_on_delete before delete on public\.profiles\s+for each row execute function public\.retire_lyra_ids_on_profile_delete\(\)/i,
    );
  });

  test('retires the current ID only if the profile was ever published', () => {
    expect(body).toMatch(/if old\.first_published_at is not null/i);
    expect(body).toMatch(/values \(lower\(old\.slug\)\)/i);
  });

  test('retires every old address from profile_slug_history', () => {
    expect(body).toMatch(/select h\.old_slug_key\s+from public\.profile_slug_history h\s+where h\.profile_id = old\.id/i);
  });

  test('never fails a delete on a duplicate, and lets the delete go ahead', () => {
    expect((body.match(/on conflict \(id_key\) do nothing/gi) ?? []).length).toBe(2);
    expect(body).toMatch(/return old;/i);
  });

  test('SECURITY DEFINER, empty search_path, not callable by members', () => {
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path to ''/i);
    expect(sql).toMatch(/revoke all on function public\.retire_lyra_ids_on_profile_delete\(\) from public, anon, authenticated/i);
  });
});

describe('KAN-497 enforcement', () => {
  test('the anti-hijack guard refuses a retired ID, for confirmed IDs only, with the existing message', () => {
    const body = fnBody('enforce_lyra_id_not_retired');
    expect(body).toMatch(/new\.slug_confirmed\s+and exists \(\s*select 1 from public\.retired_lyra_ids r\s+where r\.id_key = lower\(new\.slug\)/i);
    expect(body).toMatch(/profile_slug_history h/i);
    expect(body).toMatch(/raise exception 'Retired CheckLyra ID' using errcode = '23505'/i);
  });

  test('"Check availability" answers taken for a retired ID', () => {
    const body = fnBody('lyra_id_availability');
    expect(body).toMatch(/if exists \(select 1 from public\.retired_lyra_ids r where r\.id_key = v_id\) then\s+return 'taken';/i);
    expect(sql).toMatch(/grant execute on function public\.lyra_id_availability\(text\) to authenticated/i);
  });
});

describe('KAN-497 privacy notice', () => {
  test('the Privacy page says the bare ID is kept, unlinked, and why', () => {
    const page = readFileSync(join(__dirname, '..', '..', 'src', 'app', '(legal)', 'privacy', 'page.tsx'), 'utf8');
    expect(page).toContain('Your CheckLyra ID after deletion:');
    expect(page).toContain('with nothing that links it to you');
    expect(page).toContain('legitimate interests');
  });
});
