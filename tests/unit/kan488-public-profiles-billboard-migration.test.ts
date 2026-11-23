/**
 * KAN-488 — the public_profiles view gains `billboard`, and nothing else
 * (spec v0.8 §10; SEC-104 / CTL-028: public surfaces read the view).
 *
 * A SQL-text test: this repo cannot apply a migration from jest, so the file
 * is checked for its shape. SQL comments are stripped before every match, so
 * the header prose (which names the forbidden columns and the rollback DROP)
 * cannot satisfy or trip an assertion (CLAUDE.md failure mode 2). Expected
 * column lists are literals written here (failure mode 10).
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');

function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

const file = readdirSync(MIGRATIONS).find((f) => /^20261123110000_kan488_public_profiles_billboard\.sql$/.test(f));
if (!file) throw new Error('KAN-488 migration not found');
const raw = readFileSync(join(MIGRATIONS, file), 'utf8');
const sql = stripSqlComments(raw);

/** The `p.<col>` list between SELECT and FROM of the view body. */
function viewColumns(body: string): string[] {
  const m = body.match(/create\s+or\s+replace\s+view\s+public\.public_profiles[\s\S]*?\bselect\b([\s\S]*?)\bfrom\s+public\.profiles\s+p\b/i);
  if (!m) throw new Error('view body not found');
  return m[1]
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c !== '');
}

describe('KAN-488 migration — public_profiles view adds billboard', () => {
  test('the comment stripper removes the header prose (the corpus is the SQL)', () => {
    expect(raw).toContain('slug_confirmed');
    expect(sql).not.toContain('slug_confirmed');
    expect(sql).toMatch(/create\s+or\s+replace\s+view/i);
  });

  test('columns are the SEC-104 seventeen in their original order, then billboard last', () => {
    expect(viewColumns(sql)).toEqual([
      'p.id',
      'p.user_id',
      'p.slug',
      'p.display_name',
      'p.headline',
      'p.bio_short',
      'p.city',
      'p.country',
      'p.avatar_url',
      'p.gift_voucher_hint',
      'p.section_visibility',
      'p.delivery_country_code',
      'p.updated_at',
      'p.is_homepage_example',
      'p.homepage_example_order',
      'p.is_published',
      'p.is_suspended',
      'p.billboard',
    ]);
  });

  test('the first seventeen match the SEC-104 view exactly (CREATE OR REPLACE may only append)', () => {
    const sec104 = stripSqlComments(
      readFileSync(join(MIGRATIONS, '20260811210000_sec104_public_profiles_view.sql'), 'utf8'),
    );
    expect(viewColumns(sql).slice(0, 17)).toEqual(viewColumns(sec104));
  });

  test('keeps security_invoker and the published + not-suspended predicate', () => {
    expect(sql).toMatch(/public\.public_profiles\s+with\s*\(\s*security_invoker\s*=\s*on\s*\)\s+as/i);
    expect(sql).toMatch(/where\s+p\.is_published\s*=\s*true\s+and\s+p\.is_suspended\s*=\s*false\s*;/i);
  });

  test('never exposes identity-workflow or KAN-153 columns', () => {
    for (const col of [
      'slug_confirmed',
      'first_published_at',
      'phone_search_hash',
      'postcode_search_hash',
      'discoverable_by_phone',
      'discoverable_by_postcode',
      'is_admin',
      'suspension_reason',
    ]) {
      expect(sql).not.toContain(col);
    }
  });

  test('grants SELECT to the three roles and revokes writes, naming roles (no FROM PUBLIC)', () => {
    expect(sql).toMatch(/grant\s+select\s+on\s+public\.public_profiles\s+to\s+anon\s*,\s*authenticated\s*,\s*service_role\s*;/i);
    expect(sql).toMatch(
      /revoke\s+insert\s*,\s*update\s*,\s*delete\s*,\s*truncate\s+on\s+public\.public_profiles\s+from\s+anon\s*,\s*authenticated\s*;/i,
    );
    expect(sql).not.toMatch(/from\s+public\s*;/i);
  });

  test('is not destructive: no DROP in the executable SQL; the rollback lives in the header', () => {
    expect(sql).not.toMatch(/\bdrop\b/i);
    expect(raw).toMatch(/^-- Rollback/m);
    expect(raw).toMatch(/^--\s+DROP VIEW public\.public_profiles;/m);
  });
});
