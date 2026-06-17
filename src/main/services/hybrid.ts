/**
 * Hybrid-search fusion + rerank — pure helpers, no Electron deps so they can be
 * unit tested in isolation.
 *
 * Reciprocal Rank Fusion (RRF) combines independently-ranked result lists
 * (lexical BM25 + semantic vector) without having to reconcile their
 * incompatible score scales: a key that ranks highly in BOTH lists rises to the
 * top. A light rerank then boosts exact-ish lexical agreement (name/path).
 */

export interface RankedItem<T> {
  key: string;
  item: T;
}

/**
 * Fuse multiple ranked lists into one. Each input list is assumed already
 * sorted best-first. Items are merged by `key`; the representative item kept is
 * the one from the list where it ranked highest.
 *
 * @param k RRF damping constant (60 is the canonical default).
 */
export function reciprocalRankFusion<T>(lists: RankedItem<T>[][], k = 60): { key: string; item: T; score: number }[] {
  const score = new Map<string, number>();
  const best = new Map<string, { rank: number; item: T }>();

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const { key, item } = list[rank];
      score.set(key, (score.get(key) || 0) + 1 / (k + rank + 1));
      const prev = best.get(key);
      if (!prev || rank < prev.rank) best.set(key, { rank, item });
    }
  }

  return Array.from(score.entries())
    .map(([key, s]) => ({ key, item: best.get(key)!.item, score: s }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Parse an LLM rerank response into an ordering of candidate indices.
 *
 * Accepts a JSON array of 0-based (or 1-based) indices, tolerating surrounding
 * prose/markdown. Out-of-range and duplicate indices are dropped. Returns null
 * when nothing parseable is found, so callers can keep the original order.
 *
 * @param n number of candidates that were offered (for range validation)
 */
export function parseRerankOrder(text: string, n: number): number[] | null {
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  // Detect 1-based indexing: if every value is in [1..n] and none is 0, shift.
  const nums = parsed.filter((x): x is number => typeof x === 'number' && Number.isInteger(x));
  if (nums.length === 0) return null;
  const oneBased = nums.every((x) => x >= 1 && x <= n) && !nums.includes(0);

  const seen = new Set<number>();
  const order: number[] = [];
  for (const raw of nums) {
    const idx = oneBased ? raw - 1 : raw;
    if (idx >= 0 && idx < n && !seen.has(idx)) {
      seen.add(idx);
      order.push(idx);
    }
  }
  return order.length ? order : null;
}

