/**
 * KAN-407: 18+ self-declaration.
 *
 * Replaces tests/unit/age-gate.test.ts, which covered the provider age gate
 * (AGE_VERIFICATION_REQUIRED / canPublishWithAge) removed in this change.
 *
 * What matters here is the SHAPE of the guarantee, not that a checkbox exists:
 *   1. only an explicit tick counts (fail closed on anything ambiguous),
 *   2. the declaration gates BOTH sign-up paths — the Google path is the one a
 *      naive implementation leaves open,
 *   3. it is recorded exactly once, and
 *   4. it never blocks sign-in if the lookup itself fails.
 */
import fs from 'fs';
import path from 'path';
import {
  isAgeDeclared,
  AGE_DECLARATION_FIELD,
  AGE_DECLARATION_COOKIE,
  AGE_DECLARATION_REQUIRED_MESSAGE,
} from '@/lib/age/self-declaration';

const root = path.join(__dirname, '../..');

describe('isAgeDeclared — fails closed', () => {
  it('accepts an explicitly ticked checkbox', () => {
    expect(isAgeDeclared('on')).toBe(true);
    expect(isAgeDeclared('true')).toBe(true);
  });

  it('rejects absent / blank / malformed values', () => {
    // A stripped or malformed field must never read as a declaration.
    for (const v of [null, undefined, '', ' ', 'off', 'false', '1', 'yes', 'ON', 'TRUE']) {
      expect(isAgeDeclared(v as never)).toBe(false);
    }
  });
});

describe('constants are shared, not restated', () => {
  it('exports a stable field + cookie name', () => {
    // The form, both server actions and the post-login chokepoint all key off
    // these; a literal drifting in one place would silently break the gate.
    expect(AGE_DECLARATION_FIELD).toBe('age_confirm');
    expect(AGE_DECLARATION_COOKIE).toBe('lyra_age_18');
    expect(AGE_DECLARATION_REQUIRED_MESSAGE).toMatch(/18 or over/i);
  });
});

describe('the declaration gates BOTH sign-up paths', () => {
  const form = fs.readFileSync(
    path.join(root, 'src/app/(auth)/signup/signup-form.tsx'),
    'utf8',
  );

  it('disables the Google button as well as the email submit', () => {
    // The trap this guards: gating only the email form leaves "Continue with
    // Google" as an undeclared account-creation route.
    expect(form).toContain('signInWithGoogle');
    expect(form.match(/disabled=\{!ageConfirmed\}/g) || []).toHaveLength(2);
  });

  it('posts the declaration on both forms', () => {
    expect(form.match(/name=\{AGE_DECLARATION_FIELD\}/g) || []).toHaveLength(2);
  });
});

describe('server-side enforcement (not just the UI)', () => {
  const actions = fs.readFileSync(path.join(root, 'src/app/(auth)/actions.ts'), 'utf8');

  it('signUp re-checks the declaration and refuses without it', () => {
    // Client state is an affordance; a hand-crafted POST must still be refused.
    expect(actions).toMatch(/isAgeDeclared\(formData\.get\(AGE_DECLARATION_FIELD\)\)/);
    expect(actions).toContain('AGE_DECLARATION_REQUIRED_MESSAGE');
  });

  it('signUp carries the declaration in user_metadata', () => {
    expect(actions).toContain('age_declared_18: true');
  });

  it('signInWithGoogle records the declaration but never requires it', () => {
    // /login shares this action. Requiring the field here would lock returning
    // users out of Google sign-in entirely.
    const googleFn = actions.slice(actions.indexOf('export async function signInWithGoogle'));
    // Sets the cookie (via the shared constant, not a literal)...
    expect(googleFn).toContain('AGE_DECLARATION_COOKIE');
    expect(googleFn).toContain('isAgeDeclared(formData?.get(AGE_DECLARATION_FIELD))');
    // ...but never turns a missing declaration into a rejection.
    expect(googleFn).not.toContain('AGE_DECLARATION_REQUIRED_MESSAGE');
  });
});

describe('recording + backstop at the shared chokepoint', () => {
  const chokepoint = fs.readFileSync(
    path.join(root, 'src/lib/auth/post-login-redirect.ts'),
    'utf8',
  );

  it('diverts an undeclared session to /confirm-age', () => {
    expect(chokepoint).toContain('/confirm-age');
  });

  it('degrades open — a failed lookup must not break sign-in', () => {
    // An attestation is not worth locking every user out of the product over.
    expect(chokepoint).toMatch(/try\s*\{[\s\S]*hasDeclaredAge[\s\S]*\}\s*catch/);
  });
});

describe('the declaration is not user-writable', () => {
  it('age_declared_18_at is absent from the profile-update allowlist', () => {
    // It is written by the service role only. If it ever became user-settable
    // the record would be worthless as evidence.
    const fields = fs.readFileSync(
      path.join(root, 'src/app/dashboard/profile/profile-fields.ts'),
      'utf8',
    );
    expect(fields).not.toContain('age_declared_18_at');
  });
});

// KAN-408 reverses KAN-407's removal: the provider (Didit) age check is
// re-introduced as an OPT-IN, environment-scoped switch (age_verification,
// default OFF). The self-declaration above remains the always-on baseline; the
// provider gate only enforces where an admin has turned the switch ON.
describe('the provider age gate is re-introduced as an opt-in switch (KAN-408)', () => {
  it('both publish paths consult the (switch-gated) provider age check', () => {
    const actions = fs.readFileSync(
      path.join(root, 'src/app/dashboard/profile/actions.ts'),
      'utf8',
    );
    expect((actions.match(/isProviderAgeCheckActive\(\)/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(actions).toContain('AGE_GATE_BLOCK_MESSAGE');
  });

  it('the old env-var gate module stays gone; the switch-gated module replaces it', () => {
    // gate.ts was the AGE_VERIFICATION_REQUIRED env-var gate — it stays deleted.
    expect(fs.existsSync(path.join(root, 'src/lib/age/gate.ts'))).toBe(false);
    // provider-gate.ts is the new switch-keyed gate.
    expect(fs.existsSync(path.join(root, 'src/lib/age/provider-gate.ts'))).toBe(true);
  });
});
