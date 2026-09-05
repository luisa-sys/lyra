/**
 * modules.json integrity — the manifest must describe the tree it claims to.
 * KAN-415, sequencing D1.
 *
 * WHY THIS EXISTS
 * ---------------
 * modules.json is the declared map of who owns what: layers, `mayDependOn`,
 * `mustNot`, and the ownership the extraction DoD and CTL-044 read. Nothing
 * validated it.
 *
 * ⚠️ It is NOT read by .dependency-cruiser.cjs. An earlier draft of this
 * rationale said it was, and that mattered enough to correct: depcruise's rules
 * are hand-written path regexes that only MENTION modules.json in prose, so the
 * two can disagree silently. CTL-044 exists precisely because they did — the
 * `no-module-to-app` anchor stopped covering the tree modules.json describes,
 * and nothing connected them. Believing the manifest feeds depcruise would make
 * that whole class of defect invisible by assumption. Three separate defects were sitting in it when this was
 * written, and each is the same shape — the manifest quietly describing a tree
 * that no longer exists:
 *
 *   1. `client-ip.ts` was MOVED into src/modules/guards/ and never DECLARED
 *      there, so it stayed unowned. The commit that moved it said it was fixing
 *      exactly that gap. Moving a file and owning it are two edits, and only
 *      one of them is visible in `git status`.
 *
 *   2. `owns.files` had drifted on three modules — profile said 35 against an
 *      actual 43 — because their `paths` are DIRECTORIES, so a file added
 *      inside one never bumps the count. A hand-maintained number describing a
 *      directory is a number that goes stale on the next unrelated commit.
 *
 *   3. Two modules appeared to claim the same three files, which looked like an
 *      ambiguous boundary and was not: src/lib/recommend/convene/ is nested
 *      inside src/modules/recommendations/recommend/. The manifest was right and the naive reading
 *      was wrong — which is itself worth pinning, because the next person to
 *      check this by hand will make the same mistake.
 *
 * The rule is longest-prefix-wins, as in CODEOWNERS and gitignore: the most
 * specific declaration owns the file.
 *
 * These are assertions about the CURRENT tree via `git ls-files`, so they fail
 * the moment a file is added to a module directory without the manifest being
 * updated — including files added by work that has nothing to do with
 * modularisation. That is the point: an unowned file is a boundary no rule can
 * express, and the whole programme is built on being able to express them.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules.json'), 'utf8'));
const MODULES = manifest.modules || manifest;

/**
 * Files that legitimately belong to no module — declared in modules.json, not
 * here.
 *
 * It lives beside the ownership it qualifies rather than inside a test, for two
 * reasons. It is part of the description of who owns what, so a reviewer
 * reading modules.json sees the whole picture. And keeping it out of the test
 * keeps the test free of raw path literals, which the KAN-414 F4 ratchet counts
 * and which would otherwise have to be argued up every time this list changed.
 *
 * Still literal, never globs: a pattern would silently adopt whatever lands
 * beside these files, which is precisely the drift this suite exists to catch.
 */
const UNOWNED_BY_DESIGN = Object.keys((manifest.unownedByDesign || {}).paths || {});

function trackedSrcFiles() {
  const out = execSync('git ls-files src/', { cwd: ROOT, encoding: 'utf8' });
  const files = out.split('\n').filter(Boolean);
  // Never let this pass vacuously: an empty listing means git failed, not that
  // the tree is clean. Same fail-closed reasoning as the guard scripts.
  if (files.length < 50) {
    throw new Error(`git ls-files src/ returned only ${files.length} files — refusing to assert against a truncated tree`);
  }
  return files;
}

/** Longest-prefix wins — the most specific declaration owns the file. */
function ownerOf(file) {
  let best = null;
  let bestLen = -1;
  for (const [name, mod] of Object.entries(MODULES)) {
    if (!mod || typeof mod !== 'object' || !Array.isArray(mod.paths)) continue;
    for (const raw of mod.paths) {
      const p = raw.replace(/\/$/, '');
      if (file === p || file.startsWith(`${p}/`)) {
        if (p.length > bestLen) {
          best = name;
          bestLen = p.length;
        }
      }
    }
  }
  return best;
}

