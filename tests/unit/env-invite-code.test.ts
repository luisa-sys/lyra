/**
 * KAN-337 review — env.inviteCode() must trim.
 *
 * Every comparison site (/join route, signup page, signUp action,
 * resolveBetaAccess) trims its input before comparing, so the configured code
 * must be trimmed too — otherwise a LYRA_INVITE_CODE set with stray whitespace
 * would silently break the whole beta-invite flow.
 */
import { env } from '@/lib/env';

describe('KAN-337: env.inviteCode trimming', () => {
  const original = process.env.LYRA_INVITE_CODE;
  afterEach(() => {
    if (original === undefined) delete process.env.LYRA_INVITE_CODE;
    else process.env.LYRA_INVITE_CODE = original;
  });

  it('trims surrounding whitespace from a configured code', () => {
    process.env.LYRA_INVITE_CODE = '  ABC-123  ';
    expect(env.inviteCode()).toBe('ABC-123');
  });

  it('returns empty string (feature off) when unset', () => {
    delete process.env.LYRA_INVITE_CODE;
    expect(env.inviteCode()).toBe('');
  });

  it('collapses a whitespace-only value to empty (feature off)', () => {
    process.env.LYRA_INVITE_CODE = '   ';
    expect(env.inviteCode()).toBe('');
  });
});
