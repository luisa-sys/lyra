/**
 * KAN-489 — the AI gift suggestions migration
 * (supabase/migrations/20261123120000_kan489_ai_gift_generations.sql):
 * the claim log, `claim_ai_gift_generation(uuid, text)`,
 * `insert_ai_gift_suggestions(jsonb)` and the `enforce_ai_gift_integrity()`
 * trigger (review fixes: consent recorded, suspended accounts refused, AI rows
 * cannot be forged or edited).
 *
 * Static checks on the SQL file, because migrations are applied via the
 * Supabase MCP after review rather than executed by CI (same approach as the
 * KAN-484 / KAN-485 / KAN-487 suites; there is no live-DB harness here — the
 * behavioural cases "6th claim refused", "3 approved + 10 asked → 7 stored"
 * and "pending rows invisible to anon" are for the lead's dev apply). SQL
 * comments are stripped before every match so the header prose can never
 * satisfy an assertion (CLAUDE.md failure mode 2) — except the rollback
 * check, which by design reads the raw header.
 *
 * Expected values (limits 5 / 20 / 10 s, cap 10, role lists, fixed column
 * values) are LITERALS from spec v0.8 §03, the KAN-489 plan and SEC-103,
 * never read back from the migration (failure mode 10).
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');

function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

const file = readdirSync(MIGRATIONS).find((f) => /^20261123120000_kan489_ai_gift_generations\.sql$/.test(f));
if (!file) throw new Error('KAN-489 migration not found');
const raw = readFileSync(join(MIGRATIONS, file), 'utf8');
const sql = stripSqlComments(raw);

function fnBlock(name: string): string {
  const start = sql.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'i'));
  if (start < 0) throw new Error(`function ${name} not found`);
  const end = sql.indexOf('$$;', start);
  if (end < 0) throw new Error(`function ${name} has no closing $$;`);
  return sql.slice(start, end + 3);
}

function fnHeader(block: string): string {
  return block.slice(0, block.indexOf('$$'));
}

function fnBody(block: string): string {
  return block.slice(block.indexOf('$$') + 2);
}

const claim = fnBlock('claim_ai_gift_generation');
const insert = fnBlock('insert_ai_gift_suggestions');
const integrity = fnBlock('enforce_ai_gift_integrity');
const integrityBody = fnBody(integrity);
const claimBody = fnBody(claim);
const insertBody = fnBody(insert);

// The claim signature was (uuid) before the review fix added the consent version.
const FUNCTIONS: ReadonlyArray<readonly [string, string]> = [
  ['claim_ai_gift_generation', 'uuid, text'],
  ['insert_ai_gift_suggestions', 'jsonb'],
];

describe('KAN-489 migration — the claim log table', () => {
  it('creates public.ai_gift_generations with the four columns', () => {
    const m = sql.match(/create\s+table\s+if\s+not\s+exists\s+public\.ai_gift_generations\s*\(([\s\S]*?)\);/i);
    expect(m).not.toBeNull();
    const cols = m![1];
    expect(cols).toMatch(/\bid\s+uuid\s+primary\s+key\s+default\s+gen_random_uuid\(\)/i);
    expect(cols).toMatch(/\bprofile_id\s+uuid\s+not\s+null\s+references\s+public\.profiles\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i);
    expect(cols).toMatch(/\bsession_id\s+uuid\s+not\s+null/i);
    expect(cols).toMatch(
      /\bconsent_version\s+text\s+not\s+null\s+check\s*\(\s*char_length\(consent_version\)\s+between\s+1\s+and\s+64\s*\)/i,
    );
    expect(cols).toMatch(/\bcreated_at\s+timestamptz\s+not\s+null\s+default\s+now\(\)/i);
  });

  it('enables row level security (R4 / INV-5)', () => {
    expect(sql).toMatch(/alter\s+table\s+public\.ai_gift_generations\s+enable\s+row\s+level\s+security\s*;/i);
  });

  it('has NO policy: members cannot read, write or delete their own claims', () => {
    expect(sql).not.toMatch(/create\s+policy/i);
  });

  it('revokes table access from public, anon and authenticated', () => {
    const m = sql.match(/revoke\s+all\s+on\s+table\s+public\.ai_gift_generations\s+from\s+([^;]+);/i);
    expect(m).not.toBeNull();
    expect(new Set(m![1].split(',').map((r) => r.trim().toLowerCase()))).toEqual(
      new Set(['public', 'anon', 'authenticated']),
    );
  });

  it('indexes (profile_id, created_at desc) and (profile_id, session_id)', () => {
    expect(sql).toMatch(/on\s+public\.ai_gift_generations\s*\(\s*profile_id\s*,\s*created_at\s+desc\s*\)/i);
    expect(sql).toMatch(/on\s+public\.ai_gift_generations\s*\(\s*profile_id\s*,\s*session_id\s*\)/i);
  });
});

describe('KAN-489 migration — function security posture', () => {
  it('declares exactly the three functions (corpus guard)', () => {
    // Was 2 before the review fix added the integrity trigger function.
    expect((sql.match(/create\s+or\s+replace\s+function/gi) ?? []).length).toBe(3);
    expect(claim.length).toBeGreaterThan(200);
    expect(insert.length).toBeGreaterThan(200);
  });

  it('claim is SECURITY DEFINER; insert is SECURITY INVOKER', () => {
    expect(fnHeader(claim)).toMatch(/\bsecurity\s+definer\b/i);
    expect(fnHeader(insert)).toMatch(/\bsecurity\s+invoker\b/i);
    expect(fnHeader(insert)).not.toMatch(/\bsecurity\s+definer\b/i);
  });

  it.each([claim, insert].map((b, i) => [FUNCTIONS[i][0], b] as const))('%s pins search_path to public, pg_temp', (_n, block) => {
    expect(fnHeader(block)).toMatch(/\bset\s+search_path\s*=\s*public\s*,\s*pg_temp\s*\n/i);
  });

  it.each(FUNCTIONS)('%s is revoked from public, anon and authenticated, then granted to authenticated only (gotcha #26)', (name, rawSig) => {
    const sig = rawSig.replace(', ', ',\\s*');
    const revoke = sql.match(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\(${sig}\\)\\s+from\\s+([^;]+);`, 'i'));
    expect(revoke).not.toBeNull();
    expect(new Set(revoke![1].split(',').map((r) => r.trim().toLowerCase()))).toEqual(
      new Set(['public', 'anon', 'authenticated']),
    );
    const grants = [...sql.matchAll(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${sig}\\)\\s+to\\s+([^;]+);`, 'gi'))];
    expect(grants.length).toBe(1);
    expect(grants[0][1].trim().toLowerCase()).toBe('authenticated');
  });

  it('nothing is granted to anon', () => {
    expect(sql).not.toMatch(/grant[^;]*\bto\s+[^;]*\banon\b/i);
  });

  it('both functions find the profile from auth.uid() and lock it FOR UPDATE', () => {
    for (const body of [claimBody, insertBody]) {
      expect(body).toMatch(/from\s+public\.profiles\s+p\s+where\s+p\.user_id\s*=\s*auth\.uid\(\)\s+for\s+update\s*;/i);
    }
  });

  it('no function writes profiles (profiles.updated_at is never bumped)', () => {
    expect(sql).not.toMatch(/update\s+public\.profiles/i);
    expect(sql).not.toMatch(/updated_at/i);
  });
});

describe('KAN-489 migration — claim_ai_gift_generation limits', () => {
  it('refuses a null session id', () => {
    expect(claimBody).toMatch(/if\s+p_session\s+is\s+null\s+then\s+raise\s+exception/i);
  });

  it('review fix — refuses a null, blank or over-64-character consent version, and records it on the claim row', () => {
    expect(claimBody).toMatch(
      /if\s+p_consent_version\s+is\s+null\s+or\s+btrim\(p_consent_version\)\s*=\s*''\s+or\s+char_length\(p_consent_version\)\s*>\s*64\s+then\s+raise\s+exception/i,
    );
    expect(claimBody).toMatch(
      /insert\s+into\s+public\.ai_gift_generations\s*\(\s*profile_id\s*,\s*session_id\s*,\s*consent_version\s*\)\s*values\s*\(\s*v_pid\s*,\s*p_session\s*,\s*p_consent_version\s*\)/i,
    );
  });

  it('review fix — a suspended account is refused before anything is counted or inserted', () => {
    expect(claimBody).toMatch(/coalesce\(p\.is_suspended\s*,\s*false\)\s+into\s+v_pid\s*,\s*v_suspended/i);
    expect(claimBody).toMatch(/if\s+v_suspended\s+then\s+return\s+jsonb_build_object\(\s*'ok'\s*,\s*false\s*,\s*'reason'\s*,\s*'suspended'\s*\)/i);
    const susp = claimBody.search(/'suspended'/);
    expect(susp).toBeGreaterThan(0);
    expect(susp).toBeLessThan(claimBody.search(/'session_limit'/));
  });

  it('5 per session: refuses at a count of 5 or more', () => {
    expect(claimBody).toMatch(/g\.session_id\s*=\s*p_session/i);
    expect(claimBody).toMatch(/if\s+v_session\s*>=\s*5\s+then\s+return\s+jsonb_build_object\(\s*'ok'\s*,\s*false\s*,\s*'reason'\s*,\s*'session_limit'/i);
  });

  it('20 per rolling 24 hours: refuses at 20 or more', () => {
    expect(claimBody).toMatch(/g\.created_at\s*>\s*now\(\)\s*-\s*interval\s+'24 hours'/i);
    expect(claimBody).toMatch(/if\s+v_daily\s*>=\s*20\s+then\s+return\s+jsonb_build_object\(\s*'ok'\s*,\s*false\s*,\s*'reason'\s*,\s*'daily_limit'/i);
  });

  it('10-second cooldown since the last claim', () => {
    expect(claimBody).toMatch(
      /if\s+v_last\s+is\s+not\s+null\s+and\s+v_last\s*>\s*now\(\)\s*-\s*interval\s+'10 seconds'\s+then\s+return\s+jsonb_build_object\(\s*'ok'\s*,\s*false\s*,\s*'reason'\s*,\s*'cooldown'/i,
    );
  });

  it('checks session, then daily, then cooldown, and only then inserts the claim', () => {
    const s = claimBody.search(/'session_limit'/);
    const d = claimBody.search(/'daily_limit'/);
    const c = claimBody.search(/'cooldown'/);
    const i = claimBody.search(/insert\s+into\s+public\.ai_gift_generations/i);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(d);
    expect(d).toBeLessThan(c);
    expect(c).toBeLessThan(i);
  });

  it('reports what is left after this claim', () => {
    expect(claimBody).toMatch(/'session_remaining'\s*,\s*5\s*-\s*\(\s*v_session\s*\+\s*1\s*\)/i);
    expect(claimBody).toMatch(/'daily_remaining'\s*,\s*20\s*-\s*\(\s*v_daily\s*\+\s*1\s*\)/i);
  });

  it('has no refund path (no delete from the claim log anywhere)', () => {
    expect(sql).not.toMatch(/delete\s+from\s+public\.ai_gift_generations/i);
  });
});

describe('KAN-489 migration — insert_ai_gift_suggestions', () => {
  it('takes an array of 1–10 objects with only title / description', () => {
    expect(insertBody).toMatch(/jsonb_typeof\(p_items\)\s*<>\s*'array'/i);
    expect(insertBody).toMatch(/if\s+v_n\s*<\s*1\s+or\s+v_n\s*>\s*10\s+then/i);
    expect(insertBody).toMatch(/k\.key\s+not\s+in\s*\(\s*'title'\s*,\s*'description'\s*\)/i);
  });

  it('counts held AI gift rows (pending AND approved) toward the cap of 10', () => {
    const m = insertBody.match(/select\s+count\(\*\)\s+into\s+v_held([\s\S]*?);/i);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/i\.origin\s*=\s*'ai'/i);
    expect(m![1]).toMatch(/i\.category\s*=\s*'gift_ideas'/i);
    expect(m![1]).not.toMatch(/approved/i);
    expect(insertBody).toMatch(/v_free\s*:=\s*greatest\(\s*0\s*,\s*10\s*-\s*v_held\s*\)/i);
    expect(insertBody).toMatch(/v_take\s*:=\s*least\(\s*v_free\s*,\s*v_n\s*\)/i);
    expect(insertBody).toMatch(/limit\s+v_take/i);
  });

  it('inserts with fixed values: gift_ideas, origin ai, approved false, visibility private, no url / group', () => {
    const m = insertBody.match(
      /insert\s+into\s+public\.profile_items\s*\(([^)]*)\)\s*values\s*\(([^;]*?)\)\s*returning/i,
    );
    expect(m).not.toBeNull();
    const cols = m![1].split(',').map((c) => c.trim());
    const vals = m![2].split(/,(?![^(]*\))/).map((v) => v.trim());
    expect(cols).toEqual(['profile_id', 'category', 'title', 'description', 'url', 'group_label', 'origin', 'approved', 'visibility']);
    const byCol = Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
    expect(byCol).toEqual({
      profile_id: 'v_pid',
      category: "'gift_ideas'",
      title: "v_item->>'title'",
      description: 'v_desc',
      url: 'null',
      group_label: 'null',
      origin: "'ai'",
      approved: 'false',
      visibility: "'private'",
    });
  });

  it('never updates or deletes profile_items (cannot overwrite member content)', () => {
    expect(insertBody).not.toMatch(/update\s+public\.profile_items/i);
    expect(insertBody).not.toMatch(/delete\s+from\s+public\.profile_items/i);
  });

  it('returns the inserted rows and how many did not fit', () => {
    expect(insertBody).toMatch(/'dropped_for_cap'\s*,\s*v_n\s*-\s*v_take/i);
  });
});

describe('KAN-489 migration — enforce_ai_gift_integrity (review fix: no forged or edited AI rows)', () => {
  it('is a BEFORE INSERT OR UPDATE row trigger on profile_items', () => {
    expect(sql).toMatch(
      /create\s+trigger\s+profile_items_ai_integrity\s+before\s+insert\s+or\s+update\s+on\s+public\.profile_items\s+for\s+each\s+row\s+execute\s+function\s+public\.enforce_ai_gift_integrity\(\)\s*;/i,
    );
  });

  it('pins search_path to empty, is not SECURITY DEFINER, and is granted to service_role only', () => {
    expect(fnHeader(integrity)).toMatch(/\bset\s+search_path\s+to\s+''/i);
    expect(fnHeader(integrity)).not.toMatch(/security\s+definer/i);
    const revoke = sql.match(/revoke\s+all\s+on\s+function\s+public\.enforce_ai_gift_integrity\(\)\s+from\s+([^;]+);/i);
    expect(revoke).not.toBeNull();
    expect(new Set(revoke![1].split(',').map((r) => r.trim().toLowerCase()))).toEqual(new Set(['public', 'anon', 'authenticated']));
    const grants = [...sql.matchAll(/grant\s+execute\s+on\s+function\s+public\.enforce_ai_gift_integrity\(\)\s+to\s+([^;]+);/gi)];
    expect(grants.map((g) => g[1].trim().toLowerCase())).toEqual(['service_role']);
  });

  it('forces every AI INSERT to approved false, visibility private, url null', () => {
    const m = integrityBody.match(/if\s+tg_op\s*=\s*'INSERT'\s+then([\s\S]*?)return\s+new\s*;\s*end\s+if\s*;/i);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/if\s+new\.origin\s*=\s*'ai'\s+then/i);
    expect(m![1]).toMatch(/new\.approved\s*:=\s*false\s*;/i);
    expect(m![1]).toMatch(/new\.visibility\s*:=\s*'private'\s*;/i);
    expect(m![1]).toMatch(/new\.url\s*:=\s*null\s*;/i);
  });

  it('refuses an origin change to or from ai', () => {
    expect(integrityBody).toMatch(
      /if\s+new\.origin\s+is\s+distinct\s+from\s+old\.origin\s+and\s+\(\s*old\.origin\s*=\s*'ai'\s+or\s+new\.origin\s*=\s*'ai'\s*\)\s+then\s+raise\s+exception/i,
    );
  });

  it('refuses edits to an AI row title, description, url, category or profile — but not approved / visibility', () => {
    const m = integrityBody.match(/if\s+old\.origin\s*=\s*'ai'\s+and\s*\(([\s\S]*?)\)\s*then\s+raise\s+exception/i);
    expect(m).not.toBeNull();
    const cols = [...m![1].matchAll(/new\.(\w+)\s+is\s+distinct\s+from\s+old\.(\w+)/gi)].map((x) => {
      expect(x[1]).toBe(x[2]);
      return x[1].toLowerCase();
    });
    expect(cols.sort()).toEqual(['category', 'description', 'profile_id', 'title', 'url']);
  });
});

describe('KAN-489 migration — rollback', () => {
  it('the header carries the rollback block (raw file, comments included)', () => {
    expect(raw).toMatch(/--\s*Rollback \(manual\):/);
    expect(raw).toContain('--   drop function if exists public.insert_ai_gift_suggestions(jsonb);');
    // Was `claim_ai_gift_generation(uuid)` before the review fix.
    expect(raw).toContain('--   drop function if exists public.claim_ai_gift_generation(uuid, text);');
    expect(raw).toContain('--   drop trigger if exists profile_items_ai_integrity on public.profile_items;');
    expect(raw).toContain('--   drop function if exists public.enforce_ai_gift_integrity();');
    expect(raw).toContain('--   drop table if exists public.ai_gift_generations;');
  });
});