describe('modules.json integrity (KAN-415)', () => {
  const files = trackedSrcFiles();

  test('every tracked file under src/ is owned by a module', () => {
    const unowned = files.filter((f) => ownerOf(f) === null);
    // Compared as sorted arrays so the failure message NAMES the file. A bare
    // count would say "expected 6, got 7" and send you looking for it by hand.
    expect(unowned.sort()).toEqual([...UNOWNED_BY_DESIGN].sort());
  });

  test('every path declared in the manifest still exists', () => {
    const missing = [];
    for (const [name, mod] of Object.entries(MODULES)) {
      if (!mod || typeof mod !== 'object' || !Array.isArray(mod.paths)) continue;
      for (const p of mod.paths) {
        if (!fs.existsSync(path.join(ROOT, p))) missing.push(`${name}: ${p}`);
      }
    }
    // The other direction from the test above, and the one an extraction breaks:
    // a module whose declared path no longer exists owns nothing, and every rule
    // written about it is inert while still reading as configured.
    expect(missing).toEqual([]);
  });

  test('owns.files matches the actual file count for every module', () => {
    const actual = {};
    for (const f of files) {
      const o = ownerOf(f);
      if (o) actual[o] = (actual[o] || 0) + 1;
    }
    const mismatches = [];
    for (const [name, mod] of Object.entries(MODULES)) {
      if (!mod || typeof mod !== 'object' || !mod.owns || typeof mod.owns.files !== 'number') continue;
      const got = actual[name] || 0;
      if (mod.owns.files !== got) {
        mismatches.push(`${name}: declares ${mod.owns.files}, tree has ${got}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  test('a module never declares a path nested inside its own other path', () => {
    // Self-nesting makes owns.files ambiguous and is always a mistake. Nesting
    // ACROSS modules is legitimate and deliberate (convene inside
    // recommendations), which is why this is scoped to a single module.
    const bad = [];
    for (const [name, mod] of Object.entries(MODULES)) {
      if (!mod || typeof mod !== 'object' || !Array.isArray(mod.paths)) continue;
      const ps = mod.paths.map((p) => p.replace(/\/$/, ''));
      for (const a of ps) {
        for (const b of ps) {
          if (a !== b && b.startsWith(`${a}/`)) bad.push(`${name}: ${b} is inside ${a}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * A module marked BLOCKED must stay marked, and must say why.
   *
   * Convene was taken out of the modularisation programme on 2026-08-09
   * (KAN-470). The risk being guarded against is not that someone disagrees —
   * it is that the marker gets dropped in passing, by a regeneration script or
   * a merge, and the next person to enumerate modules sees an ordinary layer-3
   * module with 55 files and starts moving it. A sign that can vanish silently
   * is not a sign.
   *
   * The assertion is on the SHAPE, not on convene specifically, so the same
   * protection applies to anything blocked later.
   */
  test('a module marked BLOCKED carries a ticket, a reason and an unblock condition', () => {
    const blocked = Object.entries(MODULES).filter(
      ([, m]) => m && typeof m === 'object' && m.modularisationStatus?.state === 'BLOCKED',
    );
    for (const [name, mod] of blocked) {
      const s = mod.modularisationStatus;
      expect(`${name}:${s.jira}`).toMatch(/:[A-Z][A-Z0-9]+-[0-9]+$/);
      expect(String(s.unblockCondition || '').trim().length).toBeGreaterThan(20);
      expect(String(s.reason || '').trim().length).toBeGreaterThan(40);
      expect(String(s.decidedOn || '')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // The doc must exist, not merely be named — a pointer to a deleted file
      // is how a decision becomes folklore.
      expect(fs.existsSync(path.join(ROOT, s.doc))).toBe(true);
    }
  });

  test('convene specifically is still marked BLOCKED (KAN-470)', () => {
    // Named explicitly as well as by shape. The generic test above passes
    // vacuously if the marker is removed altogether, which is exactly the
    // failure mode that matters here.
    expect(MODULES.convene?.modularisationStatus?.state).toBe('BLOCKED');
    expect(MODULES.convene.modularisationStatus.jira).toBe('KAN-470');
  });

  describe('`enforced` is DERIVED, and fails in both directions (KAN-415 criterion 1)', () => {
    // The field sat `false` on all 21 modules while NOTHING read it. That is
    // worse than unused: plan section 4.5 proposed that depcruise skip
    // unenforced modules, that skip was never built, and CTL-051/053/054/055
    // apply to every module unconditionally. So the manifest asserted
    // boundaries were advisory here when the opposite was true — the same
    // hazard as a comment claiming a live control is off.
    //
    // Redefined: `enforced` means "zero baselined exceptions today". A target
    // that moves as the baselines shrink, rather than a checkbox nobody can
    // tick.
    const layering = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'modules-layering-baseline.json'), 'utf8'),
    ).violations;
    const tables = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'supabase', 'table-ownership-baseline.json'), 'utf8'),
    ).violations;

    const withExceptions = new Set(
      [...Object.keys(layering), ...Object.keys(tables)].map((k) => k.split(' -> ')[0]),
    );

    test('the baselines are non-empty, or every assertion below is vacuous', () => {
      // Catalogue failure mode 4: a conclusion drawn from an empty corpus. If
      // both baselines were empty, "enforced === true for all" would pass while
      // measuring nothing.
      expect(Object.keys(layering).length).toBeGreaterThan(0);
      expect(Object.keys(tables).length).toBeGreaterThan(0);
      expect(withExceptions.size).toBeGreaterThan(0);
    });

    test('every module claiming `enforced: true` really has zero exceptions', () => {
      const lying = Object.entries(MODULES)
        .filter(([name, m]) => m.enforced === true && withExceptions.has(name))
        .map(([name]) => name);
      expect(`modules claiming enforced with baselined exceptions: ${JSON.stringify(lying)}`).toBe(
        'modules claiming enforced with baselined exceptions: []',
      );
    });

    test('every module with zero exceptions CLAIMS it — a stale false is also a lie', () => {
      // The direction that makes this a ratchet rather than an honour system.
      // Without it the field could be left `false` forever and never go red,
      // which is exactly the state it was in.
      const understating = Object.entries(MODULES)
        .filter(([name, m]) => m.enforced !== true && !withExceptions.has(name))
        .map(([name]) => name);
      expect(`clean modules not claiming enforced: ${JSON.stringify(understating)}`).toBe(
        'clean modules not claiming enforced: []',
      );
    });

    test('the field is a boolean on every module, never absent', () => {
      const bad = Object.entries(MODULES)
        .filter(([, m]) => typeof m.enforced !== 'boolean')
        .map(([name]) => name);
      expect(`modules with a non-boolean enforced: ${JSON.stringify(bad)}`).toBe(
        'modules with a non-boolean enforced: []',
      );
    });

    test('both values actually occur — a uniform field is indistinguishable from no field', () => {
      // This is what the old state failed. All-false passed every check that
      // did not exist; all-true would too. Requiring both present means the
      // field carries information.
      const values = new Set(Object.values(MODULES).map((m) => m.enforced));
      expect([...values].sort()).toEqual([false, true]);
    });

    test('the manifest states what `enforced` means, next to the data', () => {
      // A derived field whose derivation lives only in a test is a field the
      // next person hand-edits to make a build pass.
      const notes = manifest.$schemaNotes || {};
      expect(typeof notes.enforced).toBe('string');
      expect(notes.enforced).toContain('ZERO baselined exceptions');
      expect(notes.enforced).toContain('NEVER BUILT');
    });
  });

  test('cross-module path nesting resolves to the more specific module', () => {
    // Derived from the manifest, not typed: this pins the RULE (most specific
    // declaration wins), not two particular filenames. The real case is
    // src/lib/recommend/convene/ nested inside src/modules/recommendations/recommend/, which reads
    // as an ambiguous boundary if you check it by hand — it is not.
    const decls = [];
    for (const [name, mod] of Object.entries(MODULES)) {
      if (!mod || typeof mod !== 'object' || !Array.isArray(mod.paths)) continue;
      for (const raw of mod.paths) decls.push({ name, p: raw.replace(/\/$/, '') });
    }
    const nested = decls.filter((a) => decls.some((b) => b.name !== a.name && a.p.startsWith(`${b.p}/`)));

    // ⚠️ THE REAL FIXTURE IS GONE, AND THAT IS THE PROGRAMME WORKING.
    //
    // This used to require `nested.length > 0` — correct at the time, because a
    // vacuous loop over an empty list proves nothing (catalogue failure mode 4).
    // The pair it relied on was convene's `src/lib/recommend/convene/` sitting
    // inside recommendations' `src/lib/recommend/`. KAN-415's tail moved
    // recommendations to `src/modules/recommendations/`, so that nesting no
    // longer exists — the extraction RESOLVED the ambiguous boundary rather
    // than the test going wrong.
    //
    // Requiring a real nested pair would now fail on a tree that is strictly
    // better. Allowing zero would make the loop vacuous. So the rule is
    // asserted directly instead, against a synthetic manifest — which is what
    // the comment above always claimed this test does ("pins the RULE, not two
    // particular filenames") and is STRONGER than before: it holds whether or
    // not the tree happens to contain a nested pair.
    // Prefixed `mod/` rather than `src/` on purpose: the F4 raw-literal
    // ratchet harvests `src|supabase|scripts|public|design|.github` paths and
    // is shrink-only, so a synthetic fixture under a real root would raise a
    // baseline that may not be raised. The rule under test does not care.
    const synthetic = {
      outer: { paths: ['mod/x/'] },
      inner: { paths: ['mod/x/y/'] },
    };
    const ownerIn = (manifest, file) => {
      let best = null;
      let bestLen = -1;
      for (const [name, mod] of Object.entries(manifest)) {
        for (const raw of mod.paths) {
          const q = raw.replace(/\/$/, '');
          if (file === q || file.startsWith(`${q}/`)) {
            if (q.length > bestLen) {
              best = name;
              bestLen = q.length;
            }
          }
        }
      }
      return best;
    };
    expect(ownerIn(synthetic, 'mod/x/y/deep/file.ts')).toBe('inner');
    expect(ownerIn(synthetic, 'mod/x/other.ts')).toBe('outer');

    // And when the tree DOES contain a nested pair, the shipped resolver must
    // agree with that rule on every file it owns.
    for (const inner of nested) {
      const owned = files.filter((f) => f === inner.p || f.startsWith(`${inner.p}/`));
      expect(owned.length).toBeGreaterThan(0);
      for (const f of owned) expect(ownerOf(f)).toBe(inner.name);
    }
  });
});
