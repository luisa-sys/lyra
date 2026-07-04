/**
 * KAN-319: age-verification publish gate (pure logic).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isAgeVerificationRequired, canPublishWithAge, isAgeGatePaused } from '@/lib/age/gate';

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

describe('age-gate reversible PAUSE flag (KAN-404, fail-safe)', () => {
  const REQUIRED = { AGE_VERIFICATION_REQUIRED: 'true' } as unknown as NodeJS.ProcessEnv;

  it('REQUIRED=true + PAUSED=true → gate relaxed (verification not required, any status may publish)', () => {
    const env = {
      AGE_VERIFICATION_REQUIRED: 'true',
      AGE_GATE_PAUSED: 'true',
    } as unknown as NodeJS.ProcessEnv;
    expect(isAgeGatePaused(env)).toBe(true);
    expect(isAgeVerificationRequired(env)).toBe(false);
    // With the gate paused, an unverified profile may publish again.
    expect(canPublishWithAge('none', env)).toBe(true);
    expect(canPublishWithAge('failed', env)).toBe(true);
    expect(canPublishWithAge(null, env)).toBe(true);
  });

  it.each([
    ['empty string', ''],
    ['literal false', 'false'],
    ['one', '1'],
    ['undefined', undefined],
  ])('REQUIRED=true + PAUSED=%s → gate STAYS on (fail-safe default)', (_label, paused) => {
    const env = {
      AGE_VERIFICATION_REQUIRED: 'true',
      ...(paused === undefined ? {} : { AGE_GATE_PAUSED: paused }),
    } as unknown as NodeJS.ProcessEnv;
    expect(isAgeGatePaused(env)).toBe(false);
    expect(isAgeVerificationRequired(env)).toBe(true);
    expect(canPublishWithAge('none', env)).toBe(false);
    expect(canPublishWithAge('passed', env)).toBe(true);
  });

  it('default (REQUIRED=true, no PAUSED key at all) → gate on', () => {
    expect(isAgeGatePaused(REQUIRED)).toBe(false);
    expect(isAgeVerificationRequired(REQUIRED)).toBe(true);
    expect(canPublishWithAge('none', REQUIRED)).toBe(false);
  });

  it('isAgeGatePaused ignores env when REQUIRED is off (pause is meaningless without the gate)', () => {
    const env = { AGE_GATE_PAUSED: 'true' } as unknown as NodeJS.ProcessEnv;
    // Gate was never on → still off; pausing an off gate is a no-op.
    expect(isAgeVerificationRequired(env)).toBe(false);
    expect(canPublishWithAge('none', env)).toBe(true);
  });
});
