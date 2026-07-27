#!/usr/bin/env node
/**
 * KAN-417 — test-estate classification script.
 *
 * Classifies every Jest test file in the three Lyra repos into:
 *   (a) behavioural            — imports and executes the code under test
 *   (b) convertible text scan  — reads ONE source file as text and asserts on
 *                                its content; a behavioural equivalent exists
 *   (c) structural             — tree-walks / multi-file text sweeps, import-
 *                                direction rules, repo-metadata reads; no
 *                                behavioural equivalent, keep as text but
 *                                route paths through a manifest
 *   (d) guard test             — lyra tests/scripts/**: executes the CI shell
 *                                guards themselves (path-coupled by design)
 *
 * Also inventories: every jest.mock() path literal, every hard-coded repo
 * path literal (src/ scripts/ supabase/ .github/ docs/), and the E2E layer
 * (per-spec URL vs path coupling + test-block counts + staging-soak.sh URLs).
 *
 * Usage:
 *   node docs/modularisation/kan417-classify-tests.mjs \
 *        <lyra-root> <lyra-mcp-server-root> <lyra-admin-mcp-server-root>
 *
 * Output: JSON on stdout (pipe to a file), human summary on stderr.
 * Deterministic — same tree, same output. No dependencies.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const [lyraRoot, mcpRoot, adminRoot] = process.argv.slice(2);
if (!lyraRoot || !mcpRoot || !adminRoot) {
  console.error('usage: kan417-classify-tests.mjs <lyra> <lyra-mcp-server> <lyra-admin-mcp-server>');
  process.exit(2);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const TEST_FILE = /\.test\.(ts|tsx|js|cjs|mjs)$/;

// A "repo path literal" is any quoted string that pins a location in the
// repo tree — the thing that breaks when a file moves.
const PATH_LITERAL =
  /['"`]((?:\.{1,2}\/)*(?:src|scripts|supabase|docs|controls)\/[^'"`\n]+|\.github\/[^'"`\n]+)['"`]/g;

const JEST_MOCK = /jest\.mock\(\s*['"]([^'"]+)['"]/g;

function analyseTestFile(repoRoot, absPath, repoKind) {
  const rel = relative(repoRoot, absPath);
  const text = readFileSync(absPath, 'utf8');

  const importsSource =
    repoKind === 'lyra'
      ? /(?:from\s+|require\(\s*|import\()\s*['"](?:@\/|(?:\.\.\/)+src\/)/.test(text)
      : /(?:from\s+|require\(\s*|import\()\s*['"](?:\.\.\/)+(?:src|dist)\//.test(text);

  const readsFiles = /readFileSync|readFile\(/.test(text);
  const treeWalks = /readdirSync|globSync|fs\.walk|fast-glob|listFiles|walkSync/.test(text);
  const execsProcess = /execSync|spawnSync|child_process/.test(text);

  const pathLiterals = [...new Set([...text.matchAll(PATH_LITERAL)].map((m) => m[1]))];
  const srcLiterals = pathLiterals.filter((p) => /(^|\/)src\//.test(p));
  const jestMocks = [...new Set([...text.matchAll(JEST_MOCK)].map((m) => m[1]))];
  const readsSourceText = readsFiles && srcLiterals.length > 0;
  // Multi-file text sweep even without an explicit tree-walk API
  const multiFileScan = readsSourceText && srcLiterals.length > 3;
  // Assertions about import statements are structural by nature
  const assertsOnImports = /toMatch\([^)]*import|import\\s|from\s+['"]\s*\+|includes\(\s*['"]import/.test(text);

  let cls;
  if (repoKind === 'lyra' && rel.startsWith('tests/scripts/')) cls = 'd';
  else if (treeWalks && (readsSourceText || srcLiterals.length > 0 || /src/.test(text))) cls = 'c';
  else if (readsSourceText) cls = multiFileScan || assertsOnImports ? 'c' : 'b';
  else if (importsSource) cls = 'a';
  else if (readsFiles || pathLiterals.length > 0) cls = 'c'; // repo-metadata / workflow / doc reads
  else cls = 'a'; // pure in-file logic (inline fixtures, no coupling)

  return {
    file: rel,
    class: cls,
    importsSource,
    readsSourceText,
    treeWalks,
    execsProcess,
    assertsOnImports,
    srcPathLiterals: srcLiterals,
    otherPathLiterals: pathLiterals.filter((p) => !srcLiterals.includes(p)),
    jestMocks,
  };
}

function analyseRepo(root, kind, testDirs) {
  const files = [];
  for (const d of testDirs) {
    const abs = join(root, d);
    if (existsSync(abs)) files.push(...walk(abs).filter((f) => TEST_FILE.test(f)));
  }
  files.sort();
  const results = files.map((f) => analyseTestFile(root, f, kind));
  const by = (c) => results.filter((r) => r.class === c).length;
  let sha = 'unknown';
  try { sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch {}
  return {
    repo: kind,
    sha,
    total: results.length,
    counts: { a: by('a'), b: by('b'), c: by('c'), d: by('d') },
    neverImportSource: results.filter((r) => !r.importsSource).length,
    files: results,
  };
}

// ---------------- E2E layer (lyra only) ----------------

function analyseE2E(root) {
  const e2eDir = join(root, 'tests/e2e');
  const specs = walk(e2eDir).filter((f) => /\.spec\.ts$/.test(f)).sort();
  const out = [];
  for (const abs of specs) {
    const rel = relative(root, abs);
    const text = readFileSync(abs, 'utf8');
    const testBlocks = (text.match(/^\s*(?:test|it)(?:\.(?:only|skip|fixme|fail))?\s*\(/gm) || []).length;
    const gotoUrls = [...new Set([...text.matchAll(/goto\(\s*[`'"]([^`'")]*)/g)].map((m) => m[1]))];
    const urlAssertions = [...new Set([...text.matchAll(/toHaveURL\(\s*[`'"/]([^`'")]*)/g)].map((m) => m[1]))];
    const srcLiterals = [...new Set([...text.matchAll(PATH_LITERAL)].map((m) => m[1]))];
    const supportImports = [...new Set(
      [...text.matchAll(/from\s+['"]([^'"]*support\/[^'"]+)['"]/g)].map((m) => m[1]),
    )];
    const copyAssertions = (text.match(/getByText\(|toHaveText\(|getByRole\([^)]*name:/g) || []).length;
    out.push({
      file: rel,
      testBlocks,
      gotoUrls,
      urlAssertions,
      copyAssertionCount: copyAssertions,
      supportImports,
      repoPathLiterals: srcLiterals,
      coupling: srcLiterals.length > 0 ? 'path' : copyAssertions > 0 ? 'url+selector/content' : 'url',
    });
  }
  // staging-soak.sh — URL vs path coupling
  const soakPath = join(root, 'scripts/staging-soak.sh');
  let soak = null;
  if (existsSync(soakPath)) {
    const text = readFileSync(soakPath, 'utf8');
    soak = {
      file: 'scripts/staging-soak.sh',
      urls: [...new Set([...text.matchAll(/(https?:\/\/[^\s"'$)]+|\$\{?BASE[A-Z_]*\}?[^\s"')]*)/g)].map((m) => m[1]))].slice(0, 40),
      repoPathLiterals: [...new Set([...text.matchAll(PATH_LITERAL)].map((m) => m[1]))],
    };
  }
  return { specs: out, totalBlocks: out.reduce((s, x) => s + x.testBlocks, 0), soak };
}

const report = {
  generatedBy: 'docs/modularisation/kan417-classify-tests.mjs',
  repos: [
    analyseRepo(lyraRoot, 'lyra', ['tests/unit', 'tests/scripts']),
    analyseRepo(mcpRoot, 'lyra-mcp-server', ['tests']),
    analyseRepo(adminRoot, 'lyra-admin-mcp-server', ['tests']),
  ],
  e2e: analyseE2E(lyraRoot),
};

// jest.mock global inventory
report.jestMockInventory = report.repos.flatMap((r) =>
  r.files.filter((f) => f.jestMocks.length).map((f) => ({ repo: r.repo, file: f.file, mocks: f.jestMocks })),
);

console.log(JSON.stringify(report, null, 2));

for (const r of report.repos) {
  console.error(
    `${r.repo}@${r.sha}: ${r.total} files — a:${r.counts.a} b:${r.counts.b} c:${r.counts.c} d:${r.counts.d}; never-import-source:${r.neverImportSource}`,
  );
}
console.error(
  `e2e: ${report.e2e.specs.length} specs, ${report.e2e.totalBlocks} test blocks; ` +
    report.e2e.specs.map((s) => `${s.file.split('/').pop()}=${s.coupling}`).join(' '),
);
console.error(`jest.mock files: ${report.jestMockInventory.length}`);
