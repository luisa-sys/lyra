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
 * Never relax a rule's *definition* to make it pass — a violation is a
 * finding: fix it, or record it in the ticket.
 *
 * SEVERITY IS NOW PER RULE (KAN-414 F3, 2026-07-29). A single global dial made
 * the whole gate hostage to its worst rule: two of the three rules have been at
 * zero violations for some time and could not go blocking because the third
 * could not. Measured on this branch:
 *
 *     no-module-to-app          0 violations  -> error (BLOCKING)
 *     no-circular               0 violations  -> error (BLOCKING), once
 *                                                BUGS-80's type-only cycle is
 *                                                fixed (it is, on this branch)
 *     no-cross-segment-app      4 violations  -> warn
 *
 * The 4 remaining cross-segment edges are NOT unrouted work being tolerated;
 * the plan assigns three of them elsewhere on purpose:
 *   - src/app/[slug]/page.tsx -> dashboard/profile/{section-visibility,
 *     manual-of-me-fields}.ts   are the D-4 privacy finding, moved into D8's
 *     acceptance criteria (plan §6 F2 note), not F2/F3 debt.
 *   - src/app/(legal)/about/page.tsx -> _marketing/sections.tsx  is implicated
 *     in KAN-422's DELETE list.
 *   - src/app/dashboard/page.tsx -> (auth)/actions.ts  is currently routed
 *     NOWHERE. It needs an owner before this rule can flip.
 *
 * So `no-cross-segment-app` flips to error when D8 and KAN-422 land and that
 * fourth edge has a home — not on a calendar date. DEPCRUISE_SEVERITY=error
 * still forces every rule to error for a local dry run.
 *
 * Run via `npm run depcruise` (see scripts/check-dependency-rules.sh).
 */

const fs = require('node:fs');
const path = require('node:path');

const FORCE_ERROR = process.env.DEPCRUISE_SEVERITY === 'error';

/**
 * Per-rule severity. A rule at zero violations should block; a rule with known,
 * ticketed, elsewhere-owned violations should warn. Collapsing both into one
 * dial means the cleanest rule gets no enforcement until the messiest one is
 * finished, which is how a gate spends months reporting and preventing nothing.
 */
const severityFor = (ruleAtZero) => (FORCE_ERROR || ruleAtZero ? 'error' : 'warn');

// Flipped to blocking 2026-07-29 (KAN-414 F3): measured 0 violations each.
const BLOCKING = true;
// Still warn: 4 violations, 3 of them owned by D8 / KAN-422, 1 unrouted.
const NOT_YET = false;

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
  severity: severityFor(NOT_YET),
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
      severity: severityFor(BLOCKING),
      comment:
        'Library code must not import from a route tree under src/app/**. ' +
        'Libraries are the stable core; route folders are the churn surface. An edge in this ' +
        'direction means shared logic is owned by a page — which is how the access-transition ' +
        'matrix ended up living in the admin console (KAN-424, Defect 1). Move the shared code ' +
        'into a library and have the route import it, never the reverse.',
      // ⚠️ THIS ANCHOR MUST SPAN EVERY LIBRARY ROOT, NOT JUST src/lib/.
      //
      // It read '^src/lib/' until 2026-08-09. The KAN-415 D1 extraction then
      // moved 28 files into src/modules/{platform,guards,observability,oauth-as}
      // — including every security guard and every Supabase client — and every
      // one of them silently left the scope of this BLOCKING rule. Nothing went
      // red, because the rule kept matching the files that had not moved.
      //
      // That is the defining failure of a path-anchored control: it does not
      // break when the tree moves, it QUIETLY COVERS LESS, and the emptier
      // src/lib gets over D2…D8 the less it guards while still printing a pass.
      // At the time of the fix src/lib held 87 files and src/modules 28; the
      // programme's whole direction of travel is to invert that ratio.
      //
      // tests/scripts/dependency-rules-cover-modules.test.js asserts this
      // pattern matches every library root declared in modules.json, so the
      // next extraction cannot narrow it again by accident.
      // Every library root modules.json declares, not just the two the first
      // fix happened to look at. The regression test found src/components/
      // (ui-kit) and src/middleware.ts were ALSO outside the rule — both
      // are library code by the same argument, and covering them adds zero
      // violations today. Widening on a guess would have left them out.
      from: { path: '^src/(lib|modules|components)/|^src/middleware\\.ts$' },
      to: { path: '^src/app/' },
    },
    ...crossSegmentRules,
    {
      name: 'no-circular',
      severity: severityFor(BLOCKING),
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
