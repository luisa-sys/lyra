/**
 * Shared comment stripper for source-text assertions (KAN-459 §3).
 *
 * WHY THIS EXISTS
 * ---------------
 * A source-text assertion is satisfied by anything in the file, including the
 * prose explaining the thing it claims to guard. That is CTL-039's whole
 * defect class: `expect(sitemap).toContain('is_published')` stayed green
 * throughout SEC-100 because `is_published` also appears in the comment
 * explaining why the query needs it, so deleting the filter entirely left the
 * scan matching the comment. The better a fix is documented, the weaker a
 * source-text scan of it becomes.
 *
 * Five suites had independently hand-rolled a `stripComments` helper, and they
 * had already diverged — three handled `{/* … *\/}` explicitly, two did not;
 * four guarded only against `://` when blanking a line comment, one also
 * guarded quotes. That divergence is itself the CTL-038 duplication shape: a
 * copy can silently stop matching the thing it was copied from.
 *
 * THE RULES ARE THE CHECKER'S RULES
 * ---------------------------------
 * This is a deliberate port of `strip_comments` / `_blank_line_comment` in
 * `scripts/check-comment-only-assertions.py`, which is the reference semantics
 * KAN-459 §3.2 names. Two properties are carried over on purpose:
 *
 *  1. **Comments are BLANKED, not deleted** — replaced space-for-space with
 *     newlines preserved. Deleting them can form a literal by joining the two
 *     sides of a removed comment, and it moves every offset after it.
 *  2. **A line marker inside a string literal is not a comment start.**
 *     `const u = 'https://example.com'` keeps its URL. Quote tracking with
 *     backslash escapes, exactly as the checker does it.
 *
 * Note what falls out of rule 2, because it is a real limitation rather than
 * an oversight: an apostrophe in JSX text (`It's`) opens a string as far as
 * this scanner is concerned, so a `//` later on that same line is left alone.
 * The checker behaves identically. Diverging here to "fix" it would break the
 * one property KAN-459 §3.2 asks for — that the helper and the checker share
 * one definition of the rules.
 *
 * JSX `{/* … *\/}` needs no special case: the `/*` … `*\/` block pair strips
 * the inside, and the surrounding braces are inert. Luisa's KAN-459 comment
 * established this against the real shape — the original miss was subject
 * attribution, never comment syntax.
 */

export type CommentSyntax = {
  /** Markers that start a comment running to end-of-line. */
  line: string[];
  /** Open/close pairs stripped wholesale. */
  block: Array<[string, string]>;
};

/**
 * Comment syntax per file type. A single stripper is wrong: CSS has no `//`
 * comments (so `#4a7359` is a colour, not a comment), SQL uses `--`, and
 * `.md`/`.txt`/`.json` have none at all.
 *
 * Mirrors the `SYNTAX` table in `scripts/check-comment-only-assertions.py`.
 */
export const SYNTAX: Record<string, CommentSyntax> = {
  '.ts': { line: ['//'], block: [['/*', '*/']] },
  '.tsx': { line: ['//'], block: [['/*', '*/']] },
  '.js': { line: ['//'], block: [['/*', '*/']] },
  '.mjs': { line: ['//'], block: [['/*', '*/']] },
  '.css': { line: [], block: [['/*', '*/']] },
  '.scss': { line: ['//'], block: [['/*', '*/']] },
  '.sql': { line: ['--'], block: [['/*', '*/']] },
  '.yml': { line: ['#'], block: [] },
  '.yaml': { line: ['#'], block: [] },
  '.sh': { line: ['#'], block: [] },
  '.bash': { line: ['#'], block: [] },
  '.py': { line: ['#'], block: [] },
  '.toml': { line: ['#'], block: [] },
  '.txt': { line: [], block: [] },
  '.md': { line: [], block: [] },
  '.json': { line: [], block: [] },
};

/** Blank from the first line-comment marker that is OUTSIDE a string literal. */
function blankLineComment(out: string[], base: number, line: string, markers: string[]): void {
  let quote: string | null = null;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (quote !== null) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else {
      for (const m of markers) {
        if (line.startsWith(m, i)) {
          for (let k = base + i; k < base + line.length; k += 1) {
            if (out[k] !== '\n') out[k] = ' ';
          }
          return;
        }
      }
    }
    i += 1;
  }
}

/**
 * Return `source` with its comments blanked out, so a source-text assertion
 * can only be satisfied by code.
 *
 * @param source file contents
 * @param suffix file extension including the dot, e.g. `.tsx`. Defaults to
 *   `.tsx`, whose rules (`//` and block pairs) cover the whole JS/TS family.
 * @throws if `suffix` has no entry in {@link SYNTAX}. Guessing a comment
 *   syntax is how false confidence gets manufactured — an unknown type must be
 *   a loud failure, never a silent pass-through of the raw source, because a
 *   pass-through would leave every assertion comment-satisfiable again while
 *   still looking stripped at the call site.
 */
export function stripComments(source: string, suffix: string = '.tsx'): string {
  const spec = SYNTAX[suffix];
  if (spec === undefined) {
    throw new Error(
      `stripComments: no comment syntax registered for "${suffix}". ` +
        `Add it to SYNTAX in tests/support/strip-comments.ts (and keep it in ` +
        `step with scripts/check-comment-only-assertions.py) rather than ` +
        `falling back to a guess.`,
    );
  }

  const out = source.split('');

  for (const [open, close] of spec.block) {
    let i = 0;
    for (;;) {
      const start = source.indexOf(open, i);
      if (start === -1) break;
      const hit = source.indexOf(close, start + open.length);
      const end = hit === -1 ? source.length : hit + close.length;
      for (let k = start; k < end; k += 1) {
        if (out[k] !== '\n') out[k] = ' ';
      }
      i = end;
    }
  }

  if (spec.line.length > 0) {
    const text2 = out.join('');
    let pos = 0;
    for (const line of text2.split('\n')) {
      blankLineComment(out, pos, line, spec.line);
      pos += line.length + 1;
    }
  }

  return out.join('');
}
