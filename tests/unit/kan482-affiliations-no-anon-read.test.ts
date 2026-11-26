/**
 * KAN-482 — DPIA §2a rule AD-5 / risk R10: after every migration has run, NO
 * policy on public.school_affiliations may let the `anon` role read rows.
 *
 * Before 20261123140000 the shown-affiliations read policy had no `to`
 * clause, so the public anon key could list shown affiliations (with
 * postcodes) of every published profile, filtered by school, 1,000 rows per
 * request — an uncapped, unauthenticated "people at this school" list.
 *
 * Static replay of the migration corpus (migrations are applied via the
 * Supabase MCP after review, so there is no DB in CI). It models drop /
 * create / `alter policy … to …` in timestamp order, with SQL comments
 * stripped first so prose quoting a policy cannot satisfy it (CTL-039). The
 * stricter sibling invariant (anon-reachable policies must require
 * show_on_profile) lives in hidden-affiliations-public-read-rls.test.js.
 */

import fs from 'fs';
import path from 'path';
import { SRC } from '../support/source-paths';

const dir = path.join(__dirname, '..', '..', SRC.migrations);
const strip = (sql: string) => sql.replace(/--.*$/gm, '');

type Policy = { roles: string[]; canSelect: boolean; ownerGated: boolean; file: string };

/** Roles named in a `to …` clause; no clause means PUBLIC (anon included). */
function rolesOf(body: string): string[] {
  const m = body.match(/\bto\s+([a-z_,\s]+?)(?:\s+using\b|\s+with\s+check\b|$)/i);
  if (!m) return ['public'];
  return m[1].split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
}

function replay(files: string[]): Map<string, Policy> {
  const effective = new Map<string, Policy>();
  for (const file of files) {
    const sql = strip(fs.readFileSync(path.join(dir, file), 'utf8'));
    const re =
      /(drop policy if exists|create policy|alter policy)\s+"([^"]+)"\s+on\s+public\.school_affiliations([\s\S]*?);/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      const [, verb, name, body] = m;
      const v = verb.toLowerCase();
      if (v.startsWith('drop')) {
        effective.delete(name);
      } else if (v.startsWith('create')) {
        const hasFor = /\bfor\s+(select|all|insert|update|delete)\b/i.test(body);
        effective.set(name, {
          roles: rolesOf(body),
          canSelect: /\bfor\s+(select|all)\b/i.test(body) || !hasFor,
          ownerGated: /auth\.uid\(\)/i.test(body),
          file,
        });
      } else {
        const p = effective.get(name);
        if (p && /\bto\s+/i.test(body)) effective.set(name, { ...p, roles: rolesOf(body), file });
      }
    }
  }
  return effective;
}

const all = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const anonReaders = (eff: Map<string, Policy>) =>
  [...eff.entries()]
    .filter(([, p]) => p.canSelect && !p.ownerGated && p.roles.some((r) => r === 'anon' || r === 'public'))
    .map(([n, p]) => `"${n}" (${p.file})`);

describe('KAN-482 AD-5: school_affiliations is not readable by anon', () => {
  test('the replay sees the policy set (non-empty corpus, read policy present)', () => {
    // The owner policy "Manage own school affiliations" was created out of
    // band (no repo migration); on dev it is `to authenticated` (pg_policies,
    // read-only, 2026-11-23), so it cannot open anon reads either.
    expect(all.length).toBeGreaterThan(50);
    expect(replay(all).has('Anyone can read visible affiliations from published profiles')).toBe(true);
  });

  test('no policy in the final effective set lets anon / PUBLIC select rows', () => {
    expect(anonReaders(replay(all))).toEqual([]);
  });

  test('signed-in members keep the shown-affiliations read (autocomplete needs it)', () => {
    const p = replay(all).get('Anyone can read visible affiliations from published profiles');
    expect(p).toBeDefined();
    expect(p?.roles).toEqual(['authenticated']);
    expect(p?.canSelect).toBe(true);
  });

  test('positive control: before the KAN-482 migration, anon COULD read (the replay detects it)', () => {
    const before = all.filter((f) => f < '20261123140000');
    expect(anonReaders(replay(before))).toEqual([
      '"Anyone can read visible affiliations from published profiles" (20261113120000_hidden_affiliations_public_read_rls.sql)',
    ]);
  });
});
