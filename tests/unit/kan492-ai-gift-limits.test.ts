/**
 * KAN-492 — AI gift generation limits: 10 per editing session, 30 per member
 * in any rolling 30 days, 10-second cooldown kept (founder decision
 * 2026-11-25), and a note telling members about the limits.
 *
 * Static checks on supabase/migrations/20261125130000_kan492_ai_gift_limits.sql
 * (migrations are applied via the Supabase MCP after review, not by CI — same
 * approach as the KAN-489 suite). SQL comments are stripped before matching so
 * header prose can never satisfy an assertion. Expected values are LITERALS
 * from the founder decision, never read back from the code under test.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  AI_LIMITS_NOTE,
  AI_MONTHLY_GENERATIONS,
  AI_MONTHLY_LIMIT_COPY,
  AI_SESSION_GENERATIONS,
  AI_SESSION_LIMIT_COPY,
  aiCounterText,
  aiRemainingAfter,
  aiResultMessage,
} from '@/modules/profile/editor/ai-gifts-ui';

const raw = readFileSync(
  join(__dirname, '..', '..', 'supabase', 'migrations', '20261125130000_kan492_ai_gift_limits.sql'),
  'utf8',
);
const sql = raw.replace(/--.*$/gm, '');

describe('KAN-492 migration — claim_ai_gift_generation limits', () => {
  it('replaces the function with the same signature, SECURITY DEFINER and pinned search_path', () => {
    expect(sql).toMatch(
      /create\s+or\s+replace\s+function\s+public\.claim_ai_gift_generation\s*\(\s*p_session\s+uuid\s*,\s*p_consent_version\s+text\s*\)/i,
    );
    expect(sql).toMatch(/security\s+definer/i);
    expect(sql).toMatch(/set\s+search_path\s*=\s*public\s*,\s*pg_temp/i);
  });

  it('session cap is 10 and the rolling window cap is 30 over 30 days', () => {
    expect(sql).toMatch(/v_session_cap\s+constant\s+integer\s*:=\s*10\s*;/i);
    expect(sql).toMatch(/v_window_cap\s+constant\s+integer\s*:=\s*30\s*;/i);
    expect(sql).toMatch(/if\s+v_session\s*>=\s*v_session_cap\s+then/i);
    expect(sql).toMatch(/if\s+v_window\s*>=\s*v_window_cap\s+then/i);
    expect(sql).toMatch(/created_at\s*>\s*now\(\)\s*-\s*interval\s+'30 days'/i);
    expect(sql).not.toMatch(/interval\s+'24 hours'/i);
  });

  it('refuses with session_limit and monthly_limit; no daily_limit remains', () => {
    expect(sql).toMatch(/'reason'\s*,\s*'session_limit'/i);
    expect(sql).toMatch(/'reason'\s*,\s*'monthly_limit'/i);
    expect(sql).not.toMatch(/daily_limit|daily_remaining/i);
  });

  it('keeps the 10-second cooldown and the suspended-account refusal', () => {
    expect(sql).toMatch(/v_last\s*>\s*now\(\)\s*-\s*interval\s+'10 seconds'/i);
    expect(sql).toMatch(/'reason'\s*,\s*'suspended'/i);
  });

  it('locks the caller profile row from auth.uid()', () => {
    expect(sql).toMatch(/where\s+p\.user_id\s*=\s*auth\.uid\(\)\s+for\s+update/i);
  });

  it('returns session_remaining and monthly_remaining on success', () => {
    expect(sql).toMatch(/'session_remaining'\s*,\s*v_session_cap\s*-\s*\(\s*v_session\s*\+\s*1\s*\)/i);
    expect(sql).toMatch(/'monthly_remaining'\s*,\s*v_window_cap\s*-\s*\(\s*v_window\s*\+\s*1\s*\)/i);
  });

  it('keeps the grants: revoked from public/anon/authenticated, EXECUTE to authenticated only', () => {
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.claim_ai_gift_generation\(uuid,\s*text\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i,
    );
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.claim_ai_gift_generation\(uuid,\s*text\)\s+to\s+authenticated\s*;/i);
    expect(sql).not.toMatch(/to\s+anon/i);
  });

  it('documents a rollback in the header', () => {
    expect(raw).toMatch(/Rollback/);
  });
});

describe('KAN-492 editor copy and counter', () => {
  it('limits are 10 per session and 30 per 30 days', () => {
    expect(AI_SESSION_GENERATIONS).toBe(10);
    expect(AI_MONTHLY_GENERATIONS).toBe(30);
  });

  it('the note tells members both limits', () => {
    expect(AI_LIMITS_NOTE).toBe(
      'You can generate suggestions up to 10 times each time you edit your profile, and up to 30 times in any 30 days.',
    );
  });

  it('counter reads "n of 10 left this session" and clamps to 0..10', () => {
    expect(aiCounterText(10)).toBe('10 of 10 left this session');
    expect(aiCounterText(3)).toBe('3 of 10 left this session');
    expect(aiCounterText(12)).toBe('10 of 10 left this session');
    expect(aiCounterText(-1)).toBe('0 of 10 left this session');
  });

  it('limit messages name the new figures', () => {
    expect(AI_SESSION_LIMIT_COPY).toBe('You’ve used all 10 generations for this session.');
    expect(AI_MONTHLY_LIMIT_COPY).toBe('You’ve used all 30 generations for the last 30 days. Please try again later.');
    expect(aiResultMessage({ ok: false, reason: 'monthly_limit' })).toBe(AI_MONTHLY_LIMIT_COPY);
  });

  it('after a success the counter is the smaller of session and 30-day allowance', () => {
    const ok = { ok: true as const, inserted: [], droppedForCap: 0, droppedByFilter: 0 };
    expect(aiRemainingAfter(10, { ...ok, sessionRemaining: 9, monthlyRemaining: 2 })).toBe(2);
    expect(aiRemainingAfter(10, { ...ok, sessionRemaining: 4, monthlyRemaining: 20 })).toBe(4);
  });

  it('a monthly_limit refusal sets the counter to 0', () => {
    expect(aiRemainingAfter(7, { ok: false, reason: 'monthly_limit', sessionRemaining: 7 })).toBe(0);
  });
});
