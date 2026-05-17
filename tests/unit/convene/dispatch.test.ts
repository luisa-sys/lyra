/**
 * KAN-209 P5 part 2 — invite dispatcher tests.
 *
 * Covers the pure transformation step (buildSendInputs) plus structural
 * checks on the cron route + vercel.json wiring. DB-touching paths
 * (loadContext, dispatchQueuedInvites) are exercised by the existing
 * smoke-test pattern (real MCP + Vercel) rather than mocked here — the
 * Supabase client surface is wide enough that mocking it would just be
 * testing the mock.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');

import { _internal } from '@/lib/convene/invites/dispatch';
const { buildSendInputs } = _internal;

describe('buildSendInputs (KAN-209)', () => {
  const ctx = {
    recipientEmail: 'ben@example.com',
    recipientName: 'Ben Stephens',
    rsvpToken: 'tok_abc123',
    rsvpExpires: '2026-07-01T00:00:00Z',
    gatheringId: '11111111-1111-1111-1111-111111111111',
    gatheringTitle: 'Coffee at Caravan',
    gatheringType: 'coffee',
    startISO: '2026-06-01T10:00:00Z',
    endISO: '2026-06-01T11:00:00Z',
    venueLabel: 'Caravan — London',
    hostUserId: '22222222-2222-2222-2222-222222222222',
    hostEmail: 'luisa@example.com',
    hostDisplayName: 'Luisa',
  };

  test('returns subject, html, plainText, icsContent + recipient', () => {
    const out = buildSendInputs(ctx);
    expect(out.to).toBe('ben@example.com');
    expect(out.subject).toContain('Coffee at Caravan');
    expect(out.plainText).toContain('https://checklyra.com/r/tok_abc123');
    expect(out.html).toContain('https://checklyra.com/r/tok_abc123');
    expect(out.icsContent).toMatch(/^BEGIN:VCALENDAR/);
    expect(out.icsContent).toMatch(/END:VCALENDAR$/);
  });

  test('ICS uid is stable per gathering', () => {
    const out = buildSendInputs(ctx);
    expect(out.icsContent).toContain(`UID:gathering-${ctx.gatheringId}@checklyra.com`);
  });

  test('ICS includes organizer + attendee mailtos', () => {
    const out = buildSendInputs(ctx);
    expect(out.icsContent).toContain('ORGANIZER;CN="Luisa":mailto:luisa@example.com');
    expect(out.icsContent).toContain('ATTENDEE;CN="Ben Stephens";RSVP=TRUE:mailto:ben@example.com');
  });

  test('from name marks origin as Lyra Convene', () => {
    const out = buildSendInputs(ctx);
    expect(out.fromName).toContain('Lyra Convene');
    expect(out.fromName).toContain('Luisa');
  });

  test('venueLabel optional — omitted ICS LOCATION when null', () => {
    const out = buildSendInputs({ ...ctx, venueLabel: null });
    expect(out.icsContent).not.toMatch(/LOCATION:/);
  });

  test('respects LYRA_SITE_URL override in plainText', () => {
    // Module reads LYRA_SITE_URL at import time, so re-require under a fresh env.
    jest.resetModules();
    process.env.LYRA_SITE_URL = 'https://staging.checklyra.com';
    const { _internal: fresh } = require('@/lib/convene/invites/dispatch');
    const out = fresh.buildSendInputs(ctx);
    expect(out.plainText).toContain('https://staging.checklyra.com/r/tok_abc123');
    delete process.env.LYRA_SITE_URL;
  });
});

// ─── cron route shape ──────────────────────────────────────────────────

describe('send-invites cron route (KAN-209)', () => {
  const routePath = path.join(ROOT, 'src/app/api/convene/cron/send-invites/route.ts');

  test('route file exists', () => {
    expect(fs.existsSync(routePath)).toBe(true);
  });

  test('gates on isConveneEnabled + CRON_SECRET', () => {
    const src = fs.readFileSync(routePath, 'utf8');
    expect(src).toMatch(/isConveneEnabled\(\)/);
    expect(src).toMatch(/CRON_SECRET/);
    expect(src).toMatch(/`Bearer \$\{expected\}`/);
  });

  test('delegates to dispatchQueuedInvites', () => {
    const src = fs.readFileSync(routePath, 'utf8');
    expect(src).toMatch(/dispatchQueuedInvites/);
  });

  test('declares maxDuration ≥ 30s', () => {
    const src = fs.readFileSync(routePath, 'utf8');
    const m = src.match(/maxDuration\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(30);
  });
});

// ─── vercel.json wiring ────────────────────────────────────────────────

describe('vercel.json crons (KAN-209)', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

  test('send-invites cron registered', () => {
    const paths = (cfg.crons ?? []).map((c: { path: string }) => c.path);
    expect(paths).toContain('/api/convene/cron/send-invites');
  });

  test('runs at sub-hourly cadence', () => {
    const entry = (cfg.crons ?? []).find(
      (c: { path: string }) => c.path === '/api/convene/cron/send-invites'
    );
    expect(entry).toBeDefined();
    // Schedule should contain a "*/N" minute pattern OR be "* * * * *".
    expect(entry.schedule).toMatch(/^(\*\/\d+|\*)\s/);
  });

  test('token-health cron preserved', () => {
    const paths = (cfg.crons ?? []).map((c: { path: string }) => c.path);
    expect(paths).toContain('/api/convene/cron/token-health');
  });
});
