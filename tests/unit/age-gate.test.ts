/**
 * KAN-319: age-verification publish gate (pure logic).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

describe('age gate is applied to BOTH web publish paths (KAN-319 review HIGH fix)', () => {
  // is_published is an allowlisted profile field, so updateProfileFields is a
  // second publish path alongside publishProfile. Both must carry the gate or
  // it's bypassable. Lock that here.
  const actions = readFileSync(
    resolve(__dirname, '../../src/app/dashboard/profile/actions.ts'),
    'utf-8',
  );
  it('publishProfile checks canPublishWithAge', () => {
    expect(actions).toMatch(/canPublishWithAge/);
  });
  it('updateProfileFields gates is_published on the age check', () => {
    expect(actions).toMatch(/sanitised\.is_published === true/);
    // isAgeVerificationRequired guards both paths → appears at least twice
    expect((actions.match(/isAgeVerificationRequired\(\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
