/**
 * KAN-459 §3 — direct tests for the shared comment stripper.
 *
 * The helper is load-bearing across five suites at once: a bug in it silently
 * weakens all of them simultaneously, and none of them would go red, because a
 * stripper that under-strips just makes their assertions comment-satisfiable
 * again — which is the exact defect CTL-039 exists for. So it gets its own
 * tests rather than being covered only through its consumers.
 *
 * Expected values here are written out as literals. None is derived from the
 * module under test (catalogue failure mode 10) — the one place a value is
 * read from elsewhere is the drift test at the bottom, which deliberately
 * compares this table against the OTHER implementation.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stripComments, SYNTAX } from '../support/strip-comments';
import { SRC } from '../support/source-paths';

const ROOT = resolve(__dirname, '../..');

describe('stripComments blanks comments', () => {
  test('a JSX block comment', () => {
    expect(stripComments('{/* A few of my favourite things */}')).not.toContain('favourite');
  });

  test('a plain block comment, including a multi-line one', () => {
    const out = stripComments('const a = 1;\n/* is_published\n   is_suspended */\nconst b = 2;');
    expect(out).not.toContain('is_published');
    expect(out).not.toContain('is_suspended');
    expect(out).toContain('const a = 1;');
    expect(out).toContain('const b = 2;');
  });

  test('a trailing line comment', () => {
    expect(stripComments('const a = 1; // withoutDismissedV2(x)')).not.toContain(
      'withoutDismissedV2',
    );
  });

  test('a whole-line comment', () => {
    expect(stripComments('// groupFavourites(typedItems)')).not.toContain('groupFavourites');
  });
});

describe('stripComments leaves code alone', () => {
  test('a URL inside a string literal is not a line comment', () => {
    expect(stripComments("const u = 'https://example.com';")).toContain('https://example.com');
  });

  test('a // sequence inside a double-quoted string survives', () => {
    expect(stripComments('const s = "keep // this";')).toContain('keep // this');
  });

  test('an escaped quote does not end the string early', () => {
    // Without backslash handling the scanner would think the string closed at
    // the escaped quote and blank the rest of the line as a comment.
    expect(stripComments("const s = 'it\\'s // fine';")).toContain('// fine');
  });

  test('line count is preserved, so a reported line number still means something', () => {
    const src = 'a\n/* x\n   y */\nb\n// z\nc';
    expect(stripComments(src).split('\n')).toHaveLength(src.split('\n').length);
  });

  test('an unterminated block comment blanks to end of file rather than being ignored', () => {
    expect(stripComments('const a = 1;\n/* is_published')).not.toContain('is_published');
  });
});

describe('stripComments is per file type', () => {
  test('.css has block comments but no // comments — #4a7359 is a colour', () => {
    const css = '.a { color: #4a7359; } /* brand */\n.b { background: url(//cdn/x.png); }';
    const out = stripComments(css, '.css');
    expect(out).not.toContain('brand');
    expect(out).toContain('#4a7359');
    expect(out).toContain('url(//cdn/x.png)');
  });

  test('.sql strips -- but a JS-family suffix does not', () => {
    const sql = "select 1; -- grant execute\nrevoke all on function public.fn() from public;";
    expect(stripComments(sql, '.sql')).not.toContain('grant execute');
    expect(stripComments(sql, '.ts')).toContain('grant execute');
  });

  test('.md has no comment syntax at all, so nothing is removed', () => {
    const md = '# Lyra\n// not a comment\n-- also not';
    expect(stripComments(md, '.md')).toBe(md);
  });

  test('an unregistered suffix throws rather than silently passing the source through', () => {
    // Failing loud matters more than it looks: a silent pass-through returns a
    // string that LOOKS stripped at the call site, leaving every assertion
    // comment-satisfiable with nothing to notice.
    expect(() => stripComments('x', '.rs')).toThrow(/no comment syntax registered/);
  });
});

describe('the helper and CTL-039 do not drift apart', () => {
  // Two implementations of one rule set, in two languages, with nothing
  // comparing them — the SEC-152 shape. This is the comparison.
  const checker = readFileSync(resolve(ROOT, SRC.checkCommentOnlyAssertions), 'utf-8');

  const pythonTable = (() => {
    const start = checker.indexOf('SYNTAX: dict[str, dict] = {');
    expect(start).toBeGreaterThan(-1);
    const end = checker.indexOf('\n}', start);
    expect(end).toBeGreaterThan(start);
    const body = checker.slice(start, end);

    const parsed: Record<string, { line: string[]; block: string[][] }> = {};
    const row = /"(\.[a-z]+)":\s*\{"line":\s*\[([^\]]*)\],\s*"block":\s*\[([^\]]*)\]\}/g;
    for (let m = row.exec(body); m !== null; m = row.exec(body)) {
      const list = (s: string): string[] =>
        s.match(/"([^"]*)"/g)?.map((q) => q.slice(1, -1)) ?? [];
      parsed[m[1]] = {
        line: list(m[2]),
        block: list(m[3]).length > 0 ? [list(m[3])] : [],
      };
    }
    return parsed;
  })();

  test('the checker table was actually parsed (a zero-row parse would pass everything)', () => {
    expect(Object.keys(pythonTable).length).toBeGreaterThanOrEqual(15);
  });

  test.each(Object.keys(SYNTAX))('%s matches the checker', (suffix) => {
    expect(pythonTable[suffix]).toBeDefined();
    expect(pythonTable[suffix].line).toEqual(SYNTAX[suffix].line);
    expect(pythonTable[suffix].block).toEqual(SYNTAX[suffix].block.map((pair) => [...pair]));
  });

  test('every file type the checker knows about is registered here too', () => {
    expect(Object.keys(SYNTAX).sort()).toEqual(Object.keys(pythonTable).sort());
  });
});
