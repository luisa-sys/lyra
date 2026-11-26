/**
 * KAN-496 — "Check availability" for the CheckLyra ID (founder feedback
 * 2026-11-26). Covers the data-access helper, the migration's shape and the
 * field's copy. Expected strings are literals, not read from the subject.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { checkLyraIdAvailability } from '@/modules/profile/save-profile';
import { firstPublishedNote, lyraIdAvailableCopy, lyraIdTakenCopy } from '@/app/dashboard/profile/editor/lyra-id-field';

jest.mock('@/app/dashboard/profile/editor-actions', () => ({ checkLyraIdAvailable: jest.fn() }));

function client(result: { data: unknown; error: unknown }) {
  const rpc = jest.fn().mockResolvedValue(result);
  return { rpc, supabase: { rpc } as never };
}

describe('KAN-496 checkLyraIdAvailability', () => {
  test('a badly formed or reserved ID never reaches the database', async () => {
    const { rpc, supabase } = client({ data: 'available', error: null });
    expect(await checkLyraIdAvailability(supabase, 'ab')).toEqual({
      status: 'invalid',
      error: 'Your CheckLyra ID needs at least 3 characters.',
    });
    expect(await checkLyraIdAvailability(supabase, 'has space')).toEqual({
      status: 'invalid',
      error: 'Use only letters, numbers and underscores.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  test('asks lyra_id_availability with the lower-cased, trimmed ID', async () => {
    const { rpc, supabase } = client({ data: 'available', error: null });
    expect(await checkLyraIdAvailability(supabase, '  Luisa_S ')).toEqual({ status: 'available', id: 'luisa_s' });
    expect(rpc).toHaveBeenCalledWith('lyra_id_availability', { p_id: 'luisa_s' });
  });

  test('taken, database error and unexpected answers', async () => {
    expect(await checkLyraIdAvailability(client({ data: 'taken', error: null }).supabase, 'luisa')).toEqual({
      status: 'taken',
      id: 'luisa',
    });
    expect(await checkLyraIdAvailability(client({ data: null, error: { message: 'x' } }).supabase, 'luisa')).toEqual({
      status: 'error',
    });
    expect(await checkLyraIdAvailability(client({ data: 'maybe', error: null }).supabase, 'luisa')).toEqual({
      status: 'error',
    });
  });
});

describe('KAN-496 lyra_id_availability migration', () => {
  const dir = join(__dirname, '..', '..', 'supabase', 'migrations');
  const file = readdirSync(dir).find((f) => /_kan496_lyra_id_availability\.sql$/.test(f));
  const sql = readFileSync(join(dir, file as string), 'utf8').replace(/--.*$/gm, '');

  test('SECURITY DEFINER with a pinned empty search_path', () => {
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path to ''/i);
  });
  test('members only: refuses no session, revoked from anon, granted to authenticated', () => {
    expect(sql).toMatch(/v_uid is null then\s+raise exception/i);
    expect(sql).toMatch(/revoke all on function public\.lyra_id_availability\(text\) from public, anon, authenticated;/i);
    expect(sql).toMatch(/grant execute on function public\.lyra_id_availability\(text\) to authenticated;/i);
  });
  test('checks other profiles and their retired old addresses, never the caller', () => {
    expect(sql).toMatch(/from public\.profiles p\s+where lower\(p\.slug\) = v_id\s+and p\.user_id <> v_uid/i);
    expect(sql).toMatch(/from public\.profile_slug_history h[\s\S]*h\.old_slug_key = v_id\s+and p\.user_id <> v_uid/i);
  });
  test('read-only: no insert, update, delete or drop', () => {
    expect(sql).not.toMatch(/\b(insert|update|delete|drop)\b/i);
  });
});

describe('KAN-496 CheckLyra ID field copy', () => {
  test('available / taken', () => {
    expect(lyraIdAvailableCopy('luisa')).toBe('luisa is available. Save to make it yours.');
    expect(lyraIdTakenCopy('luisa')).toBe('luisa is already taken. Please try another.');
  });
  test('the locked note says when the profile was first published (UK date, London time)', () => {
    expect(firstPublishedNote('2026-08-01T08:45:05Z')).toBe('Your profile was first published on 1 August 2026.');
    expect(firstPublishedNote('2026-07-31T23:30:00Z')).toBe('Your profile was first published on 1 August 2026.');
    expect(firstPublishedNote(null)).toBeNull();
    expect(firstPublishedNote('not a date')).toBeNull();
  });
});
