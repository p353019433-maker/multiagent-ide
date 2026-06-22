/**
 * Unit tests for the headless orchestration task loop.
 *
 * Mocks window.api.ai.chat (the non-streaming model call) and an in-memory fs,
 * verifying the loop executes real tools, feeds results back, stops on a plain
 * completion, caps runaway loops, and surfaces tool errors without throwing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runHeadlessTask } from './headlessTaskRunner';
import type { ToolCall } from '@shared/types';

const ROOT = '/wt';
let files: Map<string, string>;

/** Scripted sequence of model responses, consumed one per iteration. */
function installApi(responses: { content: string; toolCalls?: ToolCall[]; finishReason: string }[], extraApi: Record<string, unknown> = {}) {
  let i = 0;
  const chat = vi.fn(async () => responses[Math.min(i++, responses.length - 1)]);
  const fs = {
    readFile: vi.fn(async (p: string) => {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
      return files.get(p)!;
    }),
    writeFile: vi.fn(async (p: string, c: string) => { files.set(p, c); }),
  };
  (globalThis as any).window = { api: { ai: { chat }, fs, ...extraApi }, dispatchEvent: vi.fn() };
  return { chat, fs };
}

const tc = (name: string, args: Record<string, unknown>): ToolCall => ({ id: 't' + Math.random(), name, arguments: args });

beforeEach(() => {
  files = new Map();
});

