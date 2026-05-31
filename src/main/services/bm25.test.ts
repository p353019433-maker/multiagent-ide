import { describe, it, expect } from 'vitest';
import { Bm25Index } from './bm25';

describe('Bm25Index', () => {
  const docs = [
    { id: 0, tokens: ['index', 'service', 'search'] },
    { id: 1, tokens: ['index', 'service', 'build'] },
    { id: 2, tokens: ['user', 'profile', 'page'] },
    { id: 3, tokens: ['search', 'search', 'search', 'index'] }, // search-heavy
  ];
  const bm = new Bm25Index(docs);

  it('ranks the doc with higher term frequency first', () => {
    const res = bm.search(['search']);
    expect(res[0].id).toBe(3); // 3x "search"
  });

  it('rewards rare query terms (idf) over common ones', () => {
    // "profile" appears in 1 doc (rare); "index" in 3 docs (common).
    const res = bm.search(['profile']);
    expect(res[0].id).toBe(2);
    expect(res.every((r) => r.score > 0)).toBe(true);
  });

  it('combines multiple query terms', () => {
    const res = bm.search(['index', 'search']);
    // docs 0 and 3 have both-ish; doc 2 (neither) must be absent.
    expect(res.find((r) => r.id === 2)).toBeUndefined();
    expect(res.map((r) => r.id)).toContain(0);
  });

  it('returns nothing for empty query or empty index', () => {
    expect(bm.search([])).toEqual([]);
    expect(new Bm25Index([]).search(['x'])).toEqual([]);
  });

  it('respects the limit', () => {
    expect(bm.search(['index'], 1).length).toBe(1);
  });
});
