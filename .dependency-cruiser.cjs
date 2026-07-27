/**
 * .dependency-cruiser.cjs — KAN-425 (Modular Architecture, Phase 0 / F3)
 *
 * Three structural dependency rules, landed as a CI gate so the codebase
 * cannot regress while the rest of the modularisation programme runs.
 *
 *   no-module-to-app     nothing under src/lib/** may import src/app/**
 *   no-cross-segment-app src/app/<A> may not import src/app/<B>  (A !== B)
 *   no-circular          no import cycles
 *
 * SCOPE DISCIPLINE (KAN-425): only these three. The remaining six rules
 * (no-deep-module-import, no-undeclared-module-dep, app-routes-are-thin,
 * platform-is-a-leaf, edge-safe, backoffice-not-in-request-path) need
 * modules.json and land in KAN-415 C2. Do not add them here.
 *
 * SEVERITY IS A ROLL-OUT DIAL, NOT A WAY TO SILENCE A FINDING.
 * The gate ships at `warn` (violations are reported, the build stays green)
 * and flips to `error` (blocking) once the outstanding KAN-424 defects land
 * and develop is clean for a week. Override with DEPCRUISE_SEVERITY=error.
 * Never relax a rule's *definition* to make it pass — a violation is a
 * finding: fix it, or record it in the ticket.
 *
 * Run via `npm run depcruise` (see scripts/check-dependency-rules.sh).
 */

const fs = require('node:fs');
const path = require('node:path');

const SEVERITY = process.env.DEPCRUISE_SEVERITY === 'error' ? 'error' : 'warn';

/** Escape a literal string for safe embedding in a regular expression. */
const rx = (literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Top-level src/app segments, read from disk.
 *
 * WHY GENERATED, AND NOT ONE RULE WITH A BACKREFERENCE:
 * dependency-cruiser interpolates a `from.path` capture group into `to.pathNot`
 * as RAW regex source — it does not escape it. Next.js segment directories are
 * named with regex metacharacters (`[slug]`, `(auth)`, `(legal)`), so the
 * obvious single-rule form
 *
 *     from: { path: '^src/app/([^/]+)/' }
 *     to:   { path: '^src/app/([^/]+)/', pathNot: '^src/app/$1/' }
 *
 * expands `$1` to `[slug]` — a character class matching one of s/l/u/g — and
 * `(auth)` — a capture group matching the bare word `auth`. Neither matches its
 * own directory, so every same-segment import is reported as a cross-segment
 * violation. That is a false positive, and a gate that cries wolf gets ignored.
 *
 * Generating one rule per segment with an escaped literal is exact. It is also
 * self-maintaining: add a segment directory and it is covered on the next run,
 * with no config edit and no way to forget.
 */
const APP_SEGMENTS = (() => {
  // Resolved from cwd, not __dirname: every path in these rules is cwd-relative
  // (that is how dependency-cruiser matches), and it lets the guard's test suite
  // point the same config at a fixture tree.
  const appDir = path.join(process.cwd(), 'src', 'app');
  if (!fs.existsSync(appDir)) return [];
  return fs
    .readdirSync(appDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
})();

const crossSegmentRules = APP_SEGMENTS.map((segment) => ({
  name: `no-cross-segment-app/${segment}`,
  severity: SEVERITY,
  comment:
    'One top-level src/app segment must not import from another. Segments are independent ' +
    'route trees; a cross-segment edge silently couples two features so neither can be ' +
    'changed or extracted alone. Promote the shared code to src/lib/ (or a shared component ' +
    'module) and let both segments depend on that instead.',
  from: { path: `^src/app/${rx(segment)}/` },
  to: {
    path: '^src/app/[^/]+/',
    pathNot: `^src/app/${rx(segment)}/`,
  },
}));

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-module-to-app',
      severity: SEVERITY,
      comment:
        'A library under src/lib/** must not import from a route tree under src/app/**. ' +
        'Libraries are the stable core; route folders are the churn surface. An edge in this ' +
        'direction means shared logic is owned by a page — which is how the access-transition ' +
        'matrix ended up living in the admin console (KAN-424, Defect 1). Move the shared code ' +
        'into src/lib/ and have the route import it, never the reverse.',
      from: { path: '^src/lib/' },
      to: { path: '^src/app/' },
    },
    ...crossSegmentRules,
    {
      name: 'no-circular',
      severity: SEVERITY,
      comment:
        'No import cycles. A cycle means neither module can be understood, tested or extracted ' +
        'on its own, and it makes module-init order load-bearing. Break it by moving the shared ' +
        'declarations into a third module that both sides import.',
      from: {},
      to: { circular: true },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },

    // Only our own first-party source is in scope for these rules.
    exclude: {
      path: '(^|/)node_modules/|^\\.next/|^tests/|\\.test\\.(ts|tsx|js|jsx|cjs|mjs)$',
    },

    // Resolve the "@/*" -> "./src/*" alias exactly as Next/tsc does, so an
    // aliased import is seen as the same edge as a relative one.
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,

    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },

    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
