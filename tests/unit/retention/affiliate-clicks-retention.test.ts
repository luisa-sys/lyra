/**
 * SEC-74 — affiliate-click raw-event retention purge (UK-GDPR Art. 5(1)(e)).
 *
 * Behavioural coverage of the pure config/cutoff logic (no DB), plus structural
 * assertions locking the safety rails in the SQL function, the cron-route gate,
 * the disabled-by-default flag, and the vercel.json schedule wiring.
 */

import fs from 'fs';
import path from 'path';
import {
  DEFAULT_AFFILIATE_CLICKS_RETENTION_MONTHS,
  affiliateClicksRetentionMonths,
  affiliateClicksCutoff,
} from '@/lib/retention/affiliate-clicks';

const ROOT = path.join(__dirname, '..', '..', '..');
const ORIG = process.env.RETENTION_AFFILIATE_CLICKS_MONTHS;

afterEach(() => {
  if (ORIG === undefined) delete process.env.RETENTION_AFFILIATE_CLICKS_MONTHS;
  else process.env.RETENTION_AFFILIATE_CLICKS_MONTHS = ORIG;
});

describe('affiliateClicksRetentionMonths — config window', () => {
  test('defaults to 13 months (RETENTION_SCHEDULE.md proposal) when unset', () => {
    delete process.env.RETENTION_AFFILIATE_CLICKS_MONTHS;
    expect(DEFAULT_AFFILIATE_CLICKS_RETENTION_MONTHS).toBe(13);
    expect(affiliateClicksRetentionMonths()).toBe(13);
  });

  test('honours a valid override', () => {
    process.env.RETENTION_AFFILIATE_CLICKS_MONTHS = '24';
    expect(affiliateClicksRetentionMonths()).toBe(24);
  });

  test('falls back to the default (never a too-short/unsafe window) on blank or invalid input', () => {
    for (const bad of ['', '   ', 'abc', '0', '-5', 'NaN']) {
      process.env.RETENTION_AFFILIATE_CLICKS_MONTHS = bad;
      expect(affiliateClicksRetentionMonths()).toBe(13);
    }
  });

  test('floors a fractional override to a whole month count', () => {
    process.env.RETENTION_AFFILIATE_CLICKS_MONTHS = '13.9';
    expect(affiliateClicksRetentionMonths()).toBe(13);
  });
});

describe('affiliateClicksCutoff — always strictly in the past', () => {
  test('subtracts the given months from now', () => {
    const now = Date.UTC(2026, 6, 12, 3, 0, 0); // 2026-07-12T03:00:00Z
    const cutoff = affiliateClicksCutoff(13, now);
    // 13 months before 2026-07 is 2025-06.
    expect(cutoff.getUTCFullYear()).toBe(2025);
    expect(cutoff.getUTCMonth()).toBe(5); // June (0-indexed)
    expect(cutoff.getTime()).toBeLessThan(now);
  });

  test('the default window produces a cutoff comfortably in the past', () => {
    const now = Date.now();
    const cutoff = affiliateClicksCutoff(DEFAULT_AFFILIATE_CLICKS_RETENTION_MONTHS, now);
    expect(cutoff.getTime()).toBeLessThan(now);
  });
});

describe('SQL purge function — safety rails (structural)', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'supabase/migrations/20260712033000_sec74_affiliate_clicks_retention_purge.sql'),
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

  test('deletes only rows strictly older than the cutoff', () => {
    expect(sql).toMatch(/delete from public\.affiliate_clicks where created_at < cutoff/i);
  });

  test('EXECUTE revoked from public/anon/authenticated, granted to service_role only', () => {
    expect(sql).toMatch(/revoke execute on function public\.affiliate_clicks_purge_expired\(timestamptz\) from public, anon, authenticated/i);
    expect(sql).toMatch(/grant\s+execute on function public\.affiliate_clicks_purge_expired\(timestamptz\) to service_role/i);
  });
});

describe('retention cron route + flag (structural)', () => {
  const route = fs.readFileSync(
    path.join(ROOT, 'src/app/api/retention/cron/sweep/route.ts'),
    'utf8',
  );
  const flag = fs.readFileSync(path.join(ROOT, 'src/lib/retention/flags.ts'), 'utf8');

  test('flag is disabled by default (opt-in via RETENTION_ENABLED=true)', () => {
    expect(flag).toMatch(/process\.env\.RETENTION_ENABLED === 'true'/);
  });

  test('route 404s when retention is disabled', () => {
    expect(route).toMatch(/isRetentionEnabled\(\)/);
    expect(route).toMatch(/retention_disabled/);
    expect(route).toMatch(/status:\s*404/);
  });

  test('route requires the CRON_SECRET bearer, compared in constant time', () => {
    expect(route).toMatch(/CRON_SECRET/);
    expect(route).toMatch(/timingSafeStrEqual/);
    expect(route).toMatch(/status:\s*401/);
  });

  test('a job error is surfaced as a non-2xx (no false-green)', () => {
    expect(route).toMatch(/summary\.errors\.length > 0/);
    expect(route).toMatch(/status:\s*500/);
  });
});

describe('vercel.json — retention sweep scheduled', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

  test('registers the retention sweep cron', () => {
    const cron = (vercel.crons || []).find(
      (c: { path: string }) => c.path === '/api/retention/cron/sweep',
    );
    expect(cron).toBeDefined();
    expect(cron.schedule).toBe('0 3 * * 0');
  });
});
