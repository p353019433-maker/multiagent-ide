import { describe, expect, it } from 'vitest';
import { scoreImplementations } from './useRoundTable';
import type { ImplementationResult } from './agentImplementation';
import type { WeightTable } from './agentReview';

function impl(branch: string, agentId: string, ok = true): ImplementationResult {
  return {
    agent: { id: agentId, name: agentId, kind: 'api', model: 'm' },
    branch,
    worktreePath: '/wt/' + branch,
    status: ok ? 'ok' : 'failed',
    diff: ok ? 'diff' : '',
    editedFiles: [],
  };
}

describe('scoreImplementations', () => {
  it('sums each agent role weight into a single score and sorts desc', () => {
    const impls = [impl('b1', 'a1'), impl('b2', 'a2')];
    const weights: WeightTable = {
      a1: { architect: 1.0, security: 0.2, testing: 0.3, style: 0.1, general: 0.5 },
      a2: { architect: 0.1, security: 0.1, testing: 0.1, style: 0.1, general: 0.1 },
    };
    const scored = scoreImplementations(impls, weights);
    expect(scored[0]).toEqual({ branch: 'b1', score: 2.1 });
    expect(scored[1]).toEqual({ branch: 'b2', score: 0.5 });
  });

  it('drops failed implementations before scoring', () => {
    const impls = [impl('b1', 'a1', true), impl('b2', 'a2', false)];
    const weights: WeightTable = {
      a1: { architect: 1, security: 0, testing: 0, style: 0, general: 0 },
      a2: { architect: 1, security: 0, testing: 0, style: 0, general: 0 },
    };
    const scored = scoreImplementations(impls, weights);
    expect(scored).toEqual([{ branch: 'b1', score: 1 }]);
  });

  it('scores 0 when an agent has no weight entry', () => {
    const impls = [impl('b1', 'unknown')];
    const scored = scoreImplementations(impls, {});
    expect(scored).toEqual([{ branch: 'b1', score: 0 }]);
  });
});
