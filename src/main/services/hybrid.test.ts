import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion } from './hybrid';

const r = (key: string) => ({ key, item: { key } });

describe('reciprocalRankFusion', () => {
  it('ranks a key present in both lists above keys present in only one', () => {
    const lexical = [r('a'), r('b'), r('c')];
    const semantic = [r('c'), r('d'), r('e')]; // 'c' appears in both
    const fused = reciprocalRankFusion([lexical, semantic]);
    expect(fused[0].key).toBe('c');
  });

  it('merges by key and keeps the representative from its best-ranked list', () => {
    const lexical = [{ key: 'x', item: { from: 'lex', rank: 0 } }];
    const semantic = [
      { key: 'y', item: { from: 'sem', rank: 0 } },
      { key: 'x', item: { from: 'sem', rank: 1 } },
    ];
    const fused = reciprocalRankFusion([lexical, semantic]);
    const x = fused.find((f) => f.key === 'x')!;
    expect(x.item.from).toBe('lex'); // ranked 0 in lexical beats rank 1 in semantic
  });

  it('higher rank (earlier position) contributes more score', () => {
    const fused = reciprocalRankFusion([[r('first'), r('second')]]);
    expect(fused[0].key).toBe('first');
    expect(fused[0].score).toBeGreaterThan(fused[1].score);
  });

  it('handles empty lists', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });
});
