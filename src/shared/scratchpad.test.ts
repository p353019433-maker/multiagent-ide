import { describe, it, expect } from 'vitest';
import { createScratchpad, mergeScratchpad, validateScratchpad, STAGES } from './scratchpad';

describe('createScratchpad', () => {
  it('creates an empty scratchpad with only the request filled', () => {
    const s = createScratchpad('给项目加文件搜索');
    expect(s.request).toBe('给项目加文件搜索');
    expect(s.analysis).toBeNull();
    expect(s.proposal).toBeNull();
    expect(s.critiques).toBeNull();
    expect(s.revised_proposal).toBeNull();
    expect(s.final_plan).toBeNull();
  });
});

describe('mergeScratchpad', () => {
  it('merges a patch into the base, only overwriting provided fields', () => {
    const base = createScratchpad('test');
    const merged = mergeScratchpad(base, {
      analysis: { requirements: ['a'], constraints: [], context: '' },
    });
    expect(merged.analysis?.requirements).toEqual(['a']);
    expect(merged.request).toBe('test');
  });
});

describe('STAGES', () => {
  it('lists the 6 debate stages in order', () => {
    expect(STAGES).toEqual([
      'analysis', 'proposal', 'critique', 'revision', 'synthesis', 'execution',
    ]);
  });
});
