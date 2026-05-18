/**
 * KAN-212 P8 — post-event loop tests.
 *
 * Structural-only — the actual sweep is exercised against the live dev
 * Supabase post-deploy. We verify shape: cron route gating, lib exports,
 * vercel.json schedule.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');

describe('post-event sweep library (KAN-212 P8)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/convene/post-event.ts'), 'utf8');

  test('exports runPostEventSweep + PostEventSummary type', () => {
    expect(src).toMatch(/export async function runPostEventSweep/);
    expect(src).toMatch(/export interface PostEventSummary/);
  });

  test('uses a 2-hour buffer past finalised_slot_end before completing', () => {
    expect(src).toMatch(/POST_EVENT_BUFFER_HOURS\s*=\s*2/);
    expect(src).toMatch(/POST_EVENT_BUFFER_HOURS \* 60 \* 60 \* 1000/);
  });

  test('only sweeps non-terminal states', () => {
    expect(src).toMatch(/\.in\(\s*['"]status['"]\s*,\s*\[\s*['"]live['"]\s*,\s*['"]rescheduled['"]\s*,\s*['"]awaiting_responses['"]/);
  });

  test('marks gatherings completed + writes gathering_completed audit', () => {
    expect(src).toMatch(/status:\s*['"]completed['"]/);
    expect(src).toMatch(/event_type:\s*['"]gathering_completed['"]/);
  });

  test('flips accepted invitees to attended', () => {
    expect(src).toMatch(/status:\s*['"]attended['"]/);
    expect(src).toMatch(/\.eq\(\s*['"]status['"]\s*,\s*['"]accepted['"]\s*\)/);
  });

  test('refreshes the relationship_signals materialised view', () => {
    expect(src).toMatch(/refresh_relationship_signals/);
    expect(src).toMatch(/view_refreshed/);
  });

  test('caps batch size to 100 per run', () => {
    expect(src).toMatch(/BATCH_SIZE\s*=\s*100/);
    expect(src).toMatch(/\.limit\(BATCH_SIZE\)/);
  });

  test('errors array collects per-row failures without crashing the sweep', () => {
    expect(src).toMatch(/summary\.errors\.push/);
    expect(src).toMatch(/catch \(e\)/);
  });

  test('idempotent: filters out already-completed rows via status whitelist', () => {
    expect(src).not.toMatch(/\.eq\(\s*['"]status['"]\s*,\s*['"]completed['"]/);
  });
});

describe('post-event cron route (KAN-212 P8)', () => {
  const p = path.join(ROOT, 'src/app/api/convene/cron/post-event/route.ts');
  test('route file exists', () => {
    expect(fs.existsSync(p)).toBe(true);
  });
  test('gates on isConveneEnabled + CRON_SECRET bearer', () => {
    const src = fs.readFileSync(p, 'utf8');
    expect(src).toMatch(/isConveneEnabled\(\)/);
    expect(src).toMatch(/`Bearer \$\{expected\}`/);
  });
  test('delegates to runPostEventSweep', () => {
    const src = fs.readFileSync(p, 'utf8');
    expect(src).toMatch(/runPostEventSweep\(\)/);
  });
  test('maxDuration ≥ 30s (refresh can take a while)', () => {
    const src = fs.readFileSync(p, 'utf8');
    const m = src.match(/maxDuration\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(30);
  });
});

describe('vercel.json post-event schedule (KAN-212 P8)', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  test('post-event cron registered', () => {
    const paths = (cfg.crons ?? []).map((c: { path: string }) => c.path);
    expect(paths).toContain('/api/convene/cron/post-event');
  });
  test('runs daily at 04:00 UTC (outside peak)', () => {
    const e = (cfg.crons ?? []).find(
      (c: { path: string }) => c.path === '/api/convene/cron/post-event'
    );
    expect(e?.schedule).toBe('0 4 * * *');
  });
});
