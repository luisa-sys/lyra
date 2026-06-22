/**
 * KAN-319: age-verification publish gate (pure logic).
 */
import { isAgeVerificationRequired, canPublishWithAge } from '@/lib/age/gate';

const OFF = {} as NodeJS.ProcessEnv;
const ON = { AGE_VERIFICATION_REQUIRED: 'true' } as unknown as NodeJS.ProcessEnv;

describe('age publish gate (KAN-319)', () => {
  it('switch off → any status may publish (gate is a no-op)', () => {
    expect(isAgeVerificationRequired(OFF)).toBe(false);
    expect(canPublishWithAge('none', OFF)).toBe(true);
    expect(canPublishWithAge('failed', OFF)).toBe(true);
    expect(canPublishWithAge(undefined, OFF)).toBe(true);
  });

  it('switch on → only age_status="passed" may publish', () => {
    expect(isAgeVerificationRequired(ON)).toBe(true);
    expect(canPublishWithAge('passed', ON)).toBe(true);
    expect(canPublishWithAge('none', ON)).toBe(false);
    expect(canPublishWithAge('pending', ON)).toBe(false);
    expect(canPublishWithAge('failed', ON)).toBe(false);
    expect(canPublishWithAge('manual_review', ON)).toBe(false);
    expect(canPublishWithAge(null, ON)).toBe(false);
  });
});
