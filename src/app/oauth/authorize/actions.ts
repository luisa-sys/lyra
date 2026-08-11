'use server';

/**
 * /oauth/authorize server actions — KAN-88 P3, thinned by KAN-415 D7 part 3.
 *
 * These are the two real server actions the consent screen's `<form>` elements
 * bind to. They hold no logic: each one awaits its counterpart in
 * `@/modules/oauth-as/consent-flow`, where the decisions live and can be
 * tested directly.
 *
 * The file stays because `<form action={…}>` needs a genuine server action, and
 * it stays THIN because a `'use server'` file may export only async functions
 * (gotcha #18) — a restriction enforced at action-invocation time rather than
 * at build time, so violating it ships green and 500s the first real
 * submission. Nothing that wants to export a type, a constant or a pure
 * function belongs in here.
 *
 * ⚠️ `switchAccountAndContinue` terminates the session one call frame below
 * this wrapper. Both the wrapper and the module function are on the qa-sweep
 * destructive denylist, for the reason already recorded there about
 * `inlineAction1`: denylisting only the innermost function leaves every caller
 * that reaches it exercisable.
 */

import {
  switchAccountAndContinue as switchAccountAndContinueFlow,
  submitConsent as submitConsentFlow,
  type DecideInput,
} from '@/modules/oauth-as/consent-flow';

/** Sign out and return to /login with this authorize request preserved. */
export async function switchAccountAndContinue(authorizePathWithQuery: string): Promise<void> {
  await switchAccountAndContinueFlow(authorizePathWithQuery);
}

/** Complete the authorization request with the user's Allow/Deny decision. */
export async function submitConsent(input: DecideInput): Promise<void> {
  await submitConsentFlow(input);
}
