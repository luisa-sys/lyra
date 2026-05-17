/**
 * KAN-143 — Migration & integration-shape guard.
 *
 * Static checks that the visibility migration and the public profile page
 * stay in sync. These are file-content asserts, not DB-execution tests —
 * the migration is applied via the Supabase MCP after review (per CLAUDE.md
 * "Supabase Migration Rules").
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

describe('KAN-143 — profile_items visibility migration', () => {
  const migrationsDir = path.join(root, 'supabase/migrations');

  function findVisibilityMigration() {
    const files = fs.readdirSync(migrationsDir);
    const match = files.find((f) => /profile_items_visibility\.sql$/.test(f));
    expect(match).toBeDefined();
    return path.join(migrationsDir, match);
  }

  test('migration file exists with timestamped filename', () => {
    const filePath = findVisibilityMigration();
    expect(fs.existsSync(filePath)).toBe(true);
    // 14-digit timestamp prefix
    expect(path.basename(filePath)).toMatch(/^\d{14}_/);
  });

  test('migration adds the "draft" enum value', () => {
    const sql = fs.readFileSync(findVisibilityMigration(), 'utf8');
    expect(sql).toMatch(/alter type public\.visibility_level add value 'draft'/i);
  });

  test('migration is idempotent — guards the enum addition behind a "not exists" check', () => {
    const sql = fs.readFileSync(findVisibilityMigration(), 'utf8');
    expect(sql).toMatch(/if not exists/i);
    expect(sql).toMatch(/pg_enum/);
  });

  test('migration backfills NULL visibility to "public" (no behaviour change)', () => {
    const sql = fs.readFileSync(findVisibilityMigration(), 'utf8');
    expect(sql).toMatch(/update public\.profile_items[\s\S]*?set visibility = 'public'[\s\S]*?where visibility is null/i);
  });

  test('migration adds the new members_only RLS policy with auth.uid() guard', () => {
    const sql = fs.readFileSync(findVisibilityMigration(), 'utf8');
    expect(sql).toMatch(/create policy "Members can read members_only items from published profiles"/);
    expect(sql).toMatch(/auth\.uid\(\) is not null/i);
    expect(sql).toMatch(/visibility = 'members_only'/);
  });

  test('migration keeps the public-read policy (additive, not destructive)', () => {
    const sql = fs.readFileSync(findVisibilityMigration(), 'utf8');
    expect(sql).toMatch(/create policy "Anyone can read public items from published profiles"/);
    expect(sql).toMatch(/visibility = 'public'/);
  });

  test('migration does NOT drop the owner-all policy', () => {
    const sql = fs.readFileSync(findVisibilityMigration(), 'utf8');
    expect(sql).not.toMatch(/drop policy[^"]*"Users can manage own profile items"/i);
  });

  test('migration documents the column via COMMENT', () => {
    const sql = fs.readFileSync(findVisibilityMigration(), 'utf8');
    expect(sql).toMatch(/comment on column public\.profile_items\.visibility/i);
    expect(sql).toMatch(/public:/);
    expect(sql).toMatch(/members_only:/);
    expect(sql).toMatch(/draft:/);
  });
});

describe('KAN-143 — public profile page filters by visibility', () => {
  const pagePath = path.join(root, 'src/app/[slug]/page.tsx');
  const content = fs.readFileSync(pagePath, 'utf8');

  // KAN-234: filter helper switched to `isItemVisibleUnderHybridModel`
  // (resolves item.visibility against the section default before applying
  // the anonymous/authenticated test). The KAN-143 security guarantees are
  // preserved — defence in depth still runs application-side. The DB-level
  // `.in('visibility', …)` query filter is intentionally removed because
  // the hybrid model needs to fetch NULL-visibility rows too (they inherit
  // from the section default).
  test('imports the hybrid visibility filter (KAN-234 replaces KAN-143 filter)', () => {
    expect(content).toMatch(/import\s*{[^}]*isItemVisibleUnderHybridModel[^}]*}/);
  });

  test('checks viewer auth state before fetching items', () => {
    expect(content).toMatch(/auth\.getUser\(\)/);
    expect(content).toMatch(/isAuthenticated/);
  });

  test('references the two visibility levels viewers can see', () => {
    // 'draft' is never visible to viewers; the page renders 'public' for
    // anonymous and 'public'+'members_only' for authenticated. KAN-234
    // moved the filter from a DB query to an app-side call; the literal
    // strings still appear in the page for the allowed-visibility list
    // computation and for the section-default fallback.
    expect(content).toContain("'members_only'");
    expect(content).toContain("'public'");
  });

  test('applies application-level filter via the hybrid helper (defence in depth, KAN-234)', () => {
    expect(content).toMatch(/isItemVisibleUnderHybridModel\(/);
  });
});

describe('KAN-143 — items step UI exposes visibility selector', () => {
  const stepPath = path.join(root, 'src/app/dashboard/profile/steps/items-step.tsx');
  const content = fs.readFileSync(stepPath, 'utf8');

  test('renders a <select> for visibility on the add-item form', () => {
    expect(content).toMatch(/id=["']new-item-visibility["']/);
  });

  test('offers all three visibility levels in the UI', () => {
    expect(content).toContain("value: 'public'");
    expect(content).toContain("value: 'members_only'");
    expect(content).toContain("value: 'draft'");
  });

  test('does NOT offer the legacy "private" value as a write target', () => {
    // The wizard must not let new items be created as 'private'. Existing
    // rows with that value still render (coerced to draft on display), but
    // it's not a selectable option.
    expect(content).not.toMatch(/value:\s*['"]private['"]/);
  });

  test('default visibility for new items is "" (inherit from section default — KAN-234)', () => {
    // KAN-234: new items default to '' (inherit) so they pick up whatever
    // the user has set as the section visibility default. Existing items
    // keep their stored value. Pre-KAN-234 this defaulted to 'public'.
    expect(content).toMatch(/useState<string>\(['"]['"]\)/);
  });

  test('exposes an onUpdateVisibility callback so existing items can be re-classified', () => {
    expect(content).toContain('onUpdateVisibility');
  });
});

describe('KAN-143 — actions.ts wiring', () => {
  const actionsPath = path.join(root, 'src/app/dashboard/profile/actions.ts');
  const content = fs.readFileSync(actionsPath, 'utf8');

  test('imports coerceVisibility from the sibling module (not inlined in the use-server file)', () => {
    // Per BUGS-12: 'use server' files can only export async functions, so
    // constants and helpers must live in a sibling .ts module.
    expect(content).toMatch(/from\s+['"]\.\/visibility['"]/);
    expect(content).toContain('coerceVisibility');
  });

  test('exports updateProfileItemVisibility as an async function', () => {
    expect(content).toMatch(/export async function updateProfileItemVisibility/);
  });

  test('addProfileItem coerces visibility through the shared helper', () => {
    // No more raw `data.visibility || 'public'` — that would let an attacker
    // write any string into the column.
    //
    // KAN-234: the pattern is now wrapped in a ternary so empty/null values
    // become NULL (= inherit from section). The security guarantee is
    // unchanged: any non-empty value flows through coerceVisibility, which
    // rejects strings outside the allowlist.
    expect(content).toMatch(/coerceVisibility\(data\.visibility\)/);
    expect(content).not.toMatch(/visibility:\s*data\.visibility\s*\|\|\s*['"]public['"]/);
  });
});
