'use server';

/**
 * Session-ending server actions shared across route segments.
 *
 * WHY THIS FILE EXISTS AT THE APP ROOT RATHER THAN IN A SEGMENT
 * -------------------------------------------------------------
 * KAN-415. `signOut` lived in `src/app/(auth)/actions.ts` and was imported by
 * `src/app/dashboard/page.tsx` — the last `no-cross-segment-app` violation, and
 * the one `.dependency-cruiser.cjs` recorded as "currently routed NOWHERE. It
 * needs an owner before this rule can flip."
 *
 * Sign-out is not an `(auth)` concern that the dashboard happens to borrow; it
 * is a session operation every authenticated segment needs. A segment is an
 * independent route tree, so shared code belongs above the segments, not inside
 * one of them — which is exactly what the rule tells you to create. The app
 * root already holds this shape (`consent-state.ts`, `footer.tsx`).
 *
 * ⚠️ IT MUST STAY IN THE APP TREE, AND IT MUST STAY `'use server'`.
 * The qa-sweep destructive denylist is keyed `file::functionName` on an
 * INVENTORIED action, and `qa-sweep/inventory.py` inventories only `'use
 * server'` functions. Moving this body into `src/modules/` — the reflex for
 * anything shared — would make the denylist key match nothing, and a key that
 * matches nothing is dead weight that `qa-sweep-inventory.test.js` rejects by
 * design. That is the same conclusion D7 reached for
 * `switchAccountAndContinue`, recorded in `qa-sweep/config.py`.
 *
 * So: shared, but shared WITHIN the app tree. Moving this file again means
 * updating the denylist key in the same commit — the key is path-anchored, and
 * `tests/scripts/qa-sweep-preflight.test.js` derives the true set from source
 * and fails if a session-ender is missing from it.
 */

import { createClient } from '@/modules/platform/supabase-server';
import { redirect } from 'next/navigation';

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return redirect('/');
}
