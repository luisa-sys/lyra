/**
 * Anonymous users are redirected away from /dashboard.
 *
 * Lifted verbatim from src/middleware.ts.
 *
 * ⚠️ THE `const { user } = ctx;` DESTRUCTURE IS LOAD-BEARING, and not for
 * style. qa-sweep/inventory.py:344 derives the AUTHED prefix list with
 *
 *     !\\s*user\\s*&&([^;{}]{0,400}?)startsWith\\(\\s*'([^']+)'\\s*\\)
 *
 * That regex matches `!user && … startsWith('/dashboard')`. It does NOT match
 * `!ctx.user && …` — the `ctx.` prefix breaks `!\\s*user\\s*&&`.
 *
 * If it fails to match, `authed_prefixes` derives EMPTY, and inventory.py:686
 * raises SystemExit2 because an empty model "would flatter every coverage
 * number downstream" — taking tests/scripts/qa-sweep-inventory.test.js down
 * wholesale. One destructure is the entire difference.
 */
import { NextResponse } from 'next/server';
import type { AuthedContext } from '../context';
import type { Gate } from '../gate';

export const protectedRoute: Gate<AuthedContext> = {
  id: 'protected-route',
  ticket: 'KAN-30',
  why: 'An anonymous visitor must not reach the authenticated dashboard.',
  run: (ctx) => {
    const { user } = ctx;
    if (!user && ctx.request.nextUrl.pathname.startsWith('/dashboard')) {
      const url = ctx.request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
    return null;
  },
};