describe('runHeadlessTask', () => {
  it('stops immediately on a plain completion (no tools)', async () => {
    const { chat } = installApi([{ content: '完成了', finishReason: 'stop' }]);
    const res = await runHeadlessTask({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: '做点事' });
    expect(res.content).toBe('完成了');
    expect(res.iterations).toBe(1);
    expect(chat).toHaveBeenCalledOnce();
    expect(res.note).toBeUndefined();
  });

  it('executes a tool, feeds the result back, then completes', async () => {
    const { chat, fs } = installApi([
      { content: '', toolCalls: [tc('write_file', { path: 'a.ts', content: 'X' })], finishReason: 'tool_calls' },
      { content: '写好了', finishReason: 'stop' },
    ]);
    const res = await runHeadlessTask({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: '写文件' });
    expect(fs.writeFile).toHaveBeenCalledWith(`${ROOT}/a.ts`, 'X');
    expect(files.get(`${ROOT}/a.ts`)).toBe('X');
    expect(res.editedFiles).toContain(`${ROOT}/a.ts`);
    expect(res.content).toBe('写好了');
    expect(res.iterations).toBe(2);
    // Second call must have received the tool result in the message history.
    const secondCallMessages = (chat.mock.calls[1] as any[])[1] as any[];
    expect(secondCallMessages.some((m) => m.role === 'tool')).toBe(true);
  });

  it('captures tool errors into results instead of throwing', async () => {
    installApi([
      { content: '', toolCalls: [tc('read_file', { path: 'missing.ts' })], finishReason: 'tool_calls' },
      { content: '处理了错误', finishReason: 'stop' },
    ]);
    const res = await runHeadlessTask({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: '读不存在的文件' });
    expect(res.content).toBe('处理了错误');
  });

  it('auto-approves workspace writes and runs safe shell commands unattended', async () => {
    const terminal = { runCommand: vi.fn(async () => ({ stdout: 'ok', stderr: '', exitCode: 0 })) };

    installApi(
      [
        { content: '', toolCalls: [tc('write_file', { path: 'b.ts', content: 'Y' })], finishReason: 'tool_calls' },
        { content: '', toolCalls: [tc('run_command', { command: 'npm test' })], finishReason: 'tool_calls' },
        { content: 'ok', finishReason: 'stop' },
      ],
      { terminal }
    );
    const res = await runHeadlessTask({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: '写并跑命令' });
    expect(files.get(`${ROOT}/b.ts`)).toBe('Y');
    expect(res.content).toBe('ok');
    expect(terminal.runCommand).toHaveBeenCalledWith(ROOT, 'npm test', expect.any(Number));
  });

  it('blocks destructive shell commands but keeps running', async () => {
    const terminal = { runCommand: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })) };
    installApi(
      [
        { content: '', toolCalls: [tc('run_command', { command: 'rm -rf /' })], finishReason: 'tool_calls' },
        { content: '已跳过危险命令', finishReason: 'stop' },
      ],
      { terminal }
    );
    const res = await runHeadlessTask({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: '危险命令' });
    expect(terminal.runCommand).not.toHaveBeenCalled();
    expect(res.content).toBe('已跳过危险命令');
  });

  it('blocks remote/integration tools (push, github)', async () => {
    installApi([
      { content: '', toolCalls: [tc('git_push', { remote: 'origin' })], finishReason: 'tool_calls' },
      { content: '不推远端', finishReason: 'stop' },
    ]);
    const res = await runHeadlessTask({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: '别推' });
    expect(res.content).toBe('不推远端');
  });

  it('stops and notes when the task repeats identical calls with no progress', async () => {
    const repeated = { content: '', toolCalls: [tc('read_file', { path: 'a.ts' })], finishReason: 'tool_calls' };
    files.set(`${ROOT}/a.ts`, 'hi');
    // Use a stable id so signatures match across iterations.
    const fixed: ToolCall = { id: 'fixed', name: 'read_file', arguments: { path: 'a.ts' } };
    installApi([
      { content: '', toolCalls: [fixed], finishReason: 'tool_calls' },
      { content: '', toolCalls: [fixed], finishReason: 'tool_calls' },
      { content: '', toolCalls: [fixed], finishReason: 'tool_calls' },
      { content: '', toolCalls: [fixed], finishReason: 'tool_calls' },
    ]);
    void repeated;
    const res = await runHeadlessTask({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: '卡住' });
    expect(res.note).toMatch(/重复/);
    expect(res.iterations).toBeLessThan(20);
  });

  it('returns a note when the model call fails', async () => {
    const chat = vi.fn(async () => { throw new Error('网络炸了'); });
    (globalThis as any).window = { api: { ai: { chat }, fs: { writeFile: vi.fn() } }, dispatchEvent: vi.fn() };
    const res = await runHeadlessTask({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: 'x' });
    expect(res.note).toMatch(/模型调用失败/);
    expect(res.note).toMatch(/网络炸了/);
  });

  // ── Self-heal loop (charter §4: self-verification) ──
  // These tests install window.api.lint.check so the self-heal branch actually
  // runs. Without lint installed the try/catch swallows the TypeError and the
  // entire self-heal block is silently skipped — which is the coverage gap that
  // made §4's headline feature effectively untested.

  it('feeds lint errors back to the model for a self-heal round', async () => {
    const lint = {
      check: vi.fn(async () => ({ hasErrors: true, output: 'src/a.ts(1,1): error TS2304: Cannot find name X' })),
    };
    installApi(
      [
        { content: '', toolCalls: [tc('write_file', { path: 'a.ts', content: 'X' })], finishReason: 'tool_calls' },
        { content: '写好了', finishReason: 'stop' },
        { content: '修好了', finishReason: 'stop' },
      ],
      { lint }
    );
    const res = await runHeadlessTask({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: '写文件' });

    // lint.check ran on the edited file.
    expect(lint.check).toHaveBeenCalledWith(ROOT, [`${ROOT}/a.ts`]);
    // The model got a third call (write → stop+heal → stop) whose messages
    // include the lint output fed back as a user message.
    expect(chatCount()).toBe(3);
    const healCallMessages = (chatCalls()[2] as any[])[1] as any[];
    expect(healCallMessages.some((m) => m.role === 'user' && m.content.includes('TS2304'))).toBe(true);
    expect(res.content).toBe('修好了');
  });

  it('runs self-heal at most once even if the model stops again after editing', async () => {
    const lint = {
      check: vi.fn(async () => ({ hasErrors: true, output: 'error TS1' })),
    };
    installApi(
      [
        { content: '', toolCalls: [tc('write_file', { path: 'a.ts', content: 'X' })], finishReason: 'tool_calls' },
        { content: '', toolCalls: [tc('write_file', { path: 'b.ts', content: 'Y' })], finishReason: 'tool_calls' },
        { content: 'done1', finishReason: 'stop' },
        { content: 'done2', finishReason: 'stop' },
      ],
      { lint }
    );
    await runHeadlessTask({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: '写文件' });
    // selfHealAttempted gates the lint pass to exactly one call, no matter how
    // many times the model subsequently stops with edits on the board.
    expect(lint.check).toHaveBeenCalledTimes(1);
  });

  it('does not self-heal when lint passes clean', async () => {
    const lint = {
      check: vi.fn(async () => ({ hasErrors: false, output: '' })),
    };
    installApi(
      [
        { content: '', toolCalls: [tc('write_file', { path: 'a.ts', content: 'X' })], finishReason: 'tool_calls' },
        { content: '写好了', finishReason: 'stop' },
      ],
      { lint }
    );
    const res = await runHeadlessTask({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: '写文件' });
    expect(lint.check).toHaveBeenCalledOnce();
    // No heal round — the model is not called a third time.
    expect(chatCount()).toBe(2);
    expect(res.content).toBe('写好了');
  });

  it('does not self-heal when no files were edited', async () => {
    const lint = { check: vi.fn(async () => ({ hasErrors: false, output: '' })) };
    installApi([{ content: '没什么要改的', finishReason: 'stop' }], { lint });
    await runHeadlessTask({ providerId: 'p', model: 'm', workspaceRoot: ROOT, task: '看看' });
    expect(lint.check).not.toHaveBeenCalled();
  });
});

// Reach into the installed fake window.api.ai.chat to count/inspect calls.
function chatCount(): number {
  return ((globalThis as any).window.api.ai.chat as ReturnType<typeof vi.fn>).mock.calls.length;
}
function chatCalls(): unknown[][] {
  return ((globalThis as any).window.api.ai.chat as ReturnType<typeof vi.fn>).mock.calls;
}
