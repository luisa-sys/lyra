/**
 * KAN-214 P10 — Twilio sender + SMS templates + channel routing tests.
 */

import { renderSmsBody } from '@/lib/convene/invites/sms-templates';
import { _internal as twilioInternal } from '@/lib/convene/invites/twilio';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');

describe('renderSmsBody (KAN-214)', () => {
  const base = {
    hostName: 'Luisa Santos-Stephens',
    recipientName: 'Ben',
    gatheringTitle: 'Coffee at Caravan',
    startISO: '2026-06-01T10:00:00Z',
    rsvpUrl: 'https://checklyra.com/r/abc123',
  };

  test('starts with greeting and host first name', () => {
    const body = renderSmsBody(base);
    expect(body).toContain('Hi Ben,');
    expect(body).toContain('Luisa would like to gather');
  });

  test('includes the title + short date + rsvp URL', () => {
    const body = renderSmsBody(base);
    expect(body).toContain('Coffee at Caravan');
    expect(body).toContain('https://checklyra.com/r/abc123');
  });

  test('truncates over-long titles to ~50 chars', () => {
    const longTitle = 'A truly extraordinary gathering of close friends and acquaintances in honour of a great occasion';
    const body = renderSmsBody({ ...base, gatheringTitle: longTitle });
    expect(body).toMatch(/…/);
  });

  test('omits greeting when no recipient name given', () => {
    const body = renderSmsBody({ ...base, recipientName: undefined });
    expect(body).not.toContain('Hi ,');
    expect(body.startsWith('Luisa would like to gather')).toBe(true);
  });
});

describe('Twilio allowlist gate (KAN-214)', () => {
  const orig = process.env.CONVENE_INVITE_SMS_ALLOWLIST;
  afterEach(() => {
    if (orig === undefined) delete process.env.CONVENE_INVITE_SMS_ALLOWLIST;
    else process.env.CONVENE_INVITE_SMS_ALLOWLIST = orig;
  });

  test('blocks all when allowlist unset', () => {
    delete process.env.CONVENE_INVITE_SMS_ALLOWLIST;
    expect(twilioInternal.isAllowed('+447777000111')).toBe(false);
  });

  test('blocks all when allowlist empty', () => {
    process.env.CONVENE_INVITE_SMS_ALLOWLIST = '';
    expect(twilioInternal.isAllowed('+447777000111')).toBe(false);
  });

  test('wildcard * allows all', () => {
    process.env.CONVENE_INVITE_SMS_ALLOWLIST = '*';
    expect(twilioInternal.isAllowed('+447777000111')).toBe(true);
  });

  test('exact match allows', () => {
    process.env.CONVENE_INVITE_SMS_ALLOWLIST = '+447777000111, +447777000222';
    expect(twilioInternal.isAllowed('+447777000111')).toBe(true);
    expect(twilioInternal.isAllowed('+447777000222')).toBe(true);
  });

  test('non-listed blocked', () => {
    process.env.CONVENE_INVITE_SMS_ALLOWLIST = '+447777000111';
    expect(twilioInternal.isAllowed('+447777999999')).toBe(false);
  });
});

describe('Twilio source structure (KAN-214)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/convene/invites/twilio.ts'), 'utf8');

  test('uses HTTP Basic auth with TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN', () => {
    expect(src).toMatch(/TWILIO_ACCOUNT_SID/);
    expect(src).toMatch(/TWILIO_AUTH_TOKEN/);
    expect(src).toMatch(/`Basic \$\{Buffer\.from\(`\$\{sid\}:\$\{token\}`\)\.toString\(['"]base64['"]\)\}`/);
  });

  test('reads TWILIO_SMS_FROM for SMS, TWILIO_WHATSAPP_FROM for WhatsApp', () => {
    expect(src).toMatch(/TWILIO_SMS_FROM/);
    expect(src).toMatch(/TWILIO_WHATSAPP_FROM/);
  });

  test("prefixes whatsapp From/To with 'whatsapp:'", () => {
    // The qualified prefix appears in both the From and To template literals.
    expect(src).toMatch(/`whatsapp:\$\{from\}`/);
    expect(src).toMatch(/`whatsapp:\$\{input\.to\}`/);
  });

  test('uses the Twilio /2010-04-01 Messages endpoint', () => {
    expect(src).toMatch(/api\.twilio\.com\/2010-04-01\/Accounts/);
    expect(src).toMatch(/Messages\.json/);
  });

  test('returns typed SendResult with not_in_allowlist / no_credentials / no_from_number / send_failed', () => {
    expect(src).toMatch(/not_in_allowlist/);
    expect(src).toMatch(/no_credentials/);
    expect(src).toMatch(/no_from_number/);
    expect(src).toMatch(/send_failed/);
  });

  test('carries an AbortSignal.timeout on the fetch', () => {
    expect(src).toMatch(/AbortSignal\.timeout/);
  });
});

describe('dispatch.ts channel routing (KAN-214)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/convene/invites/dispatch.ts'), 'utf8');

  test('imports twilio + sms-templates', () => {
    expect(src).toMatch(/from\s+['"]\.\/twilio['"]/);
    expect(src).toMatch(/from\s+['"]\.\/sms-templates['"]/);
  });

  test('queue scan now accepts email, sms, and whatsapp', () => {
    expect(src).toMatch(/\.in\(\s*['"]channel['"]\s*,\s*\[\s*['"]email['"]\s*,\s*['"]sms['"]\s*,\s*['"]whatsapp['"]/);
    expect(src).not.toMatch(/\.eq\(\s*['"]channel['"]\s*,\s*['"]email['"]/);
  });

  test('processOne branches on row.channel', () => {
    expect(src).toMatch(/row\.channel === ['"]sms['"]\s*\|\|\s*row\.channel === ['"]whatsapp['"]/);
    expect(src).toMatch(/row\.channel === ['"]email['"]/);
  });

  test('sms/whatsapp path calls sendTwilioMessage with buildSmsBody', () => {
    expect(src).toMatch(/sendTwilioMessage\(\{[\s\S]*?to: ctx\.recipientPhone/);
    expect(src).toMatch(/body: buildSmsBody\(ctx\)/);
  });

  test('email path still calls sendInviteEmail with buildSendInputs', () => {
    expect(src).toMatch(/sendInviteEmail\(buildSendInputs\(ctx\)\)/);
  });

  test('unknown channel marked failed', () => {
    expect(src).toMatch(/unsupported channel/);
  });

  test('loadContext pulls both email + phone in one query', () => {
    expect(src).toMatch(/\.in\(\s*['"]kind['"]\s*,\s*\[\s*['"]email['"]\s*,\s*['"]phone['"]\s*,\s*['"]whatsapp['"]\s*,\s*['"]imessage['"]/);
  });
});
