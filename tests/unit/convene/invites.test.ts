/**
 * KAN-209 — Convene P5 (invites + RSVP) tests.
 *
 * Covers: ICS builder shape, allowlist gate, RSVP form gates,
 * repository token generation entropy.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');

// ─── ICS builder ────────────────────────────────────────────────────────

import { buildICS } from '@/lib/convene/invites/ics';

describe('buildICS (KAN-209)', () => {
  const base = {
    uid: 'gathering-test@checklyra.com',
    title: 'Coffee with Ben',
    startISO: '2026-06-01T10:00:00Z',
    endISO: '2026-06-01T11:00:00Z',
    organizerEmail: 'luisa@example.com',
    organizerName: 'Luisa',
    attendeeEmail: 'ben@example.com',
    attendeeName: 'Ben',
  };

  test('outputs RFC 5545 VCALENDAR shell', () => {
    const ics = buildICS(base);
    expect(ics).toMatch(/^BEGIN:VCALENDAR/);
    expect(ics).toMatch(/END:VCALENDAR$/);
    expect(ics).toMatch(/VERSION:2\.0/);
    expect(ics).toMatch(/METHOD:REQUEST/);
  });

  test('event includes DTSTART, DTEND, SUMMARY, UID', () => {
    const ics = buildICS(base);
    expect(ics).toMatch(/DTSTART:20260601T100000Z/);
    expect(ics).toMatch(/DTEND:20260601T110000Z/);
    expect(ics).toMatch(/SUMMARY:Coffee with Ben/);
    expect(ics).toMatch(/UID:gathering-test@checklyra\.com/);
  });

  test('organiser + attendee mailto with CN', () => {
    const ics = buildICS(base);
    expect(ics).toMatch(/ORGANIZER;CN="Luisa":mailto:luisa@example\.com/);
    expect(ics).toMatch(/ATTENDEE;CN="Ben";RSVP=TRUE:mailto:ben@example\.com/);
  });

  test('escapes commas, semicolons, newlines', () => {
    const ics = buildICS({ ...base, title: 'Tea, scones; biscuits\n— for two' });
    expect(ics).toMatch(/SUMMARY:Tea\\, scones\\; biscuits\\n— for two/);
  });

  test('uses CRLF line endings', () => {
    const ics = buildICS(base);
    expect(ics).toContain('\r\n');
  });

  test('description and location optional', () => {
    const noDesc = buildICS(base);
    expect(noDesc).not.toMatch(/DESCRIPTION/);
    const withDesc = buildICS({ ...base, description: 'A catch-up over flat whites' });
    expect(withDesc).toMatch(/DESCRIPTION:A catch-up over flat whites/);
  });
});

// ─── Resend send allowlist ──────────────────────────────────────────────

import { _internal } from '@/lib/convene/invites/email';
const { isAllowed } = _internal;

describe('Resend send allowlist (KAN-209)', () => {
  const orig = process.env.CONVENE_INVITE_ALLOWLIST;
  afterEach(() => {
    if (orig === undefined) delete process.env.CONVENE_INVITE_ALLOWLIST;
    else process.env.CONVENE_INVITE_ALLOWLIST = orig;
  });

  test('blocks all when allowlist unset', () => {
    delete process.env.CONVENE_INVITE_ALLOWLIST;
    expect(isAllowed('anyone@example.com')).toBe(false);
  });
  test('blocks all when allowlist empty string', () => {
    process.env.CONVENE_INVITE_ALLOWLIST = '';
    expect(isAllowed('anyone@example.com')).toBe(false);
  });
  test('wildcard "*" allows all', () => {
    process.env.CONVENE_INVITE_ALLOWLIST = '*';
    expect(isAllowed('anyone@example.com')).toBe(true);
  });
  test('exact match allows', () => {
    process.env.CONVENE_INVITE_ALLOWLIST = 'ben@example.com, alice@example.com';
    expect(isAllowed('ben@example.com')).toBe(true);
    expect(isAllowed('alice@example.com')).toBe(true);
  });
  test('case-insensitive match', () => {
    process.env.CONVENE_INVITE_ALLOWLIST = 'BEN@example.com';
    expect(isAllowed('ben@example.com')).toBe(true);
  });
  test('non-listed blocked', () => {
    process.env.CONVENE_INVITE_ALLOWLIST = 'ben@example.com';
    expect(isAllowed('eve@example.com')).toBe(false);
  });
});

// ─── Email templates ────────────────────────────────────────────────────

import {
  renderInviteSubject,
  renderInvitePlainText,
  renderInviteHtml,
} from '@/lib/convene/invites/templates';

describe('invite templates (KAN-209)', () => {
  const base = {
    hostName: 'Luisa Santos-Stephens',
    recipientName: 'Ben',
    gatheringTitle: 'Coffee at Caravan',
    gatheringType: 'coffee',
    startISO: '2026-06-01T10:00:00Z',
    endISO: '2026-06-01T11:00:00Z',
    venueLabel: 'Caravan — London',
    rsvpUrl: 'https://checklyra.com/r/abc123',
  };

  test('subject uses host first name + gathering title, no exclamation/emoji', () => {
    const subj = renderInviteSubject(base);
    expect(subj).toContain('Luisa');
    expect(subj).toContain('Coffee at Caravan');
    expect(subj).not.toMatch(/[!📅🎉]/);
  });

  test('plain text includes greeting, when, where, rsvp url', () => {
    const txt = renderInvitePlainText(base);
    expect(txt).toContain('Hi Ben');
    expect(txt).toContain('Coffee at Caravan');
    expect(txt).toContain('Caravan — London');
    expect(txt).toContain('https://checklyra.com/r/abc123');
  });

  test('html escapes hostile content', () => {
    const html = renderInviteHtml({ ...base, gatheringTitle: '<script>alert(1)</script>' });
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(html).toMatch(/&lt;script&gt;/);
  });

  test('html contains rsvp button', () => {
    const html = renderInviteHtml(base);
    expect(html).toMatch(/Respond to invite/);
    expect(html).toMatch(/href="https:\/\/checklyra\.com\/r\/abc123"/);
  });
});

// ─── repository — token generator ───────────────────────────────────────

import { generateRsvpToken } from '@/lib/convene/invites/repository';

describe('generateRsvpToken (KAN-209)', () => {
  test('returns a non-empty string', () => {
    const t = generateRsvpToken();
    expect(typeof t).toBe('string');
    expect(t.length).toBeGreaterThan(20);
  });

  test('uses URL-safe base64url alphabet (no /, +, padding)', () => {
    const t = generateRsvpToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t).not.toMatch(/[\/+=]/);
  });

  test('high entropy — 100 generations are all unique', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) tokens.add(generateRsvpToken());
    expect(tokens.size).toBe(100);
  });
});

// ─── /r/[token] page + form ────────────────────────────────────────────

describe('RSVP UI pages (KAN-209)', () => {
  const pagePath = path.join(ROOT, 'src/app/r/[token]/page.tsx');
  const formPath = path.join(ROOT, 'src/app/r/[token]/rsvp-form.tsx');
  const actionsPath = path.join(ROOT, 'src/app/r/[token]/actions.ts');

  test('all three files exist', () => {
    expect(fs.existsSync(pagePath)).toBe(true);
    expect(fs.existsSync(formPath)).toBe(true);
    expect(fs.existsSync(actionsPath)).toBe(true);
  });

  test('page is no-index (robots)', () => {
    const src = fs.readFileSync(pagePath, 'utf8');
    expect(src).toMatch(/robots:\s*\{\s*index:\s*false/);
  });

  test('page handles missing + expired tokens', () => {
    const src = fs.readFileSync(pagePath, 'utf8');
    expect(src).toMatch(/Invalid or expired/);
    expect(src).toMatch(/has expired/);
  });

  test('actions verifies token expiry server-side', () => {
    const src = fs.readFileSync(actionsPath, 'utf8');
    expect(src).toMatch(/tokenExpiresAt/);
    expect(src).toMatch(/has expired/);
  });

  test('form offers three response options', () => {
    const src = fs.readFileSync(formPath, 'utf8');
    expect(src).toMatch(/'accepted'/);
    expect(src).toMatch(/'declined'/);
    expect(src).toMatch(/'tentative'/);
  });
});
