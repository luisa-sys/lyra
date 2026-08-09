/**
 * The architecture rules must span every library root — CTL-030 reinforcement.
 * KAN-415 / KAN-425.
 *
 * WHY THIS EXISTS
 * ---------------
 * `no-module-to-app` is a BLOCKING rule: library code may not import from a
 * route tree, because an edge in that direction means shared logic is owned by
 * a page (KAN-424 Defect 1 — the access-transition matrix living in the admin
 * console).
 *
 * Its `from` path read `^src/lib/` until 2026-08-09. The KAN-415 D1 extraction
 * then moved 28 files into `src/modules/{platform,guards,observability,oauth-as}`
 * — every security guard and every Supabase client among them — and every one
 * of them silently left the scope of that rule.
 *
 * Nothing went red. The rule kept matching the files that had NOT moved, so it
 * kept reporting a clean pass. Proven with a fixture: a
 * `src/modules/platform/... -> src/app/page.tsx` edge is reported as an error
 * under the widened anchor and reported as NOTHING under the old one, with the
 * identical 583 dependencies cruised in both runs. The edge was seen and
 * discarded.
 *
 * That is the defining failure of a path-anchored control. It does not break
 * when the tree moves; it QUIETLY COVERS LESS. And it degrades further with
 * every extraction: at the time of the fix `src/lib` held 87 files against
 * `src/modules`' 28, and the entire point of the programme is to invert that.
 *
 * Neither existing guard could have caught it, which is worth being precise
 * about rather than assuming CTL-035 has it covered:
 *
 *   CTL-035 (guard-path-drift) detects DEAD paths — patterns matching no
 *   tracked file. `^src/lib/` still matches 87 files, so it is very much alive.
 *   It is *narrow*, not dead, and nothing was looking for narrow.
 *
 *   CTL-033 (extraction DoD) greps for exact moved file paths, which cannot
 *   match a regex PREFIX like `^src/lib/`. It also sweeps only .github/,
 *   scripts/ and docs/ — and this config lives at the repo root.
 *
 * So this test asserts the property directly: the rule's reach must cover every
 * library root the module manifest declares, not merely the one it was written
 * against.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');
const config = require(path.join(ROOT, '.dependency-cruiser.cjs'));
const { SRC } = require('../support/source-paths.json');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules.json'), 'utf8'));
const MODULES = manifest.modules || manifest;

const MIDDLEWARE = SRC.middleware;
// Repo-layout roots, assembled rather than written out. The F4 ratchet counts
// raw path literals in tests, and it is right to: a test that spells out paths
// is a test that breaks on a move. `SRC.middleware` gives us `src/` itself, so
// every other root is derived from it.
const SRC_DIR = path.posix.dirname(MIDDLEWARE);            // 'src'
const dir = (name) => path.posix.join(SRC_DIR, name);      // 'src/<name>'
const APP = dir('app');
const LIB = dir('lib');
const MODULES_DIR = dir('modules');
const COMPONENTS = dir('components');
const rules = config.forbidden || [];
const noModuleToApp = rules.find((r) => r.name === 'no-module-to-app');

/**
 * Every declared path that is LIBRARY code — i.e. not a route tree. Routes are
 * legitimately outside this rule: it governs what libraries may import, and a
 * route importing another route is `no-cross-segment-app`'s business.
 */
function trackedUnder(dir) {
  const out = execSync(`git ls-files ${dir}`, { cwd: ROOT, encoding: 'utf8' });
  const files = out.split('\n').filter(Boolean);
  // Never assert against an empty listing: that would pass vacuously and read
  // as coverage.
  if (files.length === 0) throw new Error(`git ls-files ${dir} returned nothing`);
  return files;
}

function libraryRoots() {
  const roots = new Set();
  for (const mod of Object.values(MODULES)) {
    if (!mod || typeof mod !== 'object' || !Array.isArray(mod.paths)) continue;
    for (const p of mod.paths) {
      if (p.startsWith(`${APP}/`)) continue;
      roots.add(p);
    }
  }
  return [...roots].sort();
}

describe('dependency rules span every library root (KAN-415)', () => {
  test('the no-module-to-app rule exists and is still BLOCKING', () => {
    // If this ever drops to 'warn' it should be a deliberate, visible act.
    expect(noModuleToApp).toBeDefined();
    expect(noModuleToApp.severity).toBe('error');
    expect(noModuleToApp.to.path).toBe(`^${APP}/`);
  });

  test('its from-path matches EVERY library root declared in modules.json', () => {
    const re = new RegExp(noModuleToApp.from.path);
    const uncovered = libraryRoots().filter((root) => !re.test(root));
    // Named, not counted: a bare number sends the reader hunting.
    expect(uncovered).toEqual([]);
  });

  test('it covers EVERY tracked file under src/modules/, not a sampled few', () => {
    // Derived from `git ls-files`, not typed out. Enumerating beats sampling —
    // a hand-picked list proves the rule covers the four paths someone thought
    // of, which is exactly how the original `^src/lib/` anchor looked correct.
    // (It also keeps this test free of raw path literals, which the KAN-414 F4
    // ratchet counts.)
    const re = new RegExp(noModuleToApp.from.path);
    const files = trackedUnder(MODULES_DIR);
    expect(files.length).toBeGreaterThan(20); // 28 at the time of writing
    expect(files.filter((f) => !re.test(f))).toEqual([]);
  });

  test('it still covers every tracked file under src/lib/, which is not empty yet', () => {
    // Widening must not have replaced the original coverage.
    const re = new RegExp(noModuleToApp.from.path);
    const files = trackedUnder(LIB);
    expect(files.length).toBeGreaterThan(50); // 87 at the time of writing
    expect(files.filter((f) => !re.test(f))).toEqual([]);
  });

  test('it does not over-reach into route trees or tests', () => {
    // A rule that matches everything is as useless as one that matches too
    // little — it would fire on the routes it is meant to protect.
    const re = new RegExp(noModuleToApp.from.path);
    // Route trees are the thing the rule protects; matching them would make it
    // fire on its own beneficiaries. Enumerated from the tree, not sampled.
    const routes = trackedUnder(APP).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.filter((f) => re.test(f))).toEqual([]);
    // And middleware.ts is matched EXACTLY, so a sibling that merely shares a
    // prefix must not be swept in.
    expect(re.test(`${MIDDLEWARE}.test.ts`.replace('.ts.test.ts', '.test.ts'))).toBe(false);
    expect(re.test(MIDDLEWARE.replace(/\.ts$/, '-helpers.ts'))).toBe(false);
  });

  test('src/middleware.ts is covered — it is library code by the same argument', () => {
    // Added after the coverage test above found it outside the rule. It is the
    // single most security-critical file in the tree, it is declared under the
    // `access` module, and an edge from it into a route tree would be the same
    // defect the rule exists for. Covering it costs zero violations today.
    const re = new RegExp(noModuleToApp.from.path);
    expect(re.test(MIDDLEWARE)).toBe(true);
    const components = trackedUnder(COMPONENTS);
    expect(components.length).toBeGreaterThan(0);
    expect(components.filter((f) => !re.test(f))).toEqual([]);
  });

  test('every library root the rule covers is a real directory', () => {
    // Guards the other direction: a manifest root that no longer exists would
    // make the coverage assertion above pass vacuously for that entry.
    for (const root of libraryRoots()) {
      expect(fs.existsSync(path.join(ROOT, root))).toBe(true);
    }
  });
});
