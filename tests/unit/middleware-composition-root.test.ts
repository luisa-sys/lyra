/**
 * src/middleware.ts has no function body — KAN-415 D4 C8.
 *
 * This is the one property of the decomposition that no behavioural test can
 * express, because it is about what CANNOT be written rather than what happens.
 *
 * Through D5-D9 the neighbouring code gets rewritten repeatedly, and the
 * cheapest way to "just handle one more case" would be to open the middleware
 * and insert `if (x) return y;` above the pipeline. EVERY ORDERING TEST WOULD
 * STILL PASS — the gates would still run in order; they would simply no longer
 * be the only thing that runs. Nothing else in the suite can see that.
 *
 * With no body there is nowhere to put it, and adding one is a visible
 * structural change rather than a one-line edit.
 *
 * Verified at C8 that Next 16.2.12 accepts a non-function `middleware` export:
 * `npm run build` exits 0 and .next/server/middleware-manifest.json carries the
 * entry with its matcher and `server/src/middleware.js`. That was the one
 * Next-specific unknown in the plan, and it resolved in favour of the strong
 * shape rather than the documented fallback.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../');
const { SRC } = require('../support/source-paths.json');

/** Comments stripped — the header describes the very shapes this forbids. */
function code(): string {
  return fs
    .readFileSync(path.join(ROOT, SRC.middleware), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('the composition root cannot grow a body', () => {
  test('middleware is a const bound to the factory, not a function declaration', () => {
    const src = code();
    expect(src).toMatch(/export const middleware = createAccessMiddleware\(/);
    // The shape that would reopen the hole.
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+middleware/);
    expect(src).not.toMatch(/export\s+default\s+async\s+function/);
  });

  test('the only function declared here is the env reader', () => {
    // A second function would be somewhere for request logic to accumulate,
    // one helper at a time, without ever looking like a structural change.
    const declared = [...code().matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/g)].map((m) => m[1]);
    expect(declared).toEqual(['readMiddlewareEnv']);
  });

  test('the env reader returns a literal and nothing else', () => {
    // It must stay a plain data read. A conditional or an early return here is
    // request logic wearing a different hat.
    const src = code();
    const body = src.slice(src.indexOf('function readMiddlewareEnv'));
    const upToClose = body.slice(0, body.indexOf('\n}'));
    expect(upToClose).not.toMatch(/\bif\s*\(/);
    expect(upToClose).not.toMatch(/\breturn\b[\s\S]*\breturn\b/);
  });

  test('the route matcher is unchanged — it decides which requests exist at all', () => {
    // Not a refactor detail: a narrowed matcher silently un-gates whole route
    // trees, and nothing else in the suite would notice.
    expect(code()).toContain(
      "'/((?!_next/static|_next/image|favicon.ico|.*\\\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'",
    );
  });

  test('no gate logic is left here — the file imports the pipeline, it does not implement one', () => {
    const src = code();
    expect(src).toMatch(/from '@\/modules\/access\/pipeline'/);
    // Terminal responses are the pipeline's business now.
    expect(src).not.toMatch(/NextResponse\.(redirect|rewrite|json)/);
    expect(src).not.toMatch(/\.startsWith\(/);
  });
});
