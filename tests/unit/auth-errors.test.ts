import { isEmailResendCooldown } from '@/app/(auth)/auth-errors';

describe('isEmailResendCooldown', () => {
  it('matches the Supabase per-email resend cooldown by code', () => {
    expect(isEmailResendCooldown({ code: 'over_email_send_rate_limit', message: 'x' })).toBe(true);
  });

  it('matches the "For security purposes" cooldown message (any wait time)', () => {
    expect(
      isEmailResendCooldown({
        message: 'For security purposes, you can only request this after 58 seconds.',
      }),
    ).toBe(true);
    expect(
      isEmailResendCooldown({ message: 'you can only request this after 12 seconds' }),
    ).toBe(true);
  });

  it('does NOT match unrelated auth errors', () => {
    expect(isEmailResendCooldown({ message: 'Invalid login credentials' })).toBe(false);
    expect(isEmailResendCooldown({ code: 'invalid_credentials', message: 'nope' })).toBe(false);
    expect(isEmailResendCooldown({ message: '' })).toBe(false);
  });

  it('is null/undefined-safe', () => {
    expect(isEmailResendCooldown(null)).toBe(false);
    expect(isEmailResendCooldown(undefined)).toBe(false);
  });
});
