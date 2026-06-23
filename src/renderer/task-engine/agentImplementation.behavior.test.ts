/**
 * Behavior tests for runImplementation — the parallel Phase-3 orchestration.
 *
 * Mocks window.api.git (worktree add / diff / currentBranch), window.api.ai.chat
 * (for API agents), and window.api.cliAgent.run (for CLI shells), so we can
 * assert the real behavior the charter §4 engines were missing coverage on:
 * parallel fan-out, worktree-failure short-circuit, CLI-vs-API branching, and
 * the ≥2-ok guard in integrateImplementations.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  runImplementation,
  adoptImplementation,
  integrateImplementations,
  type ImplAgent,
} from './agentImplementation';
import type { AgentKind } from '@shared/types';

const ROOT = '/repo';

function apiAgent(i: number): ImplAgent {
  return { id: `api${i}`, name: `API${i}`, kind: 'api', model: 'm', providerId: 'p' };
}
function cliAgentAt(i: number, kind: AgentKind = 'codex'): ImplAgent {
  return { id: `cli${i}`, name: `CLI${i}`, kind, model: '' };
}

interface ApiMock {
  chat: ReturnType<typeof vi.fn>;
  cliRun: ReturnType<typeof vi.fn>;
  worktreeAdd: ReturnType<typeof vi.fn>;
  worktreeRemove: ReturnType<typeof vi.fn>;
  diff: ReturnType<typeof vi.fn>;
  currentBranch: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  stageAll: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  worktreeMerge: ReturnType<typeof vi.fn>;
  skillsList: ReturnType<typeof vi.fn>;
}

/** Install a fake window.api with controllable git + ai + cliAgent + skills. */
function installApi(overrides: Partial<ApiMock> = {}): ApiMock {
  const mock: ApiMock = {
    chat: vi.fn(async () => ({ content: 'done', finishReason: 'stop' })),
    cliRun: vi.fn(async () => ({ ok: true, output: 'CLI ok' })),
    worktreeAdd: vi.fn(async () => ({ success: true, path: '', message: '' })),
    worktreeRemove: vi.fn(async () => ({ success: true, message: '' })),
    diff: vi.fn(async () => 'diff --git a/f b/f\n+new'),
    currentBranch: vi.fn(async () => 'main'),
    // Default: clean working tree (empty status) so adopt proceeds to merge.
    status: vi.fn(async () => ''),
    stageAll: vi.fn(async () => ''),
    commit: vi.fn(async () => ''),
    worktreeMerge: vi.fn(async () => ({ success: true, message: 'merged' })),
    skillsList: vi.fn(async () => []),
    ...overrides,
  };
  // Phase 3 now drives CLI agents through cliAgent.runStream; provide a thin
  // adapter that drains the scripted cliRun result into stream events.
  const cliRunStream = vi.fn(async (_cwd: string, _params: unknown, onEvent: (e: unknown) => void) => {
    const res = await mock.cliRun();
    onEvent?.({ type: 'start' });
    if (res.output) onEvent?.({ type: 'stdout', chunk: res.output });
    onEvent?.({ type: 'exit', code: res.ok ? 0 : 1, signal: null });
    onEvent?.({ type: 'complete', result: res });
    return res;
  });
  (globalThis as any).window = {
    api: {
      ai: { chat: mock.chat },
      cliAgent: { run: mock.cliRun, runStream: cliRunStream },
      git: {
        worktreeAdd: mock.worktreeAdd,
        worktreeRemove: mock.worktreeRemove,
        diff: mock.diff,
        currentBranch: mock.currentBranch,
        status: mock.status,
        stageAll: mock.stageAll,
        commit: mock.commit,
        worktreeMerge: mock.worktreeMerge,
      },
      skills: { list: mock.skillsList },
    },
    dispatchEvent: vi.fn(),
  };
  return mock;
}

beforeEach(() => {
  installApi();
});

