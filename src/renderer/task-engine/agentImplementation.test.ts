import { describe, expect, it } from 'vitest';
import { implBranch, worktreePathFor } from './agentImplementation';

describe('implBranch', () => {
  it('names branches by tag + 1-based index', () => {
    expect(implBranch('abc', 0)).toBe('ma-abc-1');
    expect(implBranch('abc', 2)).toBe('ma-abc-3');
  });
});

describe('worktreePathFor', () => {
  it('puts the worktree under <repo>_wt/<branch>', () => {
    expect(worktreePathFor('/r/proj', 'ma-x-1')).toBe('/r/proj_wt/ma-x-1');
  });

  it('tolerates a trailing slash on the root', () => {
    expect(worktreePathFor('/r/proj/', 'ma-x-1')).toBe('/r/proj_wt/ma-x-1');
  });
});
