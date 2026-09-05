/**
 * KAN-139: keyword extraction + stopwords, ported from
 * /Users/admin/Documents/2026 Lyra/lyra-app/recommend.py (`_extract_keywords`).
 *
 * Pulls "meaningful" words out of free text — strips stopwords, ignores
 * short tokens (<3 chars), lowercases. Used by the preference profile
 * builder and the scorer to compare a recommendation against a user's
 * profile content.
 */

const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
  'it', 'its', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
  'so', 'than', 'too', 'very', 'just', 'don', 'now', 'and', 'but',
  'or', 'if', 'this', 'that', 'these', 'those', 'am', 'about', 'up',
  'also', 'them', 'they', 'their', 'what', 'which', 'who', 'whom',
  'him', 'her', 'his', 'she', 'he', 'thing', 'things', 'like', 'love',
  'really', 'always', 'never', 'much', 'many', 'any', 'every',
  'please', 'especially', 'prefer', 'anything', 'something', 'nothing',
  'even', 'still', 'already', 'rather', 'quite', 'get', 'got',
]);

const WORD_RE = /[a-z]+/g;

/**
 * Returns the list of meaningful words in `text` — lowercased,
 * stopwords removed, ≥3 chars. Idempotent on input (handles undefined
 * / null as empty array so callers don't have to defend).
 */
export function extractKeywords(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.toLowerCase().match(WORD_RE);
  if (!matches) return [];
  return matches.filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * A small `Counter`-equivalent so the rest of the recommend module can
 * stay close in shape to the Python reference. Increments per term,
 * exposes `entries()` and `get()` for the scorer.
 */
export class Counter {
  private readonly counts = new Map<string, number>();

  add(words: Iterable<string>): void {
    for (const w of words) {
      this.counts.set(w, (this.counts.get(w) ?? 0) + 1);
    }
  }

  get(word: string): number {
    return this.counts.get(word) ?? 0;
  }

  has(word: string): boolean {
    return this.counts.has(word);
  }

  keys(): Iterable<string> {
    return this.counts.keys();
  }

  /** Top-N by count, descending. Stable for equal counts (insertion order). */
  mostCommon(n: number): Array<[string, number]> {
    return [...this.counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);
  }

  size(): number {
    return this.counts.size;
  }
}