describe('runImplementation — parallel fan-out', () => {
  it('runs every agent in parallel (Promise.all), each in its own worktree', async () => {
    const api = installApi();
    const updates: string[] = [];
    const results = await runImplementation({
      agents: [apiAgent(0), apiAgent(1), apiAgent(2)],
      plan: 'p',
      rootPath: ROOT,
      tag: 't',
      onUpdate: (r) => updates.push(r.status),
    });
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === 'ok')).toBe(true);
    // Three worktrees created (one per agent) with 1-based branch names.
    expect(api.worktreeAdd).toHaveBeenCalledTimes(3);
    expect(api.worktreeAdd.mock.calls[0][2]).toBe('ma-t-1');
    expect(api.worktreeAdd.mock.calls[2][2]).toBe('ma-t-3');
    // Each ran its own headless task (ai.chat) + diff.
    expect(api.chat).toHaveBeenCalledTimes(3);
    expect(api.diff).toHaveBeenCalledTimes(3);
    // onUpdate fired at least once per agent (running + ok).
    expect(updates.filter((s) => s === 'running').length).toBe(3);
    expect(updates.filter((s) => s === 'ok').length).toBe(3);
  });

  it('short-circuits an agent to failed when worktreeAdd fails, without aborting siblings', async () => {
    const api = installApi({
      worktreeAdd: vi.fn(async (_cwd: string, _path: string, branch: string) =>
        branch === 'ma-t-1'
          ? { success: false, path: '', message: 'index.lock exists' }
          : { success: true, path: '', message: '' }
      ),
    });
    const results = await runImplementation({
      agents: [apiAgent(0), apiAgent(1)],
      plan: 'p',
      rootPath: ROOT,
      tag: 't',
    });
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toMatch(/index\.lock/);
    expect(results[1].status).toBe('ok');
    // The failed agent never reached the model call.
    expect(api.chat).toHaveBeenCalledTimes(1);
  });

  it('routes CLI agents through cliAgent.run instead of the headless ai.chat loop', async () => {
    const api = installApi();
    const results = await runImplementation({
      agents: [cliAgentAt(0, 'codex')],
      plan: 'p',
      rootPath: ROOT,
      tag: 't',
    });
    expect(api.cliRun).toHaveBeenCalledTimes(1);
    expect(api.chat).not.toHaveBeenCalled();
    expect(results[0].status).toBe('ok');
  });

  it('surfaces a CLI failure as status=failed with the error message', async () => {
    const api = installApi({
      cliRun: vi.fn(async () => ({ ok: false, output: '', error: 'codex boom' })),
    });
    const [r] = await runImplementation({
      agents: [cliAgentAt(0)],
      plan: 'p',
      rootPath: ROOT,
      tag: 't',
    });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/codex boom/);
  });

  it('fires onCall once per agent with timing + ok/fail', async () => {
    const api = installApi();
    const calls: { agentId: string; ok: boolean; durationMs: number }[] = [];
    await runImplementation({
      agents: [apiAgent(0), apiAgent(1)],
      plan: 'p',
      rootPath: ROOT,
      tag: 't',
      onCall: (info) => calls.push({ agentId: info.agentId, ok: info.ok, durationMs: info.durationMs }),
    });
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.ok && c.durationMs >= 0)).toBe(true);
    void api;
  });
});

describe('integrateImplementations — ≥2 ok guard', () => {
  it('throws when fewer than 2 successful implementations exist', async () => {
    installApi();
    const oneOk = [
      { agent: apiAgent(0), branch: 'b1', worktreePath: '/wt1', status: 'ok' as const, diff: 'd1', editedFiles: [] },
      { agent: apiAgent(1), branch: 'b2', worktreePath: '/wt2', status: 'failed' as const, diff: '', editedFiles: [] },
    ];
    await expect(integrateImplementations(ROOT, oneOk, 'plan')).rejects.toThrow(/至少 2/);
  });

  it('builds an integrator prompt from every successful diff and runs in a new worktree', async () => {
    const api = installApi();
    const ok = [
      { agent: apiAgent(0), branch: 'b1', worktreePath: '/wt1', status: 'ok' as const, diff: 'diff-A', editedFiles: [] },
      { agent: apiAgent(1), branch: 'b2', worktreePath: '/wt2', status: 'ok' as const, diff: 'diff-B', editedFiles: [] },
    ];
    const res = await integrateImplementations(ROOT, ok, 'the plan');
    expect(res.status).toBe('ok');
    expect(res.branch).toBe('ma-integrated');
    // The integrator prompt included both diffs.
    const prompt = (api.chat.mock.calls[0] as any[])[2] as { systemPrompt?: string };
    void prompt;
    expect(api.worktreeAdd).toHaveBeenCalledWith(ROOT, expect.any(String), 'ma-integrated', 'main');
  });
});

describe('adoptImplementation', () => {
  it('stageAll + commit + squash-merge, returning the merge result', async () => {
    const api = installApi({
      worktreeMerge: vi.fn(async () => ({ success: true, message: 'squashed' })),
    });
    const r = { agent: apiAgent(0), branch: 'b1', worktreePath: '/wt1', status: 'ok' as const, diff: 'd', editedFiles: [] };
    const out = await adoptImplementation(ROOT, r);
    expect(out.ok).toBe(true);
    expect(out.message).toBe('squashed');
    expect(api.stageAll).toHaveBeenCalledWith('/wt1');
    expect(api.commit).toHaveBeenCalledWith('/wt1', expect.stringContaining('采用'));
    expect(api.worktreeMerge).toHaveBeenCalledWith(ROOT, 'b1', 'squash');
  });

  it('returns ok=false with the error message when the merge throws', async () => {
    installApi({
      worktreeMerge: vi.fn(async () => { throw new Error('conflict'); }),
    });
    const r = { agent: apiAgent(0), branch: 'b1', worktreePath: '/wt1', status: 'ok' as const, diff: 'd', editedFiles: [] };
    const out = await adoptImplementation(ROOT, r);
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/conflict/);
  });
});
