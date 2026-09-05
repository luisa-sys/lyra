/**
 * Path matching for the access module — KAN-415 D4.
 *
 * Two kinds only: exact and prefix. That is not a simplification, it is the
 * complete vocabulary of every path predicate in src/middleware.ts today —
 * verified disjunct by disjunct across all three inline lists. No globs, no
 * regexes: a regex in a per-request path predicate is a performance question
 * and a correctness question at once, and neither is one this module needs.
 *
 * Compiled once at module load. Per request the cost is one Set.has plus an
 * indexed loop over a short prefix array — no closure per row, no iterator
 * allocation, no regex compilation. This runs in the edge runtime on EVERY
 * request, so the shape matters more than it would elsewhere.
 */

export type PathMatch =
  | { readonly kind: 'exact'; readonly path: string }
  | { readonly kind: 'prefix'; readonly path: string };

/** A matcher list flattened for lookup. Build once, read many. */
export interface CompiledMatchers {
  readonly exact: ReadonlySet<string>;
  readonly prefixes: readonly string[];
}

export function compile(matches: readonly PathMatch[]): CompiledMatchers {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const m of matches) {
    if (m.kind === 'exact') exact.add(m.path);
    else prefixes.push(m.path);
  }
  return { exact, prefixes };
}

/**
 * Exact match, or startsWith one of the prefixes.
 *
 * Note the prefixes carry their own trailing slash ('/auth/', not '/auth').
 * That is deliberate and load-bearing: `/auth` alone would also match
 * `/authenticate`, and `/_next` would match `/_nextdoor`. The original
 * predicates were written with the trailing slash and the near-misses are
 * pinned as tests.
 */
export function matchesAny(compiled: CompiledMatchers, pathname: string): boolean {
  if (compiled.exact.has(pathname)) return true;
  const { prefixes } = compiled;
  for (let i = 0; i < prefixes.length; i += 1) {
    if (pathname.startsWith(prefixes[i])) return true;
  }
  return false;
}
