import { describe, it, expect } from 'vitest';
import { agentVisual } from './agentTheme';
import { skillTag, diffStat, changedFiles } from './workbenchUtils';
import type { TaskToolExecution } from '@shared/types';

const exec = (name: string, args: Record<string, unknown>): TaskToolExecution =>
  ({ id: Math.random().toString(36).slice(2), name, status: 'success', arguments: args } as unknown as TaskToolExecution);

describe('agentVisual', () => {
  it('maps each kind to its short badge', () => {
    expect(agentVisual('claude-code').badge).toBe('CC');
    expect(agentVisual('codex').badge).toBe('CX');
    expect(agentVisual('api').badge).toBe('API');
    expect(agentVisual('antigravity').badge).toBe('agy');
  });
  it('carries a human label and falls back to api for unknown kinds', () => {
    expect(agentVisual('claude-code').label).toBe('Claude Code');
    expect(agentVisual('weird' as never).badge).toBe('API');
  });
});

describe('skillTag', () => {
  it('classifies meta vs project skills by name', () => {
    expect(skillTag('darwin-skill')).toBe('元技能');
    expect(skillTag('skill-creator')).toBe('元技能');
    expect(skillTag('my-skill')).toBe('元技能'); // ends with -skill
    expect(skillTag('code-ide-multiagent')).toBe('项目');
  });
});

describe('diffStat', () => {
  it('counts +/- lines, ignoring +++/--- file headers', () => {
    const diff = ['--- a/x.ts', '+++ b/x.ts', '@@ -1,2 +1,3 @@', '+added one', '+added two', '-removed one', ' context'].join('\n');
    expect(diffStat(diff)).toEqual({ add: 2, del: 1 });
  });
  it('handles empty / undefined', () => {
    expect(diffStat(undefined)).toEqual({ add: 0, del: 0 });
    expect(diffStat('')).toEqual({ add: 0, del: 0 });
  });
});

describe('changedFiles', () => {
  it('collects write-type targets, dedups (last wins), skips non-write tools', () => {
    const out = changedFiles([
      exec('read_file', { path: 'a.ts' }),
      exec('write_file', { path: 'a.ts' }),
      exec('replace_in_file', { path: 'b.ts' }),
      exec('replace_in_file', { path: 'a.ts' }),
      exec('run_command', { command: 'ls' }),
    ]);
    expect(out.map((c) => c.file).sort()).toEqual(['a.ts', 'b.ts']);
    expect(out.find((c) => c.file === 'a.ts')?.tool).toBe('replace_in_file');
  });
  it('reads alternate path argument keys', () => {
    expect(changedFiles([exec('create_file', { file_path: 'c.ts' })])[0].file).toBe('c.ts');
  });
});
