/**
 * A TYPE-LEVEL guard: an authed gate must not be placeable in the pre-auth
 * pipeline. KAN-415 D4 C9 (CTL-045).
 *
 * This file contains no runtime assertions and is never executed. It is checked
 * by `npm run type-check` (tsc --noEmit), which tsconfig includes.
 *
 * `@ts-expect-error` is the instrument: it fails the build if the error it
 * expects DISAPPEARS. So if someone changes `Gate.run` from a property to a
 * method shorthand — which silently makes TypeScript check the parameter
 * bivariantly and lets an authed gate into the pre-auth array — this file goes
 * red, rather than the guarantee evaporating in silence.
 *
 * Verified empirically at C4: property form -> 1 compile error, shorthand -> 0.
 * The difference is invisible in review; nothing about the code reads
 * differently afterwards. That is exactly why it is pinned twice, here and by a
 * source assertion in access-pipeline.test.ts.
 */
import type { AuthedContext, EdgeContext } from '@/modules/access/context';
import type { Gate } from '@/modules/access/gate';

const authedGate: Gate<AuthedContext> = {
  id: 'type-probe',
  ticket: 'KAN-415',
  why: 'A gate that reads auth state, used only to prove it cannot run pre-auth.',
  run: (ctx) => {
    // Reaching for `user` is what makes this genuinely an authed gate rather
    // than one that merely claims to be.
    void ctx.user;
    return null;
  },
};

// @ts-expect-error An authed gate must NOT be assignable to a pre-auth pipeline.
const misordered: readonly Gate<EdgeContext>[] = [authedGate];

void misordered;
