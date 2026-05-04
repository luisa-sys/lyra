/**
 * KAN-168: Test integrity meta-check.
 *
 * A test that runs without making any assertions passes silently and gives
 * false safety — exactly the false-positive class the Test Integrity Policy
 * (CLAUDE.md) forbids. This test scans every other unit test file and
 * verifies that each `test(...)` / `it(...)` block contains at least one
 * `expect(...)` call.
 *
 * Approach: balanced-brace parsing of each test file. Not a full JS parser —
 * a regex-based heuristic that catches obvious assertion-free blocks. False
 * positives are documented in the EXEMPT_BLOCKS map below with rationale.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '../..');

/**
 * Find every test() / it() block in the source string and return an array
 * of {name, body, line} where body is the matched content between the
 * opening `{` of the callback and its matching `}`.
 *
 * We match patterns like:
 *   test('name', () => { ... })
 *   it('name', async () => { ... })
 *   test('name', function () { ... })
 * but NOT:
 *   test.each(...)('name', ...)  (skipped — intentional, hard to match cleanly)
 */
function extractTestBlocks(source) {
  const blocks = [];
  const pattern = /\b(test|it)\(\s*['"`]([^'"`]+)['"`]\s*,\s*(async\s+)?(\(\)|\([^)]*\)|function\s*\(\s*\))\s*=>\s*\{|\b(test|it)\(\s*['"`]([^'"`]+)['"`]\s*,\s*(async\s+)?function\s*\(\s*\)\s*\{/g;
  let m;
  while ((m = pattern.exec(source)) !== null) {
    const name = m[2] || m[6];
    // Walk forward from the matched opening brace to its balanced close.
    const startBrace = source.lastIndexOf('{', pattern.lastIndex - 1);
    if (startBrace === -1) continue;
    let depth = 1;
    let i = startBrace + 1;
    while (i < source.length && depth > 0) {
      const c = source[i];
      // Skip strings and template literals to avoid counting braces inside them.
      if (c === '"' || c === "'") {
        const quote = c;
        i++;
        while (i < source.length && source[i] !== quote) {
          if (source[i] === '\\') i++;
          i++;
        }
      } else if (c === '`') {
        i++;
        while (i < source.length && source[i] !== '`') {
          if (source[i] === '\\') {
            i++;
          } else if (source[i] === '$' && source[i + 1] === '{') {
            // Skip template-literal expression — count braces for nested expressions.
            i += 2;
            let exprDepth = 1;
            while (i < source.length && exprDepth > 0) {
              if (source[i] === '{') exprDepth++;
              else if (source[i] === '}') exprDepth--;
              if (exprDepth === 0) break;
              i++;
            }
          }
          i++;
        }
      } else if (c === '/' && source[i + 1] === '/') {
        // line comment
        while (i < source.length && source[i] !== '\n') i++;
      } else if (c === '/' && source[i + 1] === '*') {
        i += 2;
        while (i < source.length - 1 && !(source[i] === '*' && source[i + 1] === '/')) i++;
        i += 2;
        continue;
      } else if (c === '{') {
        depth++;
      } else if (c === '}') {
        depth--;
      }
      i++;
    }
    const body = source.slice(startBrace + 1, i - 1);
    const lineNumber = source.slice(0, startBrace).split('\n').length;
    blocks.push({ name, body, line: lineNumber });
  }
  return blocks;
}

/**
 * Blocks intentionally exempt from the every-block-has-expect rule.
 * Key format: `<filename>::<test name>`. Add a rationale comment when extending.
 */
const EXEMPT_BLOCKS = new Set([
  // (none currently — all unit tests must assert)
]);

// This file contains regex pattern source code (e.g. example `test('name', ...)`
// strings inside JSDoc comments) that would self-match. Skip it so the
// meta-check doesn't flag its own documentation.
const SELF_FILENAME = path.basename(__filename);

describe('KAN-168: every test block must make at least one assertion', () => {
  // Discover all unit test files (excluding self — see SELF_FILENAME above).
  const listOutput = execSync('npx jest --testPathPatterns=tests/unit --listTests', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const testFiles = listOutput
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((f) => path.basename(f) !== SELF_FILENAME);

  test('discovered at least one test file to scan', () => {
    expect(testFiles.length).toBeGreaterThan(0);
  });

  test('every test() / it() block contains expect(', () => {
    const violations = [];
    for (const file of testFiles) {
      const source = fs.readFileSync(file, 'utf8');
      const blocks = extractTestBlocks(source);
      const fileName = path.basename(file);
      for (const block of blocks) {
        const exemptKey = `${fileName}::${block.name}`;
        if (EXEMPT_BLOCKS.has(exemptKey)) continue;
        if (!/\bexpect\(/.test(block.body)) {
          violations.push(`${fileName}:${block.line} — '${block.name}' has no expect()`);
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `KAN-168: ${violations.length} test block(s) lack any expect() call:\n  ` +
          violations.join('\n  ') +
          `\n\nFix by adding an assertion, OR (only with sign-off) add the test to ` +
          `EXEMPT_BLOCKS in tests/unit/test-meta-integrity.test.js with a rationale.`,
      );
    }
    // Belt-and-braces: assert the count we've inspected is non-zero so an
    // empty traversal can't pass silently (KAN-167 thesis).
    expect(testFiles.length).toBeGreaterThan(0);
  });
});
