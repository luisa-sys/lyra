/**
 * SEC-74 — past-gathering retention purge (UK-GDPR Art. 5(1)(e)).
 *
 * Behavioural coverage of the pure config/cutoff logic (no DB), plus structural
 * assertions locking the safety rails in the SQL function and the sweep wiring.
 * The cron-route gate + disabled-by-default flag + vercel.json schedule are
 * shared infrastructure covered by affiliate-clicks-retention.test.ts.
 */

import fs from 'fs';
import path from 'path';
import { SRC } from '../../support/source-paths';
import {
  DEFAULT_GATHERINGS_RETENTION_MONTHS,
  gatheringsRetentionMonths,
  gatheringsCutoff,
} from '@/modules/account/retention/gatherings';

const ROOT = path.join(__dirname, '..', '..', '..');
const ORIG = process.env.RETENTION_GATHERINGS_MONTHS;

afterEach(() => {
  if (ORIG === undefined) delete process.env.RETENTION_GATHERINGS_MONTHS;
  else process.env.RETENTION_GATHERINGS_MONTHS = ORIG;
});

describe('gatheringsRetentionMonths — config window', () => {
  test('defaults to 12 months (RETENTION_SCHEDULE.md proposal) when unset', () => {
    delete process.env.RETENTION_GATHERINGS_MONTHS;
    expect(DEFAULT_GATHERINGS_RETENTION_MONTHS).toBe(12);
    expect(gatheringsRetentionMonths()).toBe(12);
  });

  test('honours a valid override', () => {
    process.env.RETENTION_GATHERINGS_MONTHS = '24';
    expect(gatheringsRetentionMonths()).toBe(24);
  });

  test('falls back to the default (never a too-short/unsafe window) on blank or invalid input', () => {
    for (const bad of ['', '   ', 'abc', '0', '-5', 'NaN']) {
      process.env.RETENTION_GATHERINGS_MONTHS = bad;
      expect(gatheringsRetentionMonths()).toBe(12);
    }
  });

  test('floors a fractional override to a whole month count', () => {
    process.env.RETENTION_GATHERINGS_MONTHS = '12.9';
    expect(gatheringsRetentionMonths()).toBe(12);
  });
});

describe('gatheringsCutoff — always strictly in the past', () => {
  test('subtracts the given months from now', () => {
    const now = Date.UTC(2026, 6, 17, 3, 0, 0); // 2026-07-17T03:00:00Z
    const cutoff = gatheringsCutoff(12, now);
    // 12 months before 2026-07 is 2025-07.
    expect(cutoff.getUTCFullYear()).toBe(2025);
    expect(cutoff.getUTCMonth()).toBe(6); // July (0-indexed)
    expect(cutoff.getTime()).toBeLessThan(now);
  });

  test('the default window produces a cutoff comfortably in the past', () => {
    const now = Date.now();
    const cutoff = gatheringsCutoff(DEFAULT_GATHERINGS_RETENTION_MONTHS, now);
    expect(cutoff.getTime()).toBeLessThan(now);
  });
});

describe('SQL purge function — safety rails (structural)', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, SRC.migrations20260717033000Sec74GatheringsRetentionPurge),
    'utf8',
  );

  test('is SECURITY DEFINER with a pinned search_path', () => {
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = public/i);
  });

  test('refuses a null cutoff and a non-past cutoff', () => {
    expect(sql).toMatch(/cutoff is null/i);
    expect(sql).toMatch(/cutoff >= now\(\)/i);
    expect(sql).toMatch(/raise exception/i);
  });

  test('anchors "past" on the effective event timestamp, not just created_at', () => {
    // The coalesce chain guarantees a still-upcoming gathering (future finalised
    // slot / target window) can never fall before an always-past cutoff.
    expect(sql).toMatch(
      /coalesce\(finalised_slot_end,\s*finalised_slot_start,\s*target_window_end,\s*target_window_start,\s*created_at\)\s*<\s*cutoff/i,
    );
    expect(sql).toMatch(/delete from public\.gatherings/i);
  });

  test('EXECUTE revoked from public/anon/authenticated, granted to service_role only', () => {
    expect(sql).toMatch(/revoke execute on function public\.gatherings_purge_expired\(timestamptz\) from public, anon, authenticated/i);
    expect(sql).toMatch(/grant\s+execute on function public\.gatherings_purge_expired\(timestamptz\) to service_role/i);
  });
});

describe('retention sweep — gatherings job wired in (structural)', () => {
  const sweep = fs.readFileSync(path.join(ROOT, SRC.sweep), 'utf8');

  test('the sweep orchestrator runs the gatherings retention job', () => {
    expect(sweep).toMatch(/runGatheringsRetention/);
  });

  test('a gatherings job error is captured in errors[] (never masked as success)', () => {
    expect(sweep).toMatch(/gatherings: unknown error/);
  });
});
