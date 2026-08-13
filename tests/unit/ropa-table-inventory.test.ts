/**
 * SEC-117 — the ROPA's data-location inventory must not drift from the code.
 *
 * WHY
 * ---
 * The SAR export was missing 14 person-keyed tables, and `docs/compliance/ROPA.md`
 * named none of them either. That matters beyond the code: `DSAR_BREACH_COMPLAINTS.md`
 * points the operator at the ROPA as a locate-checklist, so a request worked by
 * hand had the same blind spot as the automated export — and a human working
 * from an incomplete checklist produces an incomplete response with no error to
 * warn them, exactly as the code did.
 *
 * Fixing the export alone would have left that second path broken. So the ROPA
 * now carries the inventory, and this test makes the two un-driftable: every
 * table in `src/modules/contracts/person-keyed-tables.ts` must appear in the document,
 * and every table the document names must exist in the manifest.
 *
 * Both directions matter. Only checking one lets the doc silently fall behind
 * (or grow entries for tables that no longer exist, which reads as coverage and
 * is worse than a gap).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PERSON_KEYED_TABLES,
  JOIN_KEYED_TABLES,
  DELIBERATELY_EXCLUDED,
} from '@/modules/contracts/person-keyed-tables';

const ROOT = resolve(__dirname, '../..');
const ROPA = 'docs/compliance/ROPA.md';

const ropa = () => readFileSync(resolve(ROOT, ROPA), 'utf-8');

const allManifestTables = () => [
  ...Object.keys(PERSON_KEYED_TABLES),
  ...Object.keys(JOIN_KEYED_TABLES),
  ...Object.keys(DELIBERATELY_EXCLUDED),
];

/** Table names the inventory section lists, read from the leading cell. */
function tablesNamedInRopa(): string[] {
  const doc = ropa();
  const start = doc.indexOf('## E. Data location inventory');
  if (start === -1) return [];
  const section = doc.slice(start);
  return [...section.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]);
}

describe('SEC-117: the ROPA inventory matches the SAR manifest', () => {
  it('has the inventory section at all', () => {
    // If the section is renamed or removed, every assertion below would pass
    // over an empty list — the vacuity this whole line of work exists to catch.
    expect(ropa()).toContain('## E. Data location inventory');
    expect(tablesNamedInRopa().length).toBeGreaterThan(25);
  });

  it('names every table the manifest knows about', () => {
    const named = new Set(tablesNamedInRopa());

    const missing = allManifestTables()
      .filter((t) => !named.has(t))
      .sort();

    // A table in the code but not the doc means the hand-worked DSAR path is
    // narrower than the automated one.
    expect(missing).toEqual([]);
  });

  it('names no table the manifest does not know about', () => {
    const known = new Set(allManifestTables());

    const stale = tablesNamedInRopa()
      .filter((t) => !known.has(t))
      .sort();

    // A doc entry for a table that no longer exists reads as coverage and is
    // worse than an omission, because nobody goes looking.
    expect(stale).toEqual([]);
  });

  it('marks every withheld table as withheld, with a lawful basis', () => {
    const doc = ropa();

    for (const table of Object.keys(DELIBERATELY_EXCLUDED)) {
      const row = doc
        .split('\n')
        .find((l) => l.startsWith(`| \`${table}\` |`));

      expect(row).toBeDefined();
      // "Not exported" without a reason is how a decision becomes an oversight.
      expect(row).toMatch(/withheld/i);
      expect(row).toMatch(/SEC-\d+|Art\.\s?17|credential|CSRF/);
    }
  });

  it('does not mark an exported table as withheld', () => {
    const doc = ropa();

    for (const table of Object.keys(PERSON_KEYED_TABLES)) {
      const row = doc.split('\n').find((l) => l.startsWith(`| \`${table}\` |`));
      expect(row).toBeDefined();
      // The inverse error: a row saying "withheld" for something the export
      // actually returns would mislead an operator answering a dispute.
      expect(row).not.toMatch(/withheld/i);
    }
  });
});
