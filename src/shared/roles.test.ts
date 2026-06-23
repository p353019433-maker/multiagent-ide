import { describe, it, expect } from 'vitest';
import { buildRolePrompt, parseRoleOutput, ROLE_DEFINITIONS, type DebateRoleName } from './roles';
import { createScratchpad, mergeScratchpad } from './scratchpad';

describe('ROLE_DEFINITIONS', () => {
  it('defines 5 debate roles with labels', () => {
    const names = Object.keys(ROLE_DEFINITIONS) as DebateRoleName[];
    expect(names).toEqual(['analyst', 'proposer', 'critic', 'synthesizer', 'executor']);
    for (const name of names) {
      expect(ROLE_DEFINITIONS[name].label).toBeTruthy();
      expect(ROLE_DEFINITIONS[name].persona).toBeTruthy();
    }
  });
});

describe('buildRolePrompt', () => {
  it('analyst prompt includes the request and output schema', () => {
    const s = createScratchpad('加文件搜索');
    const p = buildRolePrompt('analyst', s);
    expect(p).toContain('加文件搜索');
    expect(p).toContain('requirements');
    expect(p).toContain('constraints');
  });

  it('critic prompt includes the current proposal', () => {
    const s = mergeScratchpad(createScratchpad('test'), {
      proposal: { approach: '用 ripgrep', files: [], steps: ['安装 rg'] },
    });
    const p = buildRolePrompt('critic', s);
    expect(p).toContain('用 ripgrep');
    expect(p).toContain('critiques');
    expect(p).toContain('severity');
  });

  it('proposer revision prompt includes critiques', () => {
    const s = mergeScratchpad(createScratchpad('test'), {
      proposal: { approach: 'X', files: [], steps: [] },
      critiques: [{ severity: 'high', issue: '依赖问题', suggestion: '自动检测' }],
    });
    const p = buildRolePrompt('proposer', s, true);
    expect(p).toContain('依赖问题');
    expect(p).toContain('revised_proposal');
    expect(p).toContain('dismissed');
  });
});

describe('parseRoleOutput', () => {
  it('parses analyst JSON output', () => {
    const text = '{"requirements":["a"],"constraints":[],"context":"x"}';
    const out = parseRoleOutput('analyst', text);
    expect(out.analysis?.requirements).toEqual(['a']);
  });

  it('parses critic JSON output', () => {
    const text = '{"critiques":[{"severity":"high","issue":"x","suggestion":"y"}]}';
    const out = parseRoleOutput('critic', text);
    expect(out.critiques?.[0].severity).toBe('high');
  });

  it('extracts JSON from surrounding prose', () => {
    const text = '好的，我的分析如下：\n```json\n{"requirements":["a"],"constraints":[],"context":""}\n```\n以上。';
    const out = parseRoleOutput('analyst', text);
    expect(out.analysis?.requirements).toEqual(['a']);
  });
});
