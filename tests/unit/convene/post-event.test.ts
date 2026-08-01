/**
 * KAN-212 P8 — post-event loop tests.
 *
 * Structural-only — the actual sweep is exercised against the live dev
 * Supabase post-deploy. We verify shape: cron route gating, lib exports,
 * vercel.json schedule.
 */

import fs from 'fs';
import path from 'path';
import { SRC } from '../../support/source-paths';

const ROOT = path.join(__dirname, '..', '..', '..');

describe('post-event sweep library (KAN-212 P8)', () => {
  // Five scans that sat here — the 2-hour buffer, the non-terminal filter, the
  // completed+audit write, the accepted-only invitee flip, and the view refresh
  // — now run rather than regex, in ./post-event-sweep-behaviour.test.ts.
  //
  // Worth recording WHY, because one mutation makes the case on its own.
  // Flipping the buffer from `Date.now() - …` to `+ …` would complete
  // gatherings that have not finished yet, marking people as having attended an
  // event still in progress:
  //
  //     behavioural -> RED        old scan -> 15/15 GREEN
  //
  // The literal `POST_EVENT_BUFFER_HOURS * 60 * 60 * 1000` is still present
  // after the flip, so the regex could never have seen it. A one-character bug
  // with real user-facing consequences, invisible to the check meant to guard it.
  //
  // The export-surface test below is deliberately KEPT: `PostEventSummary` is a
  // type, erased at runtime, so no behavioural test can prove it is exported.
  // (KAN-414 F4, KAN-417 §8 group 3.)

  const src = fs.readFileSync(path.join(ROOT, SRC.postEvent), 'utf8');

  test('exports runPostEventSweep + PostEventSummary type', () => {
    expect(src).toMatch(/export async function runPostEventSweep/);
    expect(src).toMatch(/export interface PostEventSummary/);
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
  const p = path.join(ROOT, SRC.postEventRoute);
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
