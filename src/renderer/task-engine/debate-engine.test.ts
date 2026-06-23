import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runDebate, runDebateFull, STAGE_SEQUENCE, type DebateFullConfig } from './debate-engine';
import { createScratchpad } from '@shared/scratchpad';
import type { ChatResult, DebateConfig } from '@shared/types';

/** Mock window.api.ai.chat with a scripted sequence of responses. */
function installApi(responses: string[]) {
  let i = 0;
  const chat = vi.fn(async (): Promise<ChatResult> => ({
    content: responses[Math.min(i++, responses.length - 1)],
    finishReason: 'stop',
  }));
  (globalThis as any).window = { api: { ai: { chat } } };
  return { chat };
}

const CONFIG: DebateConfig = {
  analyst: { providerId: 'p1', model: 'm1', temperature: 0.3 },
  proposer: { providerId: 'p2', model: 'm2', temperature: 0.2 },
  critic: { providerId: 'p3', model: 'm3', temperature: 0.7 },
  synthesizer: { providerId: 'p4', model: 'm4', temperature: 0.2 },
  executor: { providerId: 'p5', model: 'm5', temperature: 0.2 },
};

const FULL_CONFIG: DebateFullConfig = CONFIG;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('STAGE_SEQUENCE', () => {
  it('lists the 5 discussion stages in order', () => {
    expect(STAGE_SEQUENCE).toEqual(['analyst', 'proposer', 'critic', 'proposer', 'synthesizer']);
  });
});

describe('runDebate', () => {
  it('runs all 5 discussion stages in order and fills the scratchpad', async () => {
    const { chat } = installApi([
      '{"requirements":["搜索文件"],"constraints":["无新依赖"],"context":"src/"}',
      '{"approach":"用 glob","files":[],"steps":["写工具"]}',
      '{"critiques":[{"severity":"high","issue":"性能","suggestion":"加缓存"}]}',
      '{"revised_proposal":{"approach":"用 glob + 缓存","files":[],"steps":["写工具","加缓存"]},"changes":["加了缓存"],"dismissed":[]}',
      '{"final_plan":{"approach":"glob+缓存","steps":[{"action":"create","target":"search.ts","detail":"实现"}],"rollback":"删文件"}}',
    ]);
    const events: string[] = [];
    const doneEvents: string[] = [];
    const result = await runDebate(
      CONFIG,
      createScratchpad('加文件搜索'),
      { onStage: (e) => {
        if (e.start) events.push(e.stage);
        else doneEvents.push(e.stage);
      } }
    );
    expect(chat).toHaveBeenCalledTimes(5);
    expect(events).toEqual(['analyst', 'proposer', 'critic', 'proposer', 'synthesizer']);
    expect(doneEvents).toEqual(['analyst', 'proposer', 'critic', 'proposer', 'synthesizer']);
    expect(result.scratchpad.analysis?.requirements).toEqual(['搜索文件']);
    expect(result.scratchpad.critiques?.[0].severity).toBe('high');
    expect(result.scratchpad.final_plan?.steps[0].target).toBe('search.ts');
  });

  it('calls onError and stops if a stage output fails to parse', async () => {
    installApi(['这不是JSON']);
    let errMsg = '';
    const result = await runDebate(CONFIG, createScratchpad('test'), {
      onStage: () => {},
      onError: (msg) => { errMsg = msg; },
    });
    expect(errMsg).toBeTruthy();
    expect(result.scratchpad.analysis).toBeNull();
  });
});

describe('runDebateFull', () => {
  it('runs 5 discussion stages then execution', async () => {
    const { chat } = installApi([
      '{"requirements":["r"],"constraints":[],"context":""}',
      '{"approach":"a","files":[],"steps":["s"]}',
      '{"critiques":[{"severity":"low","issue":"i","suggestion":"g"}]}',
      '{"revised_proposal":{"approach":"a2","files":[],"steps":["s2"]},"changes":[],"dismissed":[]}',
      '{"final_plan":{"approach":"a3","steps":[{"action":"create","target":"f.ts","detail":"写文件"}],"rollback":"删"}}',
      // 6th chat call = execution's first iteration: plain stop, no tool calls.
      '执行完成',
    ]);
    // Mock headless task runner via window.api.fs (writeFile/readFile used by runHeadlessTask).
    const fs = {
      readFile: vi.fn(async () => ''),
      writeFile: vi.fn(async () => {}),
    };
    (globalThis as any).window.api.fs = fs;
    // Mock git worktree creation so execution runs in an isolated worktree
    // (mirrors the real runDebateFull flow) instead of the main workspace.
    const worktreePath = '/wt_wt/debate-x';
    const git = {
      currentBranch: vi.fn(async () => 'main'),
      worktreeAdd: vi.fn(async () => ({ success: true, message: 'ok', path: worktreePath })),
    };
    (globalThis as any).window.api.git = git;

    const result = await runDebateFull(
      FULL_CONFIG,
      '加搜索',
      '/wt',
      { onStage: () => {} }
    );
    // 5 debate stages + 1 execution iteration = 6 model calls.
    expect(chat).toHaveBeenCalledTimes(6);
    expect(result.scratchpad.final_plan).not.toBeNull();
    expect(result.execution).toBeDefined();
    expect(result.execution?.content).toBe('执行完成');
    // Execution must run inside a worktree, not the main workspace.
    expect(git.worktreeAdd).toHaveBeenCalledTimes(1);
    expect(git.worktreeAdd).toHaveBeenCalledWith(
      '/wt',
      expect.stringContaining('/wt_wt/debate-'),
      expect.stringMatching(/^debate-\d+$/),
      'main'
    );
    expect(result.worktreePath).toBe(worktreePath);
    expect(result.worktreeBranch).toMatch(/^debate-\d+$/);
    // The execution model call must have been given the worktree path, not '/wt'.
    const execCall = chat.mock.calls[5] as unknown as [string, unknown, { workspaceRoot: string }];
    expect(execCall[0]).toBe('p5');
    expect(execCall[2].workspaceRoot).toBe(worktreePath);
    expect(execCall[2].workspaceRoot).not.toBe('/wt');
  });
});
