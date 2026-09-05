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
 * the whole gate hostage to its worst rule: two of the three rules were at zero
 * violations for some time and could not go blocking because the third could
 * not.
 *
 * ALL THREE RULES NOW BLOCK (KAN-415, 2026-08-14). Measured on this branch:
 *
 *     no-module-to-app          0 violations  -> error (BLOCKING)
 *     no-circular               0 violations  -> error (BLOCKING)
 *     no-cross-segment-app      0 violations  -> error (BLOCKING)
 *
 * The four cross-segment edges were cleared as the plan assigned them, not by
 * relaxing anything:
 *   - src/app/[slug]/page.tsx -> dashboard/profile/{section-visibility,
 *     manual-of-me-fields}.ts   were the D-4 privacy finding — cleared by D8.
 *   - src/app/(legal)/about/page.tsx -> _marketing/sections.tsx  was never a
 *     real cross-segment edge: `_marketing` is a Next.js PRIVATE folder, and
 *     the rule's definition was corrected to read segments the way Next does.
 *   - src/app/dashboard/page.tsx -> (auth)/actions.ts  was "routed NOWHERE".
 *     It has an owner now: `signOut` moved to src/app/session-actions.ts, the
 *     app root, because sign-out is not an (auth) concern the dashboard
 *     borrows — it is shared, and shared code belongs above the segments.
 *
 * ⚠️ THE CONTRAST CASE IS GONE, AND THAT IS WHY severityFor MOVED OUT.
 * `dependency-rules-severity.test.js` used to prove the dial genuinely varies by
 * asserting this rule was `warn` — evidence that depended on a rule being
 * UNFINISHED. With nothing left at NOT_YET, `severityFor` would have been
 * replaceable by `() => 'error'` with no test noticing, and the next rule landed
 * in reporting mode would have blocked on day one. The dial is now unit-tested
 * directly in scripts/depcruise-severity.cjs. DEPCRUISE_SEVERITY=error still
 * forces every rule to error for a local dry run, and is still one-way.
 *
 * Run via `npm run depcruise` (see scripts/check-dependency-rules.sh).
 */

const fs = require('node:fs');
const path = require('node:path');

// The severity dial lives in its own module so it can be tested directly rather
// than inferred from whichever rules are unfinished — see its header for why
// that mattered the moment the last rule reached zero.
//
// `NOT_YET` is deliberately NOT imported here: every rule is at zero, so it
// would be an unused binding. It still exists in the dial module as the
// vocabulary for landing the next rule in reporting mode, and both of its
// branches are asserted there, so it cannot rot while unused.
const { severityFor, BLOCKING } = require('./scripts/depcruise-severity.cjs');

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
    // A LEADING UNDERSCORE IS NEXT.JS FOR "NOT A ROUTE" (a private folder).
    // Next opts `_foo` out of routing entirely, so `src/app/_marketing/` is a
    // colocation directory, not a route segment — no URL maps to it and nothing
    // is served from it.
    //
    // This is a CORRECTION TO THE RULE'S DEFINITION, not a relaxation of it, and
    // the distinction matters because relaxing a rule to make it pass is
    // forbidden here. The rule's own stated rationale is "segments are
    // independent ROUTE TREES; a cross-segment edge silently couples two
    // features so neither can be changed or extracted alone." A private folder
    // is not a route tree and has no independent existence to protect — it is
    // shared code already, which is precisely what the rule tells you to create.
    // Reading directories off disk is what let a colocation folder become a
    // "segment"; the fix is to read them the way Next.js does.
    //
    // Measured: this removes exactly one violation,
    // src/app/(legal)/about/page.tsx -> src/app/_marketing/sections.tsx, which
    // was never a real cross-segment edge. The other violation is untouched and
    // the rule stays `warn` because of it.
    .filter((name) => !name.startsWith('_'))
    .sort();
})();

const crossSegmentRules = APP_SEGMENTS.map((segment) => ({
  name: `no-cross-segment-app/${segment}`,
  severity: severityFor(BLOCKING),
  comment:
    'One top-level src/app segment must not import from another. Segments are independent ' +
    'route trees; a cross-segment edge silently couples two features so neither can be ' +
    'changed or extracted alone. Promote the shared code to src/lib/ (or a shared component ' +
    'module) and let both segments depend on that instead.',
  from: { path: `^src/app/${rx(segment)}/` },
  to: {
    // `(?!_)` applies the SAME private-folder definition to the target as
    // APP_SEGMENTS applies to the source. Excluding `_foo` from the segment list
    // alone was not enough: it stopped rules being generated FOR `_marketing`,
    // while every other segment still flagged an import INTO it, because this
    // pattern matched `src/app/<anything>/`. Measured after the first attempt —
    // still 2 violations, unchanged. Both ends need the same rule.
    path: '^src/app/(?!_)[^/]+/',
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
